import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const port = 5199;
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});

const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("预览服务没有启动")), 20000);
  const onData = (chunk) => {
    const text = String(chunk);
    if (text.includes("Local") || text.includes(`${port}`)) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  server.on("exit", (code) => reject(new Error(`预览服务退出 ${code}`)));
});

let browser;
try {
  await ready;
  browser = process.env.BROWSER_URL
    ? await puppeteer.connect({ browserURL: process.env.BROWSER_URL })
    : await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan,WebGPU",
        "--use-angle=metal",
        "--ignore-gpu-blocklist",
      ],
    });
  const page = await browser.newPage();
  const logs = [];
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") logs.push(`console: ${message.text()}`);
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?e2e=1`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => {
    const kernel = window.__wego?.getState().kernel;
    return kernel === "ready" || kernel === "error";
  }, { timeout: 60000 });

  const booted = await page.evaluate(async () => {
    const state = window.__wego.getState();
    const adapter = await navigator.gpu?.requestAdapter();
    return {
      kernel: state.kernel,
      kernelMessage: state.kernelMessage,
      viewportMessage: state.viewportMessage,
      gpu: Boolean(adapter),
      title: document.title,
    };
  });
  if (booted.kernel !== "ready") throw new Error(`内核未就绪: ${booted.kernelMessage}`);
  if (!booted.gpu || booted.viewportMessage) throw new Error(`WebGPU 不可用: ${booted.viewportMessage || "没有适配器"}`);
  if (booted.title !== "Wego CAD") throw new Error(`标题不对: ${booted.title}`);

  await page.click("[data-dock='sketch']");
  await page.click("[data-tool='rectangle']");
  await page.evaluate(() => window.__wego.startSketch("plane-xy"));
  await page.waitForFunction(() => window.__wego.getState().doc.sketches.length === 1);

  await page.evaluate(() => {
    const sketchId = window.__wego.getState().activeSketchId;
    window.__wego.addRectangle(sketchId, { x: 0, y: 0 }, { x: 40, y: 25 });
    window.__wego.beginExtrude();
  });
  await page.waitForFunction(() => {
    const state = window.__wego.getState();
    return state.preview?.positions?.length > 0 || state.errors.__preview__;
  }, { timeout: 20000 });
  const previewError = await page.evaluate(() => window.__wego.getState().errors.__preview__);
  if (previewError) throw new Error(`预览失败: ${previewError}`);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "确认拉伸");
    button?.click();
  });
  await page.waitForFunction(() => {
    const state = window.__wego.getState();
    return state.doc.bodies.length === 1 && Object.values(state.meshes)[0]?.positions.length > 0;
  }, { timeout: 20000 });

  const created = await page.evaluate(() => {
    const state = window.__wego.getState();
    const body = state.doc.bodies[0];
    return {
      volume: state.volumes[body.id],
      visible: body.visible,
      name: body.name,
      tree: document.body.innerText.includes("实体 1") && document.body.innerText.includes("拉伸 1"),
    };
  });
  if (Math.abs(created.volume - 20000) / 20000 > 0.02) throw new Error(`体积不对: ${created.volume}`);
  if (!created.visible) throw new Error("新实体不可见");
  await page.click("[data-dock='history']");
  const tree = await page.evaluate(() => document.body.innerText.includes("实体 1") && document.body.innerText.includes("拉伸 1"));
  if (!tree) throw new Error("特征树没有显示新实体");

  await page.evaluate(() => {
    const feature = window.__wego.getState().doc.features[0];
    window.__wego.beginTransient();
    window.__wego.setFeatureDistances(feature.id, 0, 30);
    window.__wego.endTransient();
  });
  await page.waitForFunction(() => {
    const state = window.__wego.getState();
    const body = state.doc.bodies[0];
    return state.volumes[body.id] > 28000;
  }, { timeout: 20000 });

  await page.evaluate(() => window.__wego.undo());
  await page.waitForFunction(() => {
    const state = window.__wego.getState();
    const body = state.doc.bodies[0];
    return body && Math.abs(state.volumes[body.id] - 20000) < 500;
  }, { timeout: 20000 });

  await page.evaluate(() => {
    const body = window.__wego.getState().doc.bodies[0];
    window.__wego.setBodyVisible(body.id, false);
    window.__wego.addRectangle(window.__wego.getState().doc.sketches[0].id, { x: 50, y: 0 }, { x: 70, y: 20 });
  });
  await page.evaluate(() => {
    const sketch = window.__wego.getState().doc.sketches[0];
    const entity = sketch.entities[sketch.entities.length - 1];
    window.__wego.beginExtrude(sketch.id, entity.id);
    window.__wego.confirmExtrude();
  });
  await page.waitForFunction(() => window.__wego.getState().doc.bodies.length === 2, { timeout: 20000 });
  const colors = await page.evaluate(() => window.__wego.getState().doc.bodies.map((body) => `${body.color}:${body.visible}`));
  if (colors[0] === colors[1]) throw new Error(`两个实体颜色不应相同: ${colors.join(" ")}`);
  if (!colors[0].endsWith(":false")) throw new Error("第一个实体没有隐藏");

  await page.evaluate(() => window.__wego.showAllBodies());
  await page.evaluate(() => {
    const body = window.__wego.getState().doc.bodies[1];
    window.__wego.select({ kind: "body", id: body.id });
    window.__wego.setTool("fillet");
  });
  await page.waitForFunction(() => {
    const state = window.__wego.getState();
    const feature = state.doc.features.find((item) => item.type === "fillet");
    const body = state.doc.bodies[1];
    if (!feature || !body) return false;
    if (state.errors[feature.id]) return true;
    return state.volumes[body.id] > 0 && state.volumes[body.id] < 7900;
  }, { timeout: 20000 });
  const filletError = await page.evaluate(() => {
    const feature = window.__wego.getState().doc.features.find((item) => item.type === "fillet");
    return feature ? window.__wego.getState().errors[feature.id] || "" : "没有圆角特征";
  });
  if (filletError) throw new Error(`圆角失败: ${filletError}`);
  await page.evaluate(() => window.__wego.createOffsetPlane("plane-xy", 12));
  const offsetPlane = await page.evaluate(() => {
    const plane = window.__wego.getState().doc.planes.find((item) => item.kind === "offset");
    return plane ? plane.origin.z : null;
  });
  if (Math.abs(offsetPlane - 12) > 1e-6) throw new Error(`偏置平面不对: ${offsetPlane}`);
  await page.click("[data-view='top']");
  const viewName = await page.evaluate(() => window.__wego.getState().viewName);
  if (viewName !== "top") throw new Error(`视图方块没有切到顶视: ${viewName}`);
  await page.click("[data-dock='tools']");
  await page.click("[data-filter='sketch']");
  const canvasBox = await page.$eval("canvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(canvasBox.x, canvasBox.y);
  const pickedBody = await page.evaluate(() => window.__wego.getState().selection?.kind === "body");
  if (pickedBody) throw new Error("选择过滤没有挡住实体点选");
  const shot = join(await mkdtemp(join(tmpdir(), "wego-cad-")), "viewport.png");
  await page.screenshot({ path: shot });
  console.log(`screenshot ${shot}`);
  const serious = logs.filter((line) => !line.includes("favicon"));
  if (serious.length > 0) throw new Error(serious.join("\n"));
  console.log("e2e ok", colors.join(" | "));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
