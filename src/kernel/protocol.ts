import type { Body, DatumPlane, FaceRef, Feature, Sketch, SketchEntity } from "../model/types";

export type ReplayPreview =
  | { kind: "extrude"; sketchId: string; entityId: string; start: number; end: number; entityOverride?: SketchEntity }
  | { kind: "revolve"; sketchId: string; entityId: string; axis: "u" | "v"; angleDeg: number }
  | { kind: "push"; bodyId: string; face: FaceRef; distance: number };

/** 交给几何线程的整份特征记录。网格不在这里，重放时现算。 */
export interface ReplayRequest {
  planes: DatumPlane[];
  sketches: Sketch[];
  features: Feature[];
  bodies: Body[];
  preview: ReplayPreview | null;
}
