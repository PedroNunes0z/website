"use client";

import { Float, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import { Box3, Vector3 } from "three";
import type { Group } from "three";

function SunModel() {
  const group = useRef<Group>(null);
  const { scene } = useGLTF("/models/sun/sun.glb");
  const model = useMemo(() => {
    const object = scene.clone(true);
    const bounds = new Box3().setFromObject(object);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const largestAxis = Math.max(size.x, size.y, size.z);

    return {
      object,
      position: [-center.x, -center.y, -center.z] as [number, number, number],
      scale: largestAxis > 0 ? 1.58 / largestAxis : 1,
    };
  }, [scene]);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.075;
  });

  return (
    <Float speed={0.8} rotationIntensity={0.08} floatIntensity={0.15}>
      <group ref={group} rotation={[0.12, -0.4, 0]}>
        <group scale={model.scale}>
          <primitive object={model.object} position={model.position} />
        </group>
      </group>
    </Float>
  );
}

export function SunScene() {
  return (
    <div className="sun-stage" aria-label="Modelo tridimensional do Sol em rotação">
      <div className="sun-glow" />
      <Suspense fallback={<div className="sun-fallback" />}>
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 3.25], fov: 38 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <SunModel />
        </Canvas>
      </Suspense>
      <span className="orbit orbit-one" />
      <span className="orbit orbit-two" />
    </div>
  );
}

useGLTF.preload("/models/sun/sun.glb");
