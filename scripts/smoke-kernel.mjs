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

kernel[Symbol.dispose]();
await server.close();
console.log("kernel smoke ok");
