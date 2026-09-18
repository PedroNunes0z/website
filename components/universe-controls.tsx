"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { MathUtils, MOUSE, PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsInstance } from "three-stdlib";
import { getCameraDistance, getScrollDistanceFactor, getZoomDistance, MODEL_MAX_DISTANCE_FACTOR, MODEL_RADIUS } from "@/lib/model-framing";

type UniverseControlsProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  interactionRef: RefObject<boolean>;
  reducedMotion: boolean;
};

export function UniverseControls({ stageRef, interactionRef, reducedMotion }: UniverseControlsProps) {
  const controlsRef = useRef<OrbitControlsInstance>(null);
  const getRendererState = useThree((state) => state.get);
  const domElement = useThree((state) => state.gl.domElement);
  const { width, height } = useThree((state) => state.size);
  const motion = useRef({ fittedDistance: 0, progress: 0, manualZoom: 1, dragging: false });

  useLayoutEffect(() => {
    const { camera, invalidate } = getRendererState();
    if (!(camera instanceof PerspectiveCamera) || height === 0 || width === 0) return;
    camera.aspect = width / height;
    const previousFit = motion.current.fittedDistance;
    const fittedDistance = getCameraDistance(MODEL_RADIUS, camera.getEffectiveFOV(), camera.aspect);
    const distanceRatio = previousFit > 0 ? camera.position.length() / previousFit : getScrollDistanceFactor(motion.current.progress);
    motion.current.fittedDistance = fittedDistance;
    camera.position.setLength(MathUtils.clamp(fittedDistance * distanceRatio, fittedDistance, fittedDistance * MODEL_MAX_DISTANCE_FACTOR));
    camera.near = 0.1;
    camera.far = fittedDistance * MODEL_MAX_DISTANCE_FACTOR + 4;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (controlsRef.current) {
      controlsRef.current.minDistance = fittedDistance;
      controlsRef.current.maxDistance = fittedDistance * MODEL_MAX_DISTANCE_FACTOR;
      controlsRef.current.update();
      if (previousFit === 0) controlsRef.current.saveState();
    }
    invalidate();
  }, [getRendererState, width, height]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { gl, invalidate } = getRendererState();
    const canvas = gl.domElement;

    const updateScroll = () => {
      const bounds = stage.getBoundingClientRect();
      const hero = stage.closest(".hero")?.getBoundingClientRect();
      const heroTop = hero ? hero.top + window.scrollY : 0;
      const stageTop = bounds.top + window.scrollY;
      const start = Math.max(heroTop, stageTop - window.innerHeight * 0.65);
      const travel = Math.max(bounds.height, window.innerHeight * 0.55, 1);
      motion.current.progress = MathUtils.clamp((window.scrollY - start) / travel, 0, 1);
      invalidate();
    };

    const adjustZoom = (factor: number) => {
      const state = motion.current;
      if (state.fittedDistance <= 0) return;
      const current = getZoomDistance(state.fittedDistance, state.progress, state.manualZoom);
      const next = MathUtils.clamp(current * factor, state.fittedDistance, state.fittedDistance * MODEL_MAX_DISTANCE_FACTOR);
      state.manualZoom = next / (state.fittedDistance * getScrollDistanceFactor(state.progress));
      interactionRef.current = true;
      invalidate();
    };

    const onWheel = (event: WheelEvent) => {
      // Browser zoom shortcuts stay available; ordinary wheel input is local to the canvas.
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      const delta = MathUtils.clamp(event.deltaY * unit, -200, 200);
      adjustZoom(Math.exp(delta * 0.0018));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const controls = controlsRef.current;
      if (!controls || event.target !== stage) return;
      if (!["+", "=", "-", "_", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      interactionRef.current = true;
      if (event.key === "+" || event.key === "=") adjustZoom(0.9);
      else if (event.key === "-" || event.key === "_") adjustZoom(1.1);
      else if (event.key === "ArrowLeft") controls.setAzimuthalAngle(controls.getAzimuthalAngle() - 0.12);
      else if (event.key === "ArrowRight") controls.setAzimuthalAngle(controls.getAzimuthalAngle() + 0.12);
      else if (event.key === "ArrowUp") controls.setPolarAngle(controls.getPolarAngle() - 0.12);
      else if (event.key === "ArrowDown") controls.setPolarAngle(controls.getPolarAngle() + 0.12);
      else {
        motion.current.manualZoom = 1;
        controls.reset();
      }
      invalidate();
    };

    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("resize", updateScroll);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("resize", updateScroll);
      canvas.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKeyDown);
    };
  }, [getRendererState, stageRef, interactionRef]);

  useFrame(({ camera, invalidate }, delta) => {
    const state = motion.current;
    if (state.fittedDistance <= 0 || state.dragging) return;
    const target = getZoomDistance(state.fittedDistance, state.progress, state.manualZoom);
    const current = camera.position.length();
    if (Math.abs(current - target) < 0.0001) return;
    const distance = reducedMotion ? target : MathUtils.damp(current, target, 8, Math.min(delta, 0.1));
    camera.position.setLength(distance);
    invalidate();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      domElement={domElement}
      makeDefault
      enablePan={false}
      enableZoom={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.65}
      mouseButtons={{ LEFT: MOUSE.ROTATE }}
      onStart={() => {
        motion.current.dragging = true;
        interactionRef.current = true;
        if (stageRef.current) {
          stageRef.current.dataset.dragging = "true";
          stageRef.current.focus({ preventScroll: true });
        }
      }}
      onEnd={() => {
        motion.current.dragging = false;
        if (stageRef.current) delete stageRef.current.dataset.dragging;
      }}
    />
  );
}
