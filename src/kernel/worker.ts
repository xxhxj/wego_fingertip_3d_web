import wasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";
import { OcctKernel } from "occt-wasm";
import type { BuildResult } from "./build";
import type { ReplayRequest } from "./protocol";
import { exportStepModel, pickEdgeOnBody, replayModel } from "./replay";
import type { EdgeRef, Vec3 } from "../model/types";

let kernelPromise: Promise<OcctKernel> | null = null;

function loadKernel(): Promise<OcctKernel> {
  if (!kernelPromise) kernelPromise = OcctKernel.init({ wasm: wasmUrl });
  return kernelPromise;
}

const post = self.postMessage.bind(self) as (message: unknown, transfer?: Transferable[]) => void;

self.onmessage = (event: MessageEvent<{
  type: string;
  id?: number;
  model?: ReplayRequest;
  bodyId?: string | null;
  point?: Vec3;
}>) => {
  const message = event.data;
  if (message.type === "init") {
    loadKernel()
      .then(() => post({ type: "ready" }))
      .catch((error: unknown) => {
        post({ type: "init-error", message: error instanceof Error ? error.message : String(error) });
      });
    return;
  }
  if (message.type === "replay" && message.id != null && message.model) {
    const requestId = message.id;
    const model = message.model;
    loadKernel()
      .then((kernel) => {
        const results: BuildResult[] = replayModel(kernel, model);
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
    return;
  }
  if ((message.type === "export-step" || message.type === "pick-edge") && message.id != null && message.model) {
    const requestId = message.id;
    const model = message.model;
    const kind = message.type;
    loadKernel()
      .then((kernel) => {
        if (kind === "export-step") {
          const step = exportStepModel(kernel, model, message.bodyId ?? null);
          post({ type: "export-step", id: requestId, step });
          return;
        }
        const edge: EdgeRef = pickEdgeOnBody(kernel, model, message.bodyId ?? "", message.point ?? { x: 0, y: 0, z: 0 });
        post({ type: "pick-edge", id: requestId, edge });
      })
      .catch((error: unknown) => {
        post({ type: kind, id: requestId, error: error instanceof Error ? error.message : String(error) });
      });
  }
};
