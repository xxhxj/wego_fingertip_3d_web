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
  /** 大于 0 时按该厚度做薄壁，单位 mm。 */
  wall: number;
  /** 为真时拉伸成片体，而不是实体。 */
  sheet: boolean;
  /** 拔模角，单位度。0 表示不拔模。 */
  draftAngle: number;
}

export interface RevolveFeature {
  id: string;
  type: "revolve";
  name: string;
  sketchId: string;
  entityId: string;
  /** 旋转轴通过草图原点。u 沿平面 x 方向，v 沿平面内的另一轴。 */
  axis: "u" | "v";
  angleDeg: number;
  operation: "new" | "fuse" | "cut";
  targetBodyId: string | null;
  bodyId: string;
}

export interface BooleanFeature {
  id: string;
  type: "boolean";
  name: string;
  operation: "fuse" | "cut" | "common";
  targetBodyId: string;
  toolBodyId: string;
}

export interface FilletFeature {
  id: string;
  type: "fillet";
  name: string;
  bodyId: string;
  radius: number;
}

export interface ChamferFeature {
  id: string;
  type: "chamfer";
  name: string;
  bodyId: string;
  distance: number;
}

export interface ShellFeature {
  id: string;
  type: "shell";
  name: string;
  bodyId: string;
  thickness: number;
  direction: Vec3;
}

export interface MoveFeature {
  id: string;
  type: "move";
  name: string;
  bodyId: string;
  dx: number;
  dy: number;
  dz: number;
  copy: boolean;
  newBodyId: string | null;
}

export interface MirrorFeature {
  id: string;
  type: "mirror";
  name: string;
  bodyId: string;
  planeId: string;
  newBodyId: string;
}

export interface LinearPatternFeature {
  id: string;
  type: "linearPattern";
  name: string;
  bodyId: string;
  direction: Vec3;
  spacing: number;
  count: number;
}

export interface CircularPatternFeature {
  id: string;
  type: "circularPattern";
  name: string;
  bodyId: string;
  center: Vec3;
  axis: Vec3;
  angleDeg: number;
  count: number;
}

export type Feature =
  | ExtrudeFeature
  | RevolveFeature
  | BooleanFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | MoveFeature
  | MirrorFeature
  | LinearPatternFeature
  | CircularPatternFeature;

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
  features: Feature[];
  bodies: Body[];
}

export type Draft =
  | { type: "rectangle"; a: Vec2; b: Vec2 }
  | { type: "circle"; center: Vec2; radius: number }
  | { type: "polyline"; points: Vec2[]; hover: Vec2 | null }
  | { type: "arc"; points: Vec2[]; hover: Vec2 | null };

export type Tool =
  | "select"
  | "rectangle"
  | "circle"
  | "polyline"
  | "arc"
  | "extrude"
  | "revolve"
  | "fuse"
  | "cut"
  | "common"
  | "fillet"
  | "chamfer"
  | "shell"
  | "move"
  | "copy"
  | "mirror"
  | "linear"
  | "circular";

export interface RevolveDraft {
  sketchId: string;
  entityId: string;
  axis: "u" | "v";
  angleDeg: number;
  operation: "new" | "fuse" | "cut";
  targetBodyId: string | null;
}

export interface PendingBoolean {
  operation: "fuse" | "cut" | "common";
  targetBodyId: string;
}

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
