import type { PlaneFrame, Vec2, Vec3 } from "./types";

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, scalar: number): Vec3 {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthOf(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function normalize(vector: Vec3): Vec3 {
  const len = lengthOf(vector) || 1;
  return scale(vector, 1 / len);
}

export function yAxis(plane: PlaneFrame): Vec3 {
  return normalize(cross(plane.normal, plane.xDir));
}

export function toWorld(plane: PlaneFrame, point: Vec2): Vec3 {
  const x = normalize(plane.xDir);
  const y = yAxis(plane);
  return {
    x: plane.origin.x + x.x * point.x + y.x * point.y,
    y: plane.origin.y + x.y * point.x + y.y * point.y,
    z: plane.origin.z + x.z * point.x + y.z * point.y,
  };
}

export function worldToPlane(plane: PlaneFrame, point: Vec3): Vec2 {
  const x = normalize(plane.xDir);
  const y = yAxis(plane);
  const delta = sub(point, plane.origin);
  return { x: dot(delta, x), y: dot(delta, y) };
}

export function rayPlane(origin: Vec3, direction: Vec3, plane: PlaneFrame): Vec3 | null {
  const normal = normalize(plane.normal);
  const denom = dot(direction, normal);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(plane.origin, origin), normal) / denom;
  if (t < 0) return null;
  return add(origin, scale(direction, t));
}

/** 鼠标射线与轴的最近点，返回沿单位轴的有符号距离。 */
export function rayAxisScalar(rayOrigin: Vec3, rayDirection: Vec3, axisOrigin: Vec3, axisDirection: Vec3): number | null {
  const offset = sub(rayOrigin, axisOrigin);
  const a = dot(rayDirection, rayDirection);
  const b = dot(rayDirection, axisDirection);
  const c = dot(axisDirection, axisDirection);
  const d = dot(rayDirection, offset);
  const e = dot(axisDirection, offset);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-8) return null;
  return (a * e - b * d) / denom;
}

export function snap(value: number, fine: boolean): number {
  if (fine) return Math.round(value * 10) / 10;
  return Math.round(value);
}

export function snap2(point: Vec2, fine: boolean): Vec2 {
  return { x: snap(point.x, fine), y: snap(point.y, fine) };
}
