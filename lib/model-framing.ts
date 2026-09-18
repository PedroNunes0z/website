import { Box3, MathUtils, Mesh, Vector3 } from "three";
import type { Object3D } from "three";

export const MODEL_RADIUS = 1;
export const MODEL_FLOAT_RANGE = 0.04;

export function getModelLayout(object: Object3D) {
  object.updateWorldMatrix(true, true);
  const center = new Box3().setFromObject(object, true).getCenter(new Vector3());
  const vertex = new Vector3();
  let radius = 0;

  // Measure the complete geometry, including outer orbits, in world space.
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const positions = child.geometry.getAttribute("position");
    if (!positions) return;

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      radius = Math.max(radius, vertex.distanceTo(center));
    }
  });

  return {
    position: [-center.x, -center.y, -center.z] as [number, number, number],
    scale: radius > 0 ? MODEL_RADIUS / radius : 1,
  };
}

export function getCameraDistance(radius: number, verticalFov: number, aspect: number) {
  const verticalHalfFov = MathUtils.degToRad(verticalFov) / 2;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);

  // A sphere remains inside both axes throughout rotation, with 14% breathing room.
  return (radius * 1.14) / Math.sin(limitingHalfFov);
}
