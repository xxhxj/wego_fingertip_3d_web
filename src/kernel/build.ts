import { JoinType, type OcctKernel, type ShapeHandle } from "occt-wasm";
import { normalize, scale, toWorld, yAxis } from "../model/math";
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

  const created: ShapeHandle[] = [];
  try {
    const solid = makeExtrudedShape(kernel, job.plane, job.entity, {
      start: job.start,
      end: job.end,
      wall: 0,
      sheet: false,
      draftAngle: 0,
    }, created);
    return tessellateShape(kernel, job.id, solid, job.quality);
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

export interface ExtrudeOptions {
  start: number;
  end: number;
  wall: number;
  sheet: boolean;
  draftAngle: number;
}

export function makeExtrudedShape(
  kernel: OcctKernel,
  plane: PlaneFrame,
  entity: SketchEntity,
  options: ExtrudeOptions,
  created: ShapeHandle[],
): ShapeHandle {
  const height = options.end - options.start;
  if (!Number.isFinite(height) || Math.abs(height) < 1e-4) throw new Error("拉伸距离太小");
  if (!isClosed(entity)) throw new Error("截面未封闭");
  const frame = frameOf(plane);
  const profile = options.sheet
    ? makeProfileWire(kernel, frame, entity, created)
    : options.wall > 0.05
      ? makeWallFace(kernel, frame, entity, options.wall, created)
      : makeProfileFace(kernel, frame, entity, created);
  const moved = kernel.translate(profile, frame.normal.x * options.start, frame.normal.y * options.start, frame.normal.z * options.start);
  created.push(moved);
  const direction = scale(frame.normal, height);
  if (!options.sheet && Math.abs(options.draftAngle) > 0.05) {
    const drafted = kernel.draftPrism(moved, direction.x, direction.y, direction.z, options.draftAngle);
    created.push(drafted);
    return drafted;
  }
  const solid = kernel.extrude(moved, direction.x, direction.y, direction.z);
  created.push(solid);
  return solid;
}

export function makeRevolvedShape(
  kernel: OcctKernel,
  plane: PlaneFrame,
  entity: SketchEntity,
  axis: "u" | "v",
  angleDeg: number,
  created: ShapeHandle[],
): ShapeHandle {
  if (!isClosed(entity)) throw new Error("截面未封闭");
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 0.1) throw new Error("旋转角度太小");
  const frame = frameOf(plane);
  const face = makeProfileFace(kernel, frame, entity, created);
  const direction = axis === "u" ? frame.xDir : yAxis(frame);
  const solid = kernel.revolve(face, { point: frame.origin, direction }, (angleDeg * Math.PI) / 180);
  created.push(solid);
  return solid;
}

export function makeSweepShape(
  kernel: OcctKernel,
  profilePlane: PlaneFrame,
  profile: SketchEntity,
  pathPlane: PlaneFrame,
  path: SketchEntity,
  created: ShapeHandle[],
): ShapeHandle {
  if (!isClosed(profile)) throw new Error("截面未封闭");
  const frame = frameOf(profilePlane);
  const profileFace = makeProfileFace(kernel, frame, profile, created);
  const profileWire = makeProfileWire(kernel, frame, profile, created);
  const spine = makePathWire(kernel, frameOf(pathPlane), path, created);
  const attempts: ShapeHandle[] = [];
  const trySweep = (run: () => ShapeHandle) => {
    try {
      const shape = run();
      created.push(shape);
      attempts.push(shape);
    } catch {
      // 下一种扫掠方式继续试。
    }
  };
  trySweep(() => kernel.pipe(profileFace, spine));
  trySweep(() => kernel.pipe(profileWire, spine));
  trySweep(() => kernel.sweep(profileWire, spine));
  for (const shape of attempts) {
    if (solidCount(kernel, shape) > 0) return shape;
    try {
      const solid = kernel.makeSolid(shape);
      created.push(solid);
      if (solidCount(kernel, solid) > 0) return solid;
    } catch {
      // 壳封不成实体时换下一种结果。
    }
  }
  throw new Error("扫掠没有生成实体");
}

export function makeLoftShape(
  kernel: OcctKernel,
  profiles: { plane: PlaneFrame; entity: SketchEntity }[],
  ruled: boolean,
  created: ShapeHandle[],
): ShapeHandle {
  if (profiles.length < 2) throw new Error("放样至少需要两个截面");
  const wires = profiles.map((profile) => {
    if (!isClosed(profile.entity)) throw new Error("截面未封闭");
    return makeProfileWire(kernel, frameOf(profile.plane), profile.entity, created);
  });
  const lofted = kernel.loft(wires, true, ruled);
  created.push(lofted);
  if (solidCount(kernel, lofted) === 0) throw new Error("放样没有生成实体");
  return lofted;
}

function solidCount(kernel: OcctKernel, shape: ShapeHandle): number {
  const solids = kernel.getSubShapes(shape, "solid");
  const count = solids.length;
  for (const solid of solids) {
    try {
      kernel.release(solid);
    } catch {
      // 句柄已经释放时忽略。
    }
  }
  return count;
}

export interface MeshOptions {
  linearDeflection?: number;
  angularDeflection?: number;
  /** 只把法向最接近这个方向的面剖得更细。 */
  face?: { direction: Vec3; linearDeflection: number } | null;
}

export function tessellateShape(
  kernel: OcctKernel,
  id: string,
  shape: ShapeHandle,
  quality: "preview" | "final",
  meshOptions?: MeshOptions,
): BuiltMesh {
  const deflection = {
    linearDeflection: meshOptions?.linearDeflection ?? (quality === "preview" ? 0.4 : 0.08),
    angularDeflection: meshOptions?.angularDeflection ?? (quality === "preview" ? 0.6 : 0.35),
  };
  let positions = copyFloat32([]);
  let normals = copyFloat32([]);
  let indices = copyUint32([]);
  const refined = meshOptions?.face ? meshByFace(kernel, shape, deflection, meshOptions.face) : null;
  if (refined) {
    positions = refined.positions;
    normals = refined.normals;
    indices = refined.indices;
  } else {
    const mesh = kernel.meshShape(shape, deflection);
    positions = copyFloat32(mesh.positions);
    normals = copyFloat32(mesh.normals);
    indices = copyUint32(mesh.indices);
  }
  let edges = copyFloat32([]);
  try {
    if (!kernel.hasTriangulation(shape)) kernel.meshShape(shape, deflection);
    const wire = kernel.wireframe(shape, { source: "triangulation", deflection: deflection.linearDeflection });
    edges = edgeSegments(wire.points, wire.edgeGroups, wire.edgeCount);
  } catch {
    edges = copyFloat32([]);
  }
  return {
    id,
    positions,
    normals,
    indices,
    edges,
    volume: measureVolume(kernel, shape),
  };
}

function meshByFace(
  kernel: OcctKernel,
  shape: ShapeHandle,
  coarse: { linearDeflection: number; angularDeflection: number },
  face: { direction: Vec3; linearDeflection: number },
): { positions: Float32Array<ArrayBuffer>; normals: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer> } | null {
  const faces = kernel.getSubShapes(shape, "face");
  try {
    if (faces.length === 0) return null;
    const dir = normalize(face.direction);
    let best = faces[0];
    let bestDot = -2;
    for (const item of faces) {
      try {
        const bounds = kernel.uvBounds(item);
        const normal = kernel.surfaceNormal(item, (bounds.uMin + bounds.uMax) / 2, (bounds.vMin + bounds.vMax) / 2);
        const score = normal.x * dir.x + normal.y * dir.y + normal.z * dir.z;
        if (score > bestDot) {
          bestDot = score;
          best = item;
        }
      } catch {
        // 读不到法向的面不参与比较。
      }
    }
    const positionChunks: number[] = [];
    const normalChunks: number[] = [];
    const indexChunks: number[] = [];
    let base = 0;
    for (const item of faces) {
      const options = item === best
        ? { linearDeflection: face.linearDeflection, angularDeflection: coarse.angularDeflection }
        : coarse;
      const part = kernel.meshShape(item, options);
      for (let index = 0; index < part.positions.length; index += 1) positionChunks.push(part.positions[index]);
      for (let index = 0; index < part.normals.length; index += 1) normalChunks.push(part.normals[index]);
      for (let index = 0; index < part.indices.length; index += 1) indexChunks.push(part.indices[index] + base);
      base += part.vertexCount;
    }
    if (base === 0) return null;
    return {
      positions: copyFloat32(positionChunks),
      normals: copyFloat32(normalChunks),
      indices: copyUint32(indexChunks),
    };
  } catch {
    return null;
  } finally {
    for (const item of faces) {
      try {
        kernel.release(item);
      } catch {
        // 句柄已经释放时忽略。
      }
    }
  }
}

export function measureVolume(kernel: OcctKernel, shape: ShapeHandle): number {
  const solids = kernel.getSubShapes(shape, "solid");
  try {
    if (solids.length === 0) return 0;
    try {
      const value = kernel.getVolume(shape);
      if (Number.isFinite(value) && Math.abs(value) > 1e-6) return value;
    } catch {
      // 复合体改用子实体累加。
    }
    let sum = 0;
    for (const solid of solids) {
      try {
        const value = kernel.getVolume(solid);
        if (Number.isFinite(value)) sum += value;
      } catch {
        // 跳过无法求体积的子形状。
      }
    }
    return sum;
  } finally {
    for (const solid of solids) {
      try {
        kernel.release(solid);
      } catch {
        // 句柄已经释放时忽略。
      }
    }
  }
}

function frameOf(plane: PlaneFrame): PlaneFrame {
  return {
    ...plane,
    normal: normalize(plane.normal),
    xDir: normalize(plane.xDir),
  };
}

function makeWallFace(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, wall: number, created: ShapeHandle[]): ShapeHandle {
  const outer = makeProfileWire(kernel, plane, entity, created);
  const face = kernel.makeFace(outer);
  created.push(face);
  const inset = insetEntity(entity, wall);
  if (inset) {
    const inner = makeProfileWire(kernel, plane, inset, created);
    const holed = kernel.addHolesInFace(face, [inner]);
    created.push(holed);
    return holed;
  }
  let failure: unknown = null;
  for (const offset of [wall, -wall]) {
    try {
      const inner = kernel.offsetWire2D(outer, offset, JoinType.Intersection);
      created.push(inner);
      const holed = kernel.addHolesInFace(face, [inner]);
      created.push(holed);
      return holed;
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? failure : new Error("薄壁偏移失败");
}

function insetEntity(entity: SketchEntity, wall: number): SketchEntity | null {
  if (entity.type === "rectangle") {
    const x0 = Math.min(entity.a.x, entity.b.x) + wall;
    const x1 = Math.max(entity.a.x, entity.b.x) - wall;
    const y0 = Math.min(entity.a.y, entity.b.y) + wall;
    const y1 = Math.max(entity.a.y, entity.b.y) - wall;
    if (x1 - x0 < 0.2 || y1 - y0 < 0.2) throw new Error("薄壁厚度过大");
    return { ...entity, a: { x: x0, y: y0 }, b: { x: x1, y: y1 } };
  }
  if (entity.type === "circle") {
    if (entity.radius - wall < 0.2) throw new Error("薄壁厚度过大");
    return { ...entity, radius: entity.radius - wall };
  }
  return null;
}

function makeProfileWire(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle {
  const edges = profileEdges(kernel, plane, entity, created);
  const wire = kernel.makeWire(edges);
  created.push(wire);
  return wire;
}

function makeProfileFace(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle {
  const edges = profileEdges(kernel, plane, entity, created);
  const wire = kernel.makeWire(edges);
  created.push(wire);
  const face = kernel.makeFace(wire);
  created.push(face);
  return face;
}

function makePathWire(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle {
  const edges = pathEdges(kernel, plane, entity, created);
  if (edges.length === 0) throw new Error("路径太短");
  const wire = kernel.makeWire(edges);
  created.push(wire);
  return wire;
}

function pathEdges(kernel: OcctKernel, plane: PlaneFrame, entity: SketchEntity, created: ShapeHandle[]): ShapeHandle[] {
  if (entity.type === "line") {
    const edge = kernel.makeLineEdge(toWorld(plane, entity.a), toWorld(plane, entity.b));
    created.push(edge);
    return [edge];
  }
  if (entity.type === "spline") {
    if (entity.points.length < 2) throw new Error("样条至少需要两个点");
    const edge = kernel.interpolatePoints(entity.points.map((point) => toWorld(plane, point)), false);
    created.push(edge);
    return [edge];
  }
  if (entity.type === "polyline" && !entity.closed) {
    if (entity.points.length < 2) throw new Error("路径太短");
    const world = entity.points.map((point) => toWorld(plane, point));
    const edges: ShapeHandle[] = [];
    for (let index = 0; index < world.length - 1; index += 1) {
      const edge = kernel.makeLineEdge(world[index], world[index + 1]);
      created.push(edge);
      edges.push(edge);
    }
    return edges;
  }
  return profileEdges(kernel, plane, entity, created);
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
  if (entity.type !== "arc") throw new Error("这条曲线不能当封闭截面");
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
