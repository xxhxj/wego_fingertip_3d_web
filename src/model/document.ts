import type { DocumentModel } from "./types";

export const BODY_COLORS = ["#2f6fed", "#0f9f6e", "#d4880f", "#d4537e", "#7a5af8", "#0891b2"];

let sequence = 0;

export function uid(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function createDocument(): DocumentModel {
  return {
    planes: [
      {
        id: "plane-xy",
        name: "XY 平面",
        kind: "principal",
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
        xDir: { x: 1, y: 0, z: 0 },
      },
      {
        id: "plane-xz",
        name: "XZ 平面",
        kind: "principal",
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: -1, z: 0 },
        xDir: { x: 1, y: 0, z: 0 },
      },
      {
        id: "plane-yz",
        name: "YZ 平面",
        kind: "principal",
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
        xDir: { x: 0, y: 1, z: 0 },
      },
    ],
    sketches: [],
    features: [],
    bodies: [],
  };
}

export function cloneDoc(document: DocumentModel): DocumentModel {
  return structuredClone(document);
}
