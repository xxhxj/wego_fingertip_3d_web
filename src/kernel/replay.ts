import { JoinType, type OcctKernel, type ShapeHandle } from "occt-wasm";
import { normalize } from "../model/math";
import type { Feature, PlaneFrame, SketchEntity, Vec3 } from "../model/types";
import { makeExtrudedShape, makeRevolvedShape, tessellateShape, type BuildResult } from "./build";
import type { ReplayPreview, ReplayRequest } from "./protocol";

/**
 * 按特征顺序重建全部实体。圆角、布尔和移动都作用在上一步留下的形状上，
 * 所以不能再把每个拉伸单独求一次。网格拷贝完成后再释放句柄。
 */
export function replayModel(kernel: OcctKernel, request: ReplayRequest): BuildResult[] {
  const created: ShapeHandle[] = [];
  const shapes = new Map<string, ShapeHandle>();
  const results: BuildResult[] = [];
  try {
    for (const feature of request.features) {
      try {
        applyFeature(kernel, request, feature, shapes, created);
      } catch (error) {
        results.push({ id: feature.id, error: messageOf(error) });
      }
    }
    if (request.preview) {
      try {
        const shape = previewShape(kernel, request, request.preview, created);
        results.push(tessellateShape(kernel, "__preview__", shape, "preview"));
      } catch (error) {
        results.push({ id: "__preview__", error: messageOf(error) });
      }
    }
    for (const body of request.bodies) {
      const shape = shapes.get(body.id);
      if (!shape) continue;
      try {
        results.push(tessellateShape(kernel, body.id, shape, "final"));
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
    const result = blendEdges(kernel, requireShape(shapes, feature.bodyId), size, feature.type, created);
    shapes.set(feature.bodyId, result);
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
): ShapeHandle {
  const located = locate(request, preview.sketchId, preview.entityId);
  if (preview.kind === "extrude") {
    return makeExtrudedShape(kernel, located.plane, located.entity, {
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
  created: ShapeHandle[],
): ShapeHandle {
  if (!(size > 0.05)) throw new Error(kind === "fillet" ? "圆角半径太小" : "倒角距离太小");
  const solid = primarySolid(kernel, shape, created);
  const original = take(kernel, solid, "edge", created);
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

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error);
  return text && text !== "[object Object]" ? text : "建模失败";
}
