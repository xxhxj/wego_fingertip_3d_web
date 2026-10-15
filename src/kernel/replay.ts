import { BooleanOp, JoinType, type OcctKernel, type ShapeHandle } from "occt-wasm";
import { meshesTo3mf, meshesToObj } from "../export/mesh";
import { normalize } from "../model/math";
import type { EdgeRef, FaceRef, Feature, PlaneFrame, SketchEntity, Vec3 } from "../model/types";
import { makeExtrudedShape, makeLoftShape, makeRevolvedShape, makeSweepShape, measureVolume, tessellateShape, type BuildResult, type MeshOptions } from "./build";
import type { ReplayPreview, ReplayRequest } from "./protocol";

/**
 * 按特征顺序重建全部实体。圆角、布尔和移动都作用在上一步留下的形状上，
 * 所以不能再把每个拉伸单独求一次。网格拷贝完成后再释放句柄。
 */
export function replayModel(kernel: OcctKernel, request: ReplayRequest): BuildResult[] {
  const created: ShapeHandle[] = [];
  const results: BuildResult[] = [];
  try {
    const built = buildShapeMap(kernel, request, created);
    results.push(...built.errors);
    if (request.preview) {
      try {
        const shape = previewShape(kernel, request, request.preview, created, built.shapes);
        results.push(tessellateShape(kernel, "__preview__", shape, "preview"));
      } catch (error) {
        results.push({ id: "__preview__", error: messageOf(error) });
      }
    }
    for (const body of request.bodies) {
      const shape = built.shapes.get(body.id);
      if (!shape) continue;
      try {
        const meshOptions: MeshOptions = {};
        if ((body.deflection ?? 0) > 0) meshOptions.linearDeflection = body.deflection;
        if ((body.faceDeflection ?? 0) > 0 && body.faceDirection) {
          meshOptions.face = { direction: body.faceDirection, linearDeflection: body.faceDeflection ?? 0.08 };
        }
        results.push(tessellateShape(kernel, body.id, shape, "final", meshOptions));
      } catch (error) {
        results.push({ id: body.id, error: messageOf(error) });
      }
    }
    return results;
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

function applyFeature(
  kernel: OcctKernel,
  request: ReplayRequest,
  feature: Feature,
  shapes: Map<string, ShapeHandle>,
  created: ShapeHandle[],
): void {
  if (feature.type === "extrude") {
    const located = locate(request, feature.sketchId, feature.entityId);
    const solid = makeExtrudedShape(kernel, located.plane, located.entity, {
      start: feature.start,
      end: feature.end,
      wall: feature.wall,
      sheet: feature.sheet,
      draftAngle: feature.draftAngle,
    }, created);
    shapes.set(feature.bodyId, solid);
    return;
  }
  if (feature.type === "revolve") {
    const located = locate(request, feature.sketchId, feature.entityId);
    const spun = makeRevolvedShape(kernel, located.plane, located.entity, feature.axis, feature.angleDeg, created);
    if (feature.operation === "new" || !feature.targetBodyId) {
      shapes.set(feature.bodyId, spun);
      return;
    }
    const base = requireShape(shapes, feature.targetBodyId);
    const result = feature.operation === "fuse" ? kernel.fuse(base, spun) : kernel.cut(base, spun);
    created.push(result);
    shapes.set(feature.targetBodyId, result);
    return;
  }
  if (feature.type === "boolean") {
    const base = requireShape(shapes, feature.targetBodyId);
    const tool = requireShape(shapes, feature.toolBodyId);
    const fuzzy = feature.fuzzy ?? 0;
    if (fuzzy > 1e-6) {
      const op = feature.operation === "fuse" ? BooleanOp.Fuse : feature.operation === "cut" ? BooleanOp.Cut : BooleanOp.Common;
      const evolved = kernel.booleanOp(op, [base], [tool], { fuzzyValue: fuzzy });
      created.push(evolved.result);
      shapes.set(feature.targetBodyId, evolved.result);
      return;
    }
    const result = feature.operation === "fuse"
      ? kernel.fuse(base, tool)
      : feature.operation === "cut"
        ? kernel.cut(base, tool)
        : kernel.common(base, tool);
    created.push(result);
    shapes.set(feature.targetBodyId, result);
    return;
  }
  if (feature.type === "fillet" || feature.type === "chamfer") {
    const size = feature.type === "fillet" ? feature.radius : feature.distance;
    const refs = feature.type === "fillet" ? feature.edges : null;
    const result = blendEdges(kernel, requireShape(shapes, feature.bodyId), size, feature.type, refs ?? null, created);
    shapes.set(feature.bodyId, result);
    return;
  }
  if (feature.type === "step") {
    const imported = kernel.importStep(feature.step);
    created.push(imported);
    shapes.set(feature.bodyId, imported);
    return;
  }
  if (feature.type === "shell") {
    const result = hollow(kernel, requireShape(shapes, feature.bodyId), feature.thickness, feature.direction, created);
    shapes.set(feature.bodyId, result);
    return;
  }
  if (feature.type === "move") {
    const source = requireShape(shapes, feature.bodyId);
    if (feature.copy) {
      if (!feature.newBodyId) throw new Error("复制没有目标实体");
      const copied = kernel.copy(source);
      created.push(copied);
      const moved = kernel.translate(copied, feature.dx, feature.dy, feature.dz);
      created.push(moved);
      shapes.set(feature.newBodyId, moved);
      return;
    }
    const moved = kernel.translate(source, feature.dx, feature.dy, feature.dz);
    created.push(moved);
    shapes.set(feature.bodyId, moved);
    return;
  }
  if (feature.type === "mirror") {
    const plane = request.planes.find((item) => item.id === feature.planeId);
    if (!plane) throw new Error("镜像平面不存在");
    const copied = kernel.copy(requireShape(shapes, feature.bodyId));
    created.push(copied);
    const mirrored = kernel.mirror(copied, plane.origin, normalize(plane.normal));
    created.push(mirrored);
    shapes.set(feature.newBodyId, mirrored);
    return;
  }
  if (feature.type === "sweep") {
    const profile = locate(request, feature.profileSketchId, feature.profileEntityId);
    const path = locate(request, feature.pathSketchId, feature.pathEntityId);
    const solid = makeSweepShape(kernel, profile.plane, profile.entity, path.plane, path.entity, created);
    shapes.set(feature.bodyId, solid);
    return;
  }
  if (feature.type === "loft") {
    const profiles = feature.profiles.map((profile) => locate(request, profile.sketchId, profile.entityId));
    const solid = makeLoftShape(kernel, profiles, feature.ruled, created);
    shapes.set(feature.bodyId, solid);
    return;
  }
  if (feature.type === "push") {
    const result = pushFace(kernel, requireShape(shapes, feature.bodyId), feature.face, feature.distance, created);
    shapes.set(feature.bodyId, result);
    return;
  }
  if (feature.type === "split") {
    splitBody(kernel, request, feature, shapes, created);
    return;
  }
  if (feature.type === "linearPattern") {
    if (feature.count < 2) throw new Error("阵列数量至少为 2");
    if (feature.spacing <= 0) throw new Error("阵列间距需要大于 0");
    const result = kernel.linearPattern(
      requireShape(shapes, feature.bodyId),
      normalize(feature.direction),
      feature.spacing,
      Math.round(feature.count),
    );
    created.push(result);
    shapes.set(feature.bodyId, result);
    return;
  }
  const count = Math.round(feature.count);
  if (count < 2) throw new Error("阵列数量至少为 2");
  const result = kernel.circularPattern(
    requireShape(shapes, feature.bodyId),
    feature.center,
    normalize(feature.axis),
    (feature.angleDeg * Math.PI) / 180,
    count,
  );
  created.push(result);
  shapes.set(feature.bodyId, result);
}

function previewShape(
  kernel: OcctKernel,
  request: ReplayRequest,
  preview: ReplayPreview,
  created: ShapeHandle[],
  shapes: Map<string, ShapeHandle>,
): ShapeHandle {
  if (preview.kind === "push") {
    const shape = shapes.get(preview.bodyId);
    if (!shape) throw new Error("目标实体还没有生成");
    return pushFace(kernel, shape, preview.face, preview.distance, created);
  }
  const located = locate(request, preview.sketchId, preview.entityId);
  if (preview.kind === "extrude") {
    return makeExtrudedShape(kernel, located.plane, preview.entityOverride ?? located.entity, {
      start: preview.start,
      end: preview.end,
      wall: 0,
      sheet: false,
      draftAngle: 0,
    }, created);
  }
  return makeRevolvedShape(kernel, located.plane, located.entity, preview.axis, preview.angleDeg, created);
}

function locate(request: ReplayRequest, sketchId: string, entityId: string): { plane: PlaneFrame; entity: SketchEntity } {
  const sketch = request.sketches.find((item) => item.id === sketchId);
  const entity = sketch?.entities.find((item) => item.id === entityId);
  const plane = request.planes.find((item) => item.id === sketch?.planeId);
  if (!sketch || !entity || !plane) throw new Error("截面已丢失");
  return { plane, entity };
}

function requireShape(shapes: Map<string, ShapeHandle>, bodyId: string): ShapeHandle {
  const shape = shapes.get(bodyId);
  if (!shape) throw new Error("目标实体还没有生成");
  return shape;
}

function blendEdges(
  kernel: OcctKernel,
  shape: ShapeHandle,
  size: number,
  kind: "fillet" | "chamfer",
  refs: EdgeRef[] | null,
  created: ShapeHandle[],
): ShapeHandle {
  if (!(size > 0.05)) throw new Error(kind === "fillet" ? "圆角半径太小" : "倒角距离太小");
  const solid = primarySolid(kernel, shape, created);
  const original = refs && refs.length > 0
    ? matchEdges(kernel, solid, refs, created)
    : take(kernel, solid, "edge", created);
  if (original.length === 0) throw new Error(kind === "fillet" ? "没有可圆角的边" : "没有可倒角的边");
  const blend = (target: ShapeHandle, edges: ShapeHandle[]) => (
    kind === "fillet" ? kernel.fillet(target, edges, size) : kernel.chamfer(target, edges, size)
  );
  try {
    const result = blend(solid, original);
    created.push(result);
    return result;
  } catch {
    let current = solid;
    let applied = 0;
    for (let pass = 0; pass < original.length; pass += 1) {
      const edges = take(kernel, current, "edge", created);
      let next: ShapeHandle | null = null;
      for (const edge of edges) {
        try {
          next = blend(current, [edge]);
          break;
        } catch {
          next = null;
        }
      }
      if (!next) break;
      created.push(next);
      current = next;
      applied += 1;
    }
    if (applied === 0) throw new Error(kind === "fillet" ? "圆角失败" : "倒角失败");
    return current;
  }
}

function hollow(kernel: OcctKernel, shape: ShapeHandle, thickness: number, direction: Vec3, created: ShapeHandle[]): ShapeHandle {
  if (!(thickness > 0.05)) throw new Error("抽壳厚度太小");
  const solid = primarySolid(kernel, shape, created);
  const face = openingFace(kernel, solid, direction, created);
  const result = kernel.shell(solid, [face], thickness, 1e-6, JoinType.Intersection);
  created.push(result);
  return result;
}

function openingFace(kernel: OcctKernel, solid: ShapeHandle, direction: Vec3, created: ShapeHandle[]): ShapeHandle {
  const faces = take(kernel, solid, "face", created);
  if (faces.length === 0) throw new Error("没有可开口的面");
  const dir = normalize(direction);
  let best = faces[0];
  let bestDot = -2;
  for (const face of faces) {
    try {
      const bounds = kernel.uvBounds(face);
      const normal = kernel.surfaceNormal(face, (bounds.uMin + bounds.uMax) / 2, (bounds.vMin + bounds.vMax) / 2);
      const score = normal.x * dir.x + normal.y * dir.y + normal.z * dir.z;
      if (score > bestDot) {
        bestDot = score;
        best = face;
      }
    } catch {
      // 这个面读不到法向时换下一个。
    }
  }
  return best;
}

function primarySolid(kernel: OcctKernel, shape: ShapeHandle, created: ShapeHandle[]): ShapeHandle {
  const solids = take(kernel, shape, "solid", created);
  if (solids.length <= 1) return solids[0] ?? shape;
  let acc = solids[0];
  for (let index = 1; index < solids.length; index += 1) {
    acc = kernel.fuse(acc, solids[index]);
    created.push(acc);
  }
  return acc;
}

function take(
  kernel: OcctKernel,
  shape: ShapeHandle,
  type: "edge" | "face" | "solid",
  created: ShapeHandle[],
): ShapeHandle[] {
  const handles = kernel.getSubShapes(shape, type);
  created.push(...handles);
  return handles;
}

function buildShapeMap(
  kernel: OcctKernel,
  request: ReplayRequest,
  created: ShapeHandle[],
): { shapes: Map<string, ShapeHandle>; errors: BuildResult[] } {
  const shapes = new Map<string, ShapeHandle>();
  const errors: BuildResult[] = [];
  for (const feature of request.features) {
    try {
      applyFeature(kernel, request, feature, shapes, created);
    } catch (error) {
      errors.push({ id: feature.id, error: messageOf(error) });
    }
  }
  return { shapes, errors };
}

export function exportStepModel(kernel: OcctKernel, request: ReplayRequest, bodyId: string | null): string {
  const created: ShapeHandle[] = [];
  try {
    const { shapes } = buildShapeMap(kernel, request, created);
    const chosen = bodyId
      ? [shapes.get(bodyId)].filter((shape): shape is ShapeHandle => shape != null)
      : [...shapes.values()];
    if (chosen.length === 0) throw new Error("没有可导出的实体");
    if (chosen.length === 1) return kernel.exportStep(chosen[0]);
    const compound = kernel.makeCompound(chosen);
    created.push(compound);
    return kernel.exportStep(compound);
  } finally {
    releaseAll(kernel, created);
  }
}

export type ModelExportFormat = "step" | "stl" | "obj" | "glb" | "brep" | "svg" | "3mf";

export type ModelExportFile =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array };

export function exportFileModel(
  kernel: OcctKernel,
  request: ReplayRequest,
  bodyId: string | null,
  format: ModelExportFormat,
): ModelExportFile {
  const created: ShapeHandle[] = [];
  let document: { close: () => void } | null = null;
  try {
    const { shapes } = buildShapeMap(kernel, request, created);
    const chosen = chosenShapes(request, shapes, bodyId);
    const shape = chosen.length === 1 ? chosen[0].shape : kernel.makeCompound(chosen.map((item) => item.shape));
    if (chosen.length > 1) created.push(shape);
    if (format === "step") return { kind: "text", text: kernel.exportStep(shape) };
    if (format === "brep") return { kind: "text", text: kernel.toBREP(shape) };
    if (format === "svg") return { kind: "text", text: kernel.toMultiviewSVG(shape) };
    if (format === "stl") return { kind: "binary", bytes: copyBytes(kernel.exportStl(shape, 0.15)) };
    if (format === "obj" || format === "3mf") {
      const parts = chosen.map((item) => ({ name: item.name, mesh: kernel.meshShape(item.shape, { linearDeflection: 0.15, angularDeflection: 0.4 }) }));
      return format === "obj"
        ? { kind: "text", text: meshesToObj(parts) }
        : { kind: "binary", bytes: meshesTo3mf(parts) };
    }
    const xcaf = kernel.createXCAFDocument();
    document = xcaf;
    for (const item of chosen) {
      xcaf.addShape(item.shape, { name: item.name, color: colorOf(item.color) });
    }
    return { kind: "binary", bytes: copyBytes(xcaf.exportGLTF({ linearDeflection: 0.15 })) };
  } finally {
    document?.close();
    releaseAll(kernel, created);
  }
}

function chosenShapes(
  request: ReplayRequest,
  shapes: Map<string, ShapeHandle>,
  bodyId: string | null,
): { shape: ShapeHandle; name: string; color: string }[] {
  const ids = bodyId
    ? [bodyId]
    : request.bodies.filter((body) => body.visible).map((body) => body.id);
  const chosen = ids.flatMap((id) => {
    const shape = shapes.get(id);
    if (!shape) return [];
    const body = request.bodies.find((item) => item.id === id);
    return [{ shape, name: body?.name || id, color: body?.color || "#b7c6d0" }];
  });
  if (chosen.length === 0) throw new Error("没有可导出的实体");
  return chosen;
}

function colorOf(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [0.72, 0.78, 0.82];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function copyBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

function pushFace(
  kernel: OcctKernel,
  shape: ShapeHandle,
  faceRef: FaceRef,
  distance: number,
  created: ShapeHandle[],
): ShapeHandle {
  if (!(Math.abs(distance) > 0.05)) throw new Error("推拉距离太小");
  const solid = primarySolid(kernel, shape, created);
  const face = matchFace(kernel, solid, faceRef, created);
  const normal = normalize(faceRef.normal);
  const prism = kernel.extrude(face, normal.x * distance, normal.y * distance, normal.z * distance);
  created.push(prism);
  const result = distance > 0 ? kernel.fuse(solid, prism) : kernel.cut(solid, prism);
  created.push(result);
  return result;
}

function splitBody(
  kernel: OcctKernel,
  request: ReplayRequest,
  feature: Extract<Feature, { type: "split" }>,
  shapes: Map<string, ShapeHandle>,
  created: ShapeHandle[],
): void {
  const plane = request.planes.find((item) => item.id === feature.planeId);
  if (!plane) throw new Error("分割平面不存在");
  const solid = primarySolid(kernel, requireShape(shapes, feature.bodyId), created);
  const normal = normalize(plane.normal);
  const positiveTool = kernel.halfSpace(plane.origin, normal);
  const negativeTool = kernel.halfSpace(plane.origin, { x: -normal.x, y: -normal.y, z: -normal.z });
  created.push(positiveTool, negativeTool);
  const positive = kernel.common(solid, positiveTool);
  const negative = kernel.common(solid, negativeTool);
  created.push(positive, negative);
  const positiveVolume = measureVolume(kernel, positive);
  const negativeVolume = measureVolume(kernel, negative);
  if (feature.keep === "both" && (positiveVolume < 1e-3 || negativeVolume < 1e-3)) throw new Error("平面没有切开实体");
  if (feature.keep === "positive") {
    if (positiveVolume < 1e-3) throw new Error("法向一侧没有实体");
    shapes.set(feature.bodyId, positive);
    return;
  }
  if (feature.keep === "negative") {
    if (negativeVolume < 1e-3) throw new Error("反法向一侧没有实体");
    shapes.set(feature.bodyId, negative);
    return;
  }
  if (!feature.newBodyId) throw new Error("分割没有另一侧实体");
  shapes.set(feature.bodyId, positive);
  shapes.set(feature.newBodyId, negative);
}

function matchFace(kernel: OcctKernel, solid: ShapeHandle, faceRef: FaceRef, created: ShapeHandle[]): ShapeHandle {
  const faces = take(kernel, solid, "face", created);
  const dir = normalize(faceRef.normal);
  let best = faces[0];
  let bestScore = Infinity;
  for (const face of faces) {
    let center = faceRef.midpoint;
    try {
      center = kernel.getCenterOfMass(face);
    } catch {
      center = faceRef.midpoint;
    }
    const distance = Math.hypot(center.x - faceRef.midpoint.x, center.y - faceRef.midpoint.y, center.z - faceRef.midpoint.z);
    let align = 1;
    try {
      const bounds = kernel.uvBounds(face);
      const normal = kernel.surfaceNormal(face, (bounds.uMin + bounds.uMax) / 2, (bounds.vMin + bounds.vMax) / 2);
      align = 1 - (normal.x * dir.x + normal.y * dir.y + normal.z * dir.z);
    } catch {
      align = 1;
    }
    const score = distance + Math.max(0, align) * 25;
    if (score < bestScore) {
      bestScore = score;
      best = face;
    }
  }
  if (!best || bestScore > 40) throw new Error("找不到对应的面");
  return best;
}

export function pickFaceOnBody(kernel: OcctKernel, request: ReplayRequest, bodyId: string, point: Vec3): FaceRef {
  const created: ShapeHandle[] = [];
  try {
    const { shapes } = buildShapeMap(kernel, request, created);
    const shape = shapes.get(bodyId);
    if (!shape) throw new Error("目标实体还没有生成");
    const solid = primarySolid(kernel, shape, created);
    const faces = take(kernel, solid, "face", created);
    let best: FaceRef | null = null;
    let bestDistance = Infinity;
    for (const face of faces) {
      let projected: Vec3;
      try {
        projected = kernel.projectPointOnFace(face, point);
      } catch {
        continue;
      }
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y, projected.z - point.z);
      if (distance >= bestDistance) continue;
      const bounds = kernel.uvBounds(face);
      const normal = kernel.surfaceNormal(face, (bounds.uMin + bounds.uMax) / 2, (bounds.vMin + bounds.vMax) / 2);
      bestDistance = distance;
      best = { midpoint: kernel.getCenterOfMass(face), normal: normalize(normal) };
    }
    if (!best || bestDistance > 5) throw new Error("没有点到面");
    return best;
  } finally {
    releaseAll(kernel, created);
  }
}

export function pickEdgeOnBody(kernel: OcctKernel, request: ReplayRequest, bodyId: string, point: Vec3): EdgeRef {
  const created: ShapeHandle[] = [];
  try {
    const { shapes } = buildShapeMap(kernel, request, created);
    const shape = shapes.get(bodyId);
    if (!shape) throw new Error("目标实体还没有生成");
    const solid = primarySolid(kernel, shape, created);
    const edges = take(kernel, solid, "edge", created);
    let best: EdgeRef | null = null;
    let bestDistance = Infinity;
    for (const edge of edges) {
      const ref = signatureOf(kernel, edge);
      const distance = Math.hypot(ref.midpoint.x - point.x, ref.midpoint.y - point.y, ref.midpoint.z - point.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = ref;
      }
    }
    if (!best) throw new Error("没有可选择的边");
    return best;
  } finally {
    releaseAll(kernel, created);
  }
}

function matchEdges(kernel: OcctKernel, solid: ShapeHandle, refs: EdgeRef[], created: ShapeHandle[]): ShapeHandle[] {
  const edges = take(kernel, solid, "edge", created);
  const known = edges.map((edge) => ({ edge, ref: signatureOf(kernel, edge) }));
  const chosen: ShapeHandle[] = [];
  for (const wanted of refs) {
    let best: { edge: ShapeHandle; ref: EdgeRef } | null = null;
    let bestScore = Infinity;
    for (const item of known) {
      const distance = Math.hypot(
        item.ref.midpoint.x - wanted.midpoint.x,
        item.ref.midpoint.y - wanted.midpoint.y,
        item.ref.midpoint.z - wanted.midpoint.z,
      );
      const score = distance + Math.abs(item.ref.length - wanted.length) * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    const limit = Math.max(1.5, wanted.length * 0.08);
    if (!best || bestScore > limit) throw new Error("找不到对应的边");
    chosen.push(best.edge);
  }
  return chosen;
}

function signatureOf(kernel: OcctKernel, edge: ShapeHandle): EdgeRef {
  const box = kernel.getBoundingBox(edge);
  const seed = {
    x: (box.xmin + box.xmax) / 2,
    y: (box.ymin + box.ymax) / 2,
    z: (box.zmin + box.zmax) / 2,
  };
  let midpoint = seed;
  let direction = { x: 0, y: 0, z: 1 };
  try {
    const projected = kernel.projectPointOnEdge(edge, seed);
    midpoint = projected.point;
    direction = normalize(projected.tangent);
  } catch {
    midpoint = seed;
  }
  let length = 0;
  try {
    length = kernel.curveLength(edge);
  } catch {
    length = Math.hypot(box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin);
  }
  return { midpoint, direction, length };
}

function releaseAll(kernel: OcctKernel, created: ShapeHandle[]): void {
  for (let index = created.length - 1; index >= 0; index -= 1) {
    try {
      kernel.release(created[index]);
    } catch {
      // 句柄已经释放时忽略。
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error);
  return text && text !== "[object Object]" ? text : "建模失败";
}
