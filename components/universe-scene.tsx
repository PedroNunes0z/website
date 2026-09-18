"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { FrontSide, Mesh, MeshStandardMaterial, PerspectiveCamera } from "three";
import type { Group } from "three";
import { getCameraDistance, getModelLayout, MODEL_FLOAT_RANGE, MODEL_RADIUS } from "@/lib/model-framing";

const MODEL_URL = "/models/the_universe.glb";

function subscribeToReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ModelCamera() {
  const getRendererState = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);

  useLayoutEffect(() => {
    const { camera, invalidate } = getRendererState();
    if (!(camera instanceof PerspectiveCamera) || height === 0) return;
    camera.aspect = width / height;
    const distance = getCameraDistance(MODEL_RADIUS + MODEL_FLOAT_RANGE, camera.getEffectiveFOV(), camera.aspect);
    camera.position.set(0, 0, distance);
    camera.near = 0.1;
    camera.far = distance + 4;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [getRendererState, width, height]);

  return null;
}

function UniverseModel({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => {
    const object = scene.clone(true);
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const displayMaterials = materials.map((source) => {
        const material = source.clone();
        if (material instanceof MeshStandardMaterial && ["Mat_Orb", "Mat_Orb2"].includes(material.name)) {
          // Sketchfab's outer effect layers otherwise hide the inner orbital geometry.
          material.transparent = true;
          material.opacity = material.name === "Mat_Orb2" ? 0.035 : 0.06;
          material.depthWrite = false;
          material.side = FrontSide;
        }
        return material;
      });
      child.material = Array.isArray(child.material) ? displayMaterials : displayMaterials[0];
    });
    return { object, ...getModelLayout(object) };
  }, [scene]);

  useFrame(({ clock }, delta) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y += Math.min(delta, 0.1) * 0.075;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.45) * MODEL_FLOAT_RANGE;
  });

  return (
    <group ref={group} rotation={[0.18, -0.4, 0.12]}>
      <group scale={model.scale}>
        <primitive object={model.object} position={model.position} />
      </group>
    </group>
  );
}

function UniverseFallback() {
  return (
    <div className="universe-fallback" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function UniverseScene() {
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, getReducedMotion, () => true);

  return (
    <div className="universe-stage" role="img" aria-label="The Universe! — modelo tridimensional de Stark">
      <div className="universe-glow" aria-hidden="true" />
      <Canvas
        dpr={[1, 1.5]}
        frameloop={reducedMotion ? "demand" : "always"}
        camera={{ position: [0, 0, 4], fov: 38, near: 0.1, far: 12 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        fallback={<UniverseFallback />}
      >
        <ModelCamera />
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 4, 5]} intensity={3} />
        <directionalLight position={[-3, -1, 2]} color="#ff8d4f" intensity={2} />
        <Suspense fallback={null}>
          <Environment resolution={128} frames={1} environmentIntensity={1.2}>
            <color attach="background" args={["#69635e"]} />
            <Lightformer position={[0, 3, 4]} target={[0, 0, 0]} scale={[5, 4, 1]} intensity={3} />
            <Lightformer position={[-4, 0, 2]} target={[0, 0, 0]} scale={[3, 5, 1]} color="#ff8d4f" intensity={2} />
            <Lightformer position={[4, -2, 1]} target={[0, 0, 0]} scale={[3, 3, 1]} intensity={2} />
          </Environment>
          <UniverseModel reducedMotion={reducedMotion} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
