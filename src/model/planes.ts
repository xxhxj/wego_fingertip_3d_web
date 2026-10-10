import { add, cross, dot, lengthOf, normalize, scale, sub } from "./math";
import type { DatumPlane, DocumentModel, Vec3 } from "./types";

export function planeSummary(plane: DatumPlane): string {
  if (plane.kind === "offset") return `偏置 ${plane.distance} mm`;
  if (plane.kind === "bisect") return "等分";
  if (plane.kind === "angled") return `斜面 ${plane.angleDeg}°`;
  return "基准";
}

/** 按偏置、等分和斜面的参数写回原点、法向和 U 轴。基准面保持原样。 */
export function resolveDocumentPlanes(document: DocumentModel): void {
  const byId = new Map(document.planes.map((plane) => [plane.id, plane]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  for (const plane of document.planes) resolve(plane, byId, done, visiting);
}

function resolve(
  plane: DatumPlane,
  byId: Map<string, DatumPlane>,
  done: Set<string>,
  visiting: Set<string>,
): void {
  if (plane.kind === "principal" || done.has(plane.id) || visiting.has(plane.id)) return;
  visiting.add(plane.id);
  const source = plane.sourceId ? byId.get(plane.sourceId) : undefined;
  const peer = plane.peerId ? byId.get(plane.peerId) : undefined;
  if (source) resolve(source, byId, done, visiting);
  if (peer) resolve(peer, byId, done, visiting);
  if (plane.kind === "offset" && source) {
    const normal = normalize(source.normal);
    plane.origin = add(source.origin, scale(normal, plane.distance));
    plane.normal = normal;
    plane.xDir = normalize(source.xDir);
  } else if (plane.kind === "angled" && source) {
    const axis = normalize(source.xDir);
    plane.origin = { ...source.origin };
    plane.normal = rotateAround(normalize(source.normal), axis, (plane.angleDeg * Math.PI) / 180);
    plane.xDir = axis;
  } else if (plane.kind === "bisect" && source && peer) {
    plane.origin = scale(add(source.origin, peer.origin), 0.5);
    const summed = add(normalize(source.normal), normalize(peer.normal));
    plane.normal = lengthOf(summed) < 1e-6 ? normalize(source.normal) : normalize(summed);
    const projected = sub(normalize(source.xDir), scale(plane.normal, dot(normalize(source.xDir), plane.normal)));
    plane.xDir = lengthOf(projected) < 1e-6
      ? normalize(cross(plane.normal, { x: 0, y: 0, z: 1 }))
      : normalize(projected);
  }
  visiting.delete(plane.id);
  done.add(plane.id);
}

function rotateAround(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = scale(unit, dot(vector, unit));
  return add(add(along, scale(sub(vector, along), cos)), scale(cross(unit, vector), sin));
}
