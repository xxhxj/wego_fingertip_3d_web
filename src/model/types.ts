export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlaneFrame {
  origin: Vec3;
  normal: Vec3;
  xDir: Vec3;
}

export interface DatumPlane extends PlaneFrame {
  id: string;
  name: string;
  kind: "principal";
}

export type SketchEntity =
  | { id: string; type: "rectangle"; a: Vec2; b: Vec2 }
  | { id: string; type: "circle"; center: Vec2; radius: number }
  | { id: string; type: "polyline"; points: Vec2[]; closed: boolean }
  | { id: string; type: "arc"; start: Vec2; mid: Vec2; end: Vec2 };

export interface Sketch {
  id: string;
  name: string;
  planeId: string;
  entities: SketchEntity[];
}

export interface ExtrudeFeature {
  id: string;
  type: "extrude";
  name: string;
  sketchId: string;
  entityId: string;
  /** 沿平面法向的起始距离，单位 mm。 */
  start: number;
  /** 沿平面法向的结束距离，单位 mm。 */
  end: number;
  bodyId: string;
}

export interface Body {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  featureId: string;
}

export interface DocumentModel {
  planes: DatumPlane[];
  sketches: Sketch[];
  features: ExtrudeFeature[];
  bodies: Body[];
}

export type Draft =
  | { type: "rectangle"; a: Vec2; b: Vec2 }
  | { type: "circle"; center: Vec2; radius: number }
  | { type: "polyline"; points: Vec2[]; hover: Vec2 | null }
  | { type: "arc"; points: Vec2[]; hover: Vec2 | null };

export type Tool = "select" | "rectangle" | "circle" | "polyline" | "arc" | "extrude";

export type Selection =
  | { kind: "plane"; id: string }
  | { kind: "sketch"; id: string }
  | { kind: "entity"; sketchId: string; entityId: string }
  | { kind: "feature"; id: string }
  | { kind: "body"; id: string };

export interface ExtrudeDraft {
  sketchId: string;
  entityId: string;
  start: number;
  end: number;
}

export interface Sample {
  points: Vec2[];
  closed: boolean;
}
