import { createServer } from "vite";
import { OcctKernel } from "occt-wasm";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { exclude: ["occt-wasm"] },
});

const { buildExtrusion } = await server.ssrLoadModule("/src/kernel/build.ts");
const kernel = await OcctKernel.init();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(actual, expected, message) {
  assert(Math.abs(actual - expected) / expected < 0.02, `${message}: ${actual} vs ${expected}`);
}

const xy = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir: { x: 1, y: 0, z: 0 },
};
const box = buildExtrusion(kernel, {
  id: "box",
  plane: xy,
  entity: { id: "r", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } },
  start: 0,
  end: 20,
  quality: "final",
});
assert(box.positions?.length > 0, "矩形拉伸没有网格");
assert(box.edges.length > 0, "矩形拉伸没有边线");
near(box.volume, 20000, "矩形体积");

const shifted = buildExtrusion(kernel, {
  id: "shifted",
  plane: xy,
  entity: { id: "r", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } },
  start: 5,
  end: 20,
  quality: "preview",
});
near(shifted.volume, 15000, "双向起止距离");

const both = buildExtrusion(kernel, {
  id: "both",
  plane: xy,
  entity: { id: "r", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } },
  start: -10,
  end: 10,
  quality: "final",
});
near(both.volume, 20000, "反向拉伸");

const cylinder = buildExtrusion(kernel, {
  id: "cyl",
  plane: xy,
  entity: { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 10 },
  start: 0,
  end: 5,
  quality: "final",
});
near(cylinder.volume, Math.PI * 100 * 5, "圆柱体积");

const xz = buildExtrusion(kernel, {
  id: "xz",
  plane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: -1, z: 0 }, xDir: { x: 1, y: 0, z: 0 } },
  entity: { id: "r", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 20 } },
  start: 0,
  end: 15,
  quality: "final",
});
near(xz.volume, 3000, "XZ 平面拉伸");

const arc = buildExtrusion(kernel, {
  id: "arc",
  plane: xy,
  entity: { id: "a", type: "arc", start: { x: 0, y: 0 }, mid: { x: 10, y: 8 }, end: { x: 20, y: 0 } },
  start: 0,
  end: 8,
  quality: "final",
});
assert(arc.volume > 100, "圆弧截面没有体积");

const tiny = buildExtrusion(kernel, {
  id: "tiny",
  plane: xy,
  entity: { id: "r", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
  start: 0,
  end: 0,
  quality: "final",
});
assert(tiny.error === "拉伸距离太小", "零距离应被拒绝");

const { replayModel, exportStepModel, pickEdgeOnBody } = await server.ssrLoadModule("/src/kernel/replay.ts");
const { resolveDocumentPlanes } = await server.ssrLoadModule("/src/model/planes.ts");
const planes = [
  { id: "plane-xy", name: "XY", kind: "principal", origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
  { id: "plane-yz", name: "YZ", kind: "principal", origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, xDir: { x: 0, y: 1, z: 0 } },
];

function solidBody(id, featureId) {
  return { id, name: id, color: "#2f6fed", visible: true, featureId };
}

function play(features, bodies, sketches) {
  return replayModel(kernel, {
    planes,
    sketches: sketches ?? [{
      id: "sk",
      name: "草图",
      planeId: "plane-xy",
      entities: [
        { id: "a", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 20, y: 20 } },
        { id: "b", type: "rectangle", a: { x: 10, y: 0 }, b: { x: 30, y: 20 } },
        { id: "ring", type: "rectangle", a: { x: 0, y: 10 }, b: { x: 20, y: 30 } },
        { id: "wide", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } },
        { id: "offset", type: "rectangle", a: { x: 30, y: 0 }, b: { x: 50, y: 20 } },
      ],
    }],
    features,
    bodies,
    preview: null,
  });
}

function meshOf(results, id) {
  const found = results.find((item) => item.id === id);
  if (!found) throw new Error(`${id} 没有结果`);
  if (found.error) throw new Error(`${id}: ${found.error}`);
  return found;
}

function failed(results, id) {
  return results.find((item) => item.id === id && item.error)?.error;
}

const boxFeature = (id, entityId, bodyId, extra = {}) => ({
  id,
  type: "extrude",
  name: id,
  sketchId: "sk",
  entityId,
  start: 0,
  end: 20,
  bodyId,
  wall: 0,
  sheet: false,
  draftAngle: 0,
  ...extra,
});

const fused = play(
  [
    boxFeature("ea", "a", "ba"),
    boxFeature("eb", "b", "bb"),
    { id: "fuse", type: "boolean", name: "并集", operation: "fuse", targetBodyId: "ba", toolBodyId: "bb" },
  ],
  [solidBody("ba", "ea"), solidBody("bb", "eb")],
);
near(meshOf(fused, "ba").volume, 12000, "并集体积");
assert(!failed(fused, "fuse"), `并集报错 ${failed(fused, "fuse")}`);

const cut = play(
  [
    boxFeature("ea", "a", "ba"),
    boxFeature("eb", "b", "bb"),
    { id: "cut", type: "boolean", name: "差集", operation: "cut", targetBodyId: "ba", toolBodyId: "bb" },
  ],
  [solidBody("ba", "ea"), solidBody("bb", "eb")],
);
near(meshOf(cut, "ba").volume, 4000, "差集体积");

const common = play(
  [
    boxFeature("ea", "a", "ba"),
    boxFeature("eb", "b", "bb"),
    { id: "common", type: "boolean", name: "交集", operation: "common", targetBodyId: "ba", toolBodyId: "bb" },
  ],
  [solidBody("ba", "ea"), solidBody("bb", "eb")],
);
near(meshOf(common, "ba").volume, 4000, "交集体积");

const spun = play(
  [{
    id: "rev",
    type: "revolve",
    name: "旋转",
    sketchId: "sk",
    entityId: "ring",
    axis: "u",
    angleDeg: 360,
    operation: "new",
    targetBodyId: null,
    bodyId: "br",
  }],
  [solidBody("br", "rev")],
);
near(meshOf(spun, "br").volume, 400 * 2 * Math.PI * 20, "旋转体积");

const rounded = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "fillet", type: "fillet", name: "圆角", bodyId: "ba", radius: 2 },
  ],
  [solidBody("ba", "ea")],
);
assert(!failed(rounded, "fillet"), `圆角报错 ${failed(rounded, "fillet")}`);
const filletVolume = meshOf(rounded, "ba").volume;
assert(filletVolume < 7900 && filletVolume > 4000, `圆角体积 ${filletVolume}`);

const chamfered = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "chamfer", type: "chamfer", name: "倒角", bodyId: "ba", distance: 2 },
  ],
  [solidBody("ba", "ea")],
);
assert(!failed(chamfered, "chamfer"), `倒角报错 ${failed(chamfered, "chamfer")}`);
const chamferVolume = meshOf(chamfered, "ba").volume;
assert(chamferVolume < 7900 && chamferVolume > 4000, `倒角体积 ${chamferVolume}`);

const shelled = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "shell", type: "shell", name: "抽壳", bodyId: "ba", thickness: 2, direction: { x: 0, y: 0, z: 1 } },
  ],
  [solidBody("ba", "ea")],
);
assert(!failed(shelled, "shell"), `抽壳报错 ${failed(shelled, "shell")}`);
near(meshOf(shelled, "ba").volume, 8000 - 16 * 16 * 18, "抽壳体积");

const moved = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "move", type: "move", name: "移动", bodyId: "ba", dx: 100, dy: 0, dz: 0, copy: false, newBodyId: null },
  ],
  [solidBody("ba", "ea")],
);
near(meshOf(moved, "ba").volume, 8000, "移动后体积");
const movedMax = maxAxis(meshOf(moved, "ba").positions, 0);
assert(movedMax > 110 && movedMax < 130, `移动后 X ${movedMax}`);

const copied = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "copy", type: "move", name: "复制", bodyId: "ba", dx: 40, dy: 0, dz: 0, copy: true, newBodyId: "bc" },
  ],
  [solidBody("ba", "ea"), solidBody("bc", "copy")],
);
near(meshOf(copied, "ba").volume, 8000, "复制后源体积");
near(meshOf(copied, "bc").volume, 8000, "复制体体积");

const mirrored = play(
  [
    boxFeature("ea", "a", "ba"),
    { id: "mirror", type: "mirror", name: "镜像", bodyId: "ba", planeId: "plane-yz", newBodyId: "bm" },
  ],
  [solidBody("ba", "ea"), solidBody("bm", "mirror")],
);
near(meshOf(mirrored, "bm").volume, 8000, "镜像体积");
const mirrorMin = minAxis(meshOf(mirrored, "bm").positions, 0);
assert(mirrorMin < -10, `镜像应到 X 负侧 ${mirrorMin}`);

const linear = play(
  [
    boxFeature("ea", "offset", "ba"),
    { id: "linear", type: "linearPattern", name: "线性", bodyId: "ba", direction: { x: 1, y: 0, z: 0 }, spacing: 40, count: 3 },
  ],
  [solidBody("ba", "ea")],
);
const linearVolume = meshOf(linear, "ba").volume;
near(linearVolume, 24000, "线性阵列含种子，共 3 个");

const circular = play(
  [
    boxFeature("ea", "offset", "ba"),
    { id: "circular", type: "circularPattern", name: "圆周", bodyId: "ba", center: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, angleDeg: 90, count: 4 },
  ],
  [solidBody("ba", "ea")],
);
const circularVolume = meshOf(circular, "ba").volume;
near(circularVolume, 32000, "圆周阵列含种子，间隔 90°");

const walled = play(
  [boxFeature("ew", "wide", "bw", { wall: 2 })],
  [solidBody("bw", "ew")],
);
const wallVolume = meshOf(walled, "bw").volume;
near(wallVolume, (40 * 25 - 36 * 21) * 20, "薄壁体积");

const sheet = play(
  [boxFeature("es", "a", "bs", { sheet: true })],
  [solidBody("bs", "es")],
);
assert(meshOf(sheet, "bs").positions.length > 0, "片体没有网格");
assert(meshOf(sheet, "bs").volume === 0, "片体不应有实体体积");

const drafted = play(
  [boxFeature("ed", "a", "bd", { draftAngle: 8 })],
  [solidBody("bd", "ed")],
);
assert(!failed(drafted, "ed"), `拔模报错 ${failed(drafted, "ed")}`);
near(meshOf(drafted, "bd").volume, 5962, "拔模体积");

const fuzzy = play(
  [
    boxFeature("ea", "a", "ba"),
    boxFeature("eb", "b", "bb"),
    { id: "fuse", type: "boolean", name: "并集", operation: "fuse", targetBodyId: "ba", toolBodyId: "bb", fuzzy: 0.2 },
  ],
  [solidBody("ba", "ea"), solidBody("bb", "eb")],
);
assert(!failed(fuzzy, "fuse"), `缝合报错 ${failed(fuzzy, "fuse")}`);
near(meshOf(fuzzy, "ba").volume, 12000, "带公差的并集");

const cylinderSketch = [{
  id: "sk",
  name: "草图",
  planeId: "plane-xy",
  entities: [{ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 10 }],
}];
const coarse = play(
  [boxFeature("ec", "c", "bc")],
  [{ ...solidBody("bc", "ec"), deflection: 1.5 }],
  cylinderSketch,
);
const fine = play(
  [boxFeature("ec", "c", "bc")],
  [{ ...solidBody("bc", "ec"), deflection: 1.5, faceDeflection: 0.03, faceDirection: { x: -1, y: 0, z: 0 } }],
  cylinderSketch,
);
assert(meshOf(fine, "bc").indices.length > meshOf(coarse, "bc").indices.length, "单面加密应增加三角面");

const stepSource = play([boxFeature("ea", "a", "ba")], [solidBody("ba", "ea")]);
const stepText = exportStepModel(kernel, {
  planes,
  sketches: [{
    id: "sk",
    name: "草图",
    planeId: "plane-xy",
    entities: [
      { id: "a", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 20, y: 20 } },
      { id: "b", type: "rectangle", a: { x: 10, y: 0 }, b: { x: 30, y: 20 } },
      { id: "ring", type: "rectangle", a: { x: 0, y: 10 }, b: { x: 20, y: 30 } },
      { id: "wide", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } },
      { id: "offset", type: "rectangle", a: { x: 30, y: 0 }, b: { x: 50, y: 20 } },
    ],
  }],
  features: [boxFeature("ea", "a", "ba")],
  bodies: [solidBody("ba", "ea")],
  preview: null,
}, "ba");
assert(stepText.includes("ISO-10303-21"), "STEP 头");
assert(meshOf(stepSource, "ba").volume > 0, "导出前实体存在");
const imported = play(
  [{ id: "step", type: "step", name: "导入", bodyId: "bs", step: stepText }],
  [solidBody("bs", "step")],
);
assert(!failed(imported, "step"), `STEP 导入报错 ${failed(imported, "step")}`);
near(meshOf(imported, "bs").volume, 8000, "STEP 往返体积");

const edgeModel = {
  planes,
  sketches: [{
    id: "sk",
    name: "草图",
    planeId: "plane-xy",
    entities: [{ id: "a", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 20, y: 20 } }],
  }],
  features: [boxFeature("ea", "a", "ba")],
  bodies: [solidBody("ba", "ea")],
  preview: null,
};
const edge = pickEdgeOnBody(kernel, edgeModel, "ba", { x: 10, y: 0, z: 20 });
const oneEdge = replayModel(kernel, {
  ...edgeModel,
  features: [
    boxFeature("ea", "a", "ba"),
    { id: "fillet", type: "fillet", name: "圆角", bodyId: "ba", radius: 2, edges: [edge] },
  ],
});
assert(!failed(oneEdge, "fillet"), `选边圆角报错 ${failed(oneEdge, "fillet")}`);
const oneEdgeVolume = meshOf(oneEdge, "ba").volume;
const expectedEdge = 8000 - 20 * 4 * (1 - Math.PI / 4);
assert(Math.abs(oneEdgeVolume - expectedEdge) < 8, `单边圆角 ${oneEdgeVolume} vs ${expectedEdge}`);

const movedEdge = replayModel(kernel, {
  ...edgeModel,
  features: [
    boxFeature("ea", "a", "ba"),
    { id: "move", type: "move", name: "移动", bodyId: "ba", dx: 0, dy: 0, dz: 10, copy: false, newBodyId: null },
    { id: "fillet", type: "fillet", name: "圆角", bodyId: "ba", radius: 2, edges: [{ ...edge, midpoint: { x: edge.midpoint.x, y: edge.midpoint.y, z: edge.midpoint.z + 10 } }] },
  ],
});
assert(!failed(movedEdge, "fillet"), `移动后选边报错 ${failed(movedEdge, "fillet")}`);

const planeDoc = {
  planes: [
    { id: "plane-xy", name: "XY", kind: "principal", sourceId: null, peerId: null, distance: 0, angleDeg: 0, origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
    { id: "off", name: "偏置", kind: "offset", sourceId: "plane-xy", peerId: null, distance: 15, angleDeg: 0, origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
    { id: "ang", name: "斜面", kind: "angled", sourceId: "plane-xy", peerId: null, distance: 0, angleDeg: 90, origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
    { id: "mid", name: "等分", kind: "bisect", sourceId: "plane-xy", peerId: "off", distance: 0, angleDeg: 0, origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
  ],
  sketches: [],
  features: [],
  bodies: [],
};
resolveDocumentPlanes(planeDoc);
assert(Math.abs(planeDoc.planes[1].origin.z - 15) < 1e-6, "偏置平面高度");
assert(Math.abs(planeDoc.planes[2].normal.y + 1) < 1e-6, "斜面法向");
assert(Math.abs(planeDoc.planes[3].origin.z - 7.5) < 1e-6, "等分平面高度");

const sweep = replayModel(kernel, {
  planes,
  sketches: [
    { id: "prof", name: "截面", planeId: "plane-yz", entities: [{ id: "sec", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }] },
    { id: "path", name: "路径", planeId: "plane-xy", entities: [{ id: "spine", type: "line", a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }] },
    { id: "curve", name: "样条", planeId: "plane-xy", entities: [{ id: "spl", type: "spline", points: [{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 0 }] }] },
  ],
  features: [{ id: "sw", type: "sweep", name: "扫掠", profileSketchId: "prof", profileEntityId: "sec", pathSketchId: "path", pathEntityId: "spine", bodyId: "sw" }],
  bodies: [solidBody("sw", "sw")],
  preview: null,
});
assert(!failed(sweep, "sw"), `扫掠报错 ${failed(sweep, "sw")}`);
const sweepVolume = meshOf(sweep, "sw").volume;
assert(sweepVolume > 0, "扫掠体积");
const sweepAgain = replayModel(kernel, {
  planes,
  sketches: [
    { id: "prof", name: "截面", planeId: "plane-yz", entities: [{ id: "sec", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }] },
    { id: "path", name: "路径", planeId: "plane-xy", entities: [{ id: "spine", type: "line", a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }] },
  ],
  features: [{ id: "sw", type: "sweep", name: "扫掠", profileSketchId: "prof", profileEntityId: "sec", pathSketchId: "path", pathEntityId: "spine", bodyId: "sw" }],
  bodies: [solidBody("sw", "sw")],
  preview: null,
});
assert(Math.abs(meshOf(sweepAgain, "sw").volume - sweepVolume) < 1e-4, "扫掠体积不稳定");
const splineSweep = replayModel(kernel, {
  planes,
  sketches: [
    { id: "prof", name: "截面", planeId: "plane-yz", entities: [{ id: "sec", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }] },
    { id: "curve", name: "样条", planeId: "plane-xy", entities: [{ id: "spl", type: "spline", points: [{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 0 }] }] },
  ],
  features: [{ id: "ss", type: "sweep", name: "样条扫掠", profileSketchId: "prof", profileEntityId: "sec", pathSketchId: "curve", pathEntityId: "spl", bodyId: "ss" }],
  bodies: [solidBody("ss", "ss")],
  preview: null,
});
assert(!failed(splineSweep, "ss") && meshOf(splineSweep, "ss").volume > 0, `样条扫掠失败 ${failed(splineSweep, "ss")}`);

const loftPlanes = [
  ...planes,
  { id: "high", name: "高", kind: "offset", origin: { x: 0, y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
];
const loftRequest = {
  planes: loftPlanes,
  sketches: [
    { id: "bottom", name: "下", planeId: "plane-xy", entities: [{ id: "big", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }] },
    { id: "top", name: "上", planeId: "high", entities: [{ id: "small", type: "rectangle", a: { x: 2, y: 2 }, b: { x: 8, y: 8 } }] },
  ],
  features: [{
    id: "loft",
    type: "loft",
    name: "放样",
    profiles: [{ sketchId: "bottom", entityId: "big" }, { sketchId: "top", entityId: "small" }],
    ruled: true,
    bodyId: "loft",
  }],
  bodies: [solidBody("loft", "loft")],
  preview: null,
};
const loft = replayModel(kernel, loftRequest);
assert(!failed(loft, "loft"), `放样报错 ${failed(loft, "loft")}`);
const loftVolume = meshOf(loft, "loft").volume;
assert(loftVolume > 0, "放样体积");
const loftAgain = replayModel(kernel, loftRequest);
assert(Math.abs(meshOf(loftAgain, "loft").volume - loftVolume) < 1e-4, "放样体积不稳定");

const pushed = play([
  boxFeature("ea", "a", "ba"),
  { id: "push", type: "push", name: "推拉", bodyId: "ba", distance: 5, face: { midpoint: { x: 10, y: 10, z: 20 }, normal: { x: 0, y: 0, z: 1 } } },
], [solidBody("ba", "ea")]);
assert(!failed(pushed, "push"), `推拉报错 ${failed(pushed, "push")}`);
near(meshOf(pushed, "ba").volume, 10000, "推拉后面体积");

const splitPlanes = [
  ...planes,
  { id: "cut", name: "切割", kind: "offset", origin: { x: 0, y: 0, z: 8 }, normal: { x: 0, y: 0, z: 1 }, xDir: { x: 1, y: 0, z: 0 } },
];
const split = replayModel(kernel, {
  planes: splitPlanes,
  sketches: [{ id: "sk", name: "草图", planeId: "plane-xy", entities: [{ id: "a", type: "rectangle", a: { x: 0, y: 0 }, b: { x: 20, y: 20 } }] }],
  features: [
    boxFeature("ea", "a", "ba"),
    { id: "split", type: "split", name: "分割", bodyId: "ba", planeId: "cut", keep: "both", newBodyId: "bb" },
  ],
  bodies: [solidBody("ba", "ea"), solidBody("bb", "split")],
  preview: null,
});
assert(!failed(split, "split"), `分割报错 ${failed(split, "split")}`);
const splitSum = meshOf(split, "ba").volume + meshOf(split, "bb").volume;
near(splitSum, 8000, "分割两侧体积之和");

function maxAxis(positions, offset) {
  let value = -Infinity;
  for (let index = offset; index < positions.length; index += 3) value = Math.max(value, positions[index]);
  return value;
}

function minAxis(positions, offset) {
  let value = Infinity;
  for (let index = offset; index < positions.length; index += 3) value = Math.min(value, positions[index]);
  return value;
}

kernel[Symbol.dispose]();
await server.close();
console.log("kernel smoke ok");
