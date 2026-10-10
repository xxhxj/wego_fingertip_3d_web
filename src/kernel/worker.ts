import wasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";
import { OcctKernel } from "occt-wasm";
import { buildExtrusion, type BuildJob, type BuildResult } from "./build";

let kernelPromise: Promise<OcctKernel> | null = null;

function loadKernel(): Promise<OcctKernel> {
  if (!kernelPromise) kernelPromise = OcctKernel.init({ wasm: wasmUrl });
  return kernelPromise;
}

const post = self.postMessage.bind(self) as (message: unknown, transfer?: Transferable[]) => void;

self.onmessage = (event: MessageEvent<{ type: string; id?: number; jobs?: BuildJob[] }>) => {
  const message = event.data;
  if (message.type === "init") {
    loadKernel()
      .then(() => post({ type: "ready" }))
      .catch((error: unknown) => {
        post({ type: "init-error", message: error instanceof Error ? error.message : String(error) });
      });
    return;
  }
  if (message.type !== "replay" || message.id == null || !message.jobs) return;
  const requestId = message.id;
  const jobs = message.jobs;
  loadKernel()
    .then((kernel) => {
      const results: BuildResult[] = jobs.map((job) => buildExtrusion(kernel, job));
      const transfer: ArrayBuffer[] = [];
      for (const result of results) {
        if ("positions" in result) {
          transfer.push(result.positions.buffer, result.normals.buffer, result.indices.buffer, result.edges.buffer);
        }
      }
      post({ type: "replay", id: requestId, results }, transfer);
    })
    .catch((error: unknown) => {
      post({ type: "replay", id: requestId, error: error instanceof Error ? error.message : String(error) });
    });
};
