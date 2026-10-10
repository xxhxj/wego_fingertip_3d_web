import type { BuildResult } from "./build";
import type { ReplayRequest } from "./protocol";
import type { EdgeRef, Vec3 } from "../model/types";

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
  return request<BuildResult[]>("replay", { model }, (data) => data.results as BuildResult[]);
}

export function exportStep(model: ReplayRequest, bodyId: string | null): Promise<string> {
  return request<string>("export-step", { model, bodyId }, (data) => String(data.step ?? ""));
}

export function pickEdge(model: ReplayRequest, bodyId: string, point: Vec3): Promise<EdgeRef> {
  return request<EdgeRef>("pick-edge", { model, bodyId, point }, (data) => data.edge as EdgeRef);
}

function request<T>(type: string, payload: Record<string, unknown>, read: (data: Record<string, unknown>) => T): Promise<T> {
  const current = getWorker();
  const id = requestId;
  requestId += 1;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== type || event.data.id !== id) return;
      current.removeEventListener("message", onMessage);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(read(event.data as Record<string, unknown>));
    };
    current.addEventListener("message", onMessage);
    current.postMessage({ type, id, ...payload });
  });
}
