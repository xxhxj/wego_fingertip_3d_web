import type { BuildResult } from "./build";
import type { ReplayRequest } from "./protocol";

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let requestId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function initKernel(): Promise<void> {
  if (ready) return ready;
  const current = getWorker();
  ready = new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "ready") {
        current.removeEventListener("message", onMessage);
        resolve();
      } else if (event.data?.type === "init-error") {
        current.removeEventListener("message", onMessage);
        reject(new Error(event.data.message || "几何内核加载失败"));
      }
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("error", () => reject(new Error("几何内核线程启动失败")), { once: true });
    current.postMessage({ type: "init" });
  });
  return ready;
}

export function replay(model: ReplayRequest): Promise<BuildResult[]> {
  const current = getWorker();
  const id = requestId;
  requestId += 1;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "replay" || event.data.id !== id) return;
      current.removeEventListener("message", onMessage);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.results as BuildResult[]);
    };
    current.addEventListener("message", onMessage);
    current.postMessage({ type: "replay", id, model });
  });
}
