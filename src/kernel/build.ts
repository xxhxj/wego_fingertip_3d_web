import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { normalize, scale, toWorld } from "../model/math";
import { isClosed, rectangleCorners } from "../model/profiles";
import type { PlaneFrame, SketchEntity, Vec3 } from "../model/types";

export interface BuildJob {
  id: string;
  plane: PlaneFrame;
  entity: SketchEntity;
  start: number;
  end: number;
  quality: "preview" | "final";
}

export interface BuiltMesh {
  id: string;
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  edges: Float32Array<ArrayBuffer>;
  volume: number;
}

export interface BuiltError {
  id: string;
  error: string;
}

export type BuildResult = BuiltMesh | BuiltError;

export function isBuiltMesh(result: BuildResult): result is BuiltMesh {
  return "positions" in result;
}

export function buildExtrusion(kernel: OcctKernel, job: BuildJob): BuildResult {
  const height = job.end - job.start;
  if (!Number.isFinite(height) || Math.abs(height) < 1e-4) {
    return { id: job.id, error: "拉伸距离太小" };
  }
  if (!isClosed(job.entity)) return { id: job.id, error: "截面未封闭" };

  const plane: PlaneFrame = {
    ...job.plane,
    normal: normalize(job.plane.normal),
    xDir: normalize(job.plane.xDir),
  };
  const created: ShapeHandle[] = [];
  try {
    const face = makeProfileFace(kernel, plane, job.entity, created);
    const moved = kernel.translate(face, plane.normal.x * job.start, plane.normal.y * job.start, plane.normal.z * job.start);
    created.push(moved);
    const direction = scale(plane.normal, height);
    const solid = kernel.extrude(moved, direction.x, direction.y, direction.z);
    created.push(solid);
    const deflection = job.quality === "preview"
      ? { linearDeflection: 0.4, angularDeflection: 0.6 }
      : { linearDeflection: 0.08, angularDeflection: 0.35 };
    const mesh = kernel.meshShape(solid, deflection);
    let edges: Float32Array<ArrayBuffer> = new Float32Array();
    try {
      const wire = kernel.wireframe(solid, { source: "triangulation", deflection: deflection.linearDeflection });
      edges = edgeSegments(wire.points, wire.edgeGroups, wire.edgeCount);
    } catch {
      edges = new Float32Array();
    }
    return {
      id: job.id,
      positions: copyFloat32(mesh.positions),
      normals: copyFloat32(mesh.normals),
      indices: copyUint32(mesh.indices),
      edges,
      volume: kernel.getVolume(solid),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: job.id, error: message || "拉伸失败" };
  } finally {
    for (let index = created.length - 1; index >= 0; index -= 1) {
      try {
        kernel.release(created[index]);
      } catch {
        // 句柄已经释放时忽略。
      }
    }
  }
}

function makeProfileFace(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle {
  const edges = profileEdges(kernel, plane, entity, created);
  const wire = kernel.makeWire(edges);
  created.push(wire);
  const face = kernel.makeFace(wire);
  created.push(face);
  return face;
}

function profileEdges(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle[] {
  if (entity.type === "rectangle") {
    return loopEdges(kernel, rectangleCorners(entity.a, entity.b).map((point) => toWorld(plane, point)), created);
  }
  if (entity.type === "circle") {
    const edge = kernel.makeCircleEdge(toWorld(plane, entity.center), plane.normal, entity.radius);
    created.push(edge);
    return [edge];
  }
  if (entity.type === "polyline") {
    return loopEdges(kernel, entity.points.map((point) => toWorld(plane, point)), created);
  }
  const start = toWorld(plane, entity.start);
  const mid = toWorld(plane, entity.mid);
  const end = toWorld(plane, entity.end);
  const arc = kernel.makeArcEdge(start, mid, end);
  const chord = kernel.makeLineEdge(end, start);
  created.push(arc, chord);
  return [arc, chord];
}

function loopEdges(kernel: OcctKernel, points: Vec3[], created: ShapeHandle[]): ShapeHandle[] {
  const edges: ShapeHandle[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const edge = kernel.makeLineEdge(points[index], points[(index + 1) % points.length]);
    created.push(edge);
    edges.push(edge);
  }
  return edges;
}

function edgeSegments(points: Float32Array, groups: Int32Array, edgeCount: number): Float32Array<ArrayBuffer> {
  const chunks: number[] = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const start = groups[index * 3];
    const count = groups[index * 3 + 1];
    const pointCount = Math.floor(count / 3);
    for (let point = 0; point < pointCount - 1; point += 1) {
      const offset = start + point * 3;
      chunks.push(points[offset], points[offset + 1], points[offset + 2], points[offset + 3], points[offset + 4], points[offset + 5]);
    }
  }
  return copyFloat32(chunks);
}

function copyFloat32(source: ArrayLike<number>): Float32Array<ArrayBuffer> {
  const copy = new Float32Array(source.length);
  copy.set(source);
  return copy;
}

function copyUint32(source: ArrayLike<number>): Uint32Array<ArrayBuffer> {
  const copy = new Uint32Array(source.length);
  copy.set(source);
  return copy;
}
