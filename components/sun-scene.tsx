"use client";

import { Float, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type { Group } from "three";

function SunModel() {
  const group = useRef<Group>(null);
  const { scene } = useGLTF("/models/sun/sun.glb");

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.075;
  });

  return (
    <Float speed={0.8} rotationIntensity={0.08} floatIntensity={0.15}>
      <group ref={group} scale={0.00145} rotation={[0.12, -0.4, 0]}>
        <primitive object={scene} />
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
