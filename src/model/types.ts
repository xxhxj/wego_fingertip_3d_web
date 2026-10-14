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

export interface EdgeRef {
  /** 边上的一点，重建后用来找回同一条棱。 */
  midpoint: Vec3;
  /** 该点处的单位切向。 */
  direction: Vec3;
  length: number;
}

export interface FaceRef {
  /** 面上的一点，重建后用来找回同一个面。 */
  midpoint: Vec3;
  /** 该点处的单位法向。正的推拉距离沿这个方向加料。 */
  normal: Vec3;
}

export interface DatumPlane extends PlaneFrame {
  id: string;
  name: string;
  kind: "principal" | "offset" | "bisect" | "angled";
  /** 偏置和斜面的来源平面。等分时是第一个平面。 */
  sourceId: string | null;
  /** 等分的第二个平面。 */
  peerId: string | null;
  /** 沿来源法向的偏置距离，单位 mm。 */
  distance: number;
  /** 绕来源 U 轴的转角，单位度。 */
  angleDeg: number;
}

export type SketchEntity =
  | { id: string; type: "rectangle"; a: Vec2; b: Vec2 }
  | { id: string; type: "circle"; center: Vec2; radius: number }
  | { id: string; type: "polyline"; points: Vec2[]; closed: boolean }
  | { id: string; type: "line"; a: Vec2; b: Vec2 }
  | { id: string; type: "spline"; points: Vec2[] }
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
  /** 大于 0 时按该公差缝合接近重合的面，单位 mm。 */
  fuzzy: number;
}

export interface FilletFeature {
  id: string;
  type: "fillet";
  name: string;
  bodyId: string;
  radius: number;
  /** 为空时倒圆全部边。否则只倒这些边。 */
  edges: EdgeRef[] | null;
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

export interface SweepFeature {
  id: string;
  type: "sweep";
  name: string;
  profileSketchId: string;
  profileEntityId: string;
  pathSketchId: string;
  pathEntityId: string;
  bodyId: string;
}

export interface LoftProfile {
  sketchId: string;
  entityId: string;
}

export interface LoftFeature {
  id: string;
  type: "loft";
  name: string;
  profiles: LoftProfile[];
  /** 为真时截面之间用直纹面连接。 */
  ruled: boolean;
  bodyId: string;
}

export interface PushFeature {
  id: string;
  type: "push";
  name: string;
  bodyId: string;
  face: FaceRef;
  /** 沿面法向的距离，单位 mm。负数向内减料。 */
  distance: number;
}

export interface SplitFeature {
  id: string;
  type: "split";
  name: string;
  bodyId: string;
  planeId: string;
  keep: "both" | "positive" | "negative";
  /** keep 为 both 时，反法向一侧放进这个新实体。 */
  newBodyId: string | null;
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
  | CircularPatternFeature
  | SweepFeature
  | LoftFeature
  | PushFeature
  | SplitFeature
  | StepFeature;

export interface StepFeature {
  id: string;
  type: "step";
  name: string;
  bodyId: string;
  step: string;
}

export interface Body {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  featureId: string;
  /** 整体弦高，单位 mm。越小越细。 */
  deflection: number;
  /** 与 faceDirection 最接近的那个面使用这个弦高。 */
  faceDeflection: number | null;
  faceDirection: Vec3 | null;
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
  | { type: "line"; points: Vec2[]; hover: Vec2 | null }
  | { type: "spline"; points: Vec2[]; hover: Vec2 | null }
  | { type: "arc"; points: Vec2[]; hover: Vec2 | null };

export type Tool =
  | "select"
  | "rectangle"
  | "circle"
  | "polyline"
  | "line"
  | "spline"
  | "arc"
  | "extrude"
  | "revolve"
  | "sweep"
  | "loft"
  | "fuse"
  | "cut"
  | "common"
  | "push"
  | "split"
  | "fillet"
  | "chamfer"
  | "shell"
  | "move"
  | "copy"
  | "mirror"
  | "linear"
  | "circular"
  | "measure";

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
  | { kind: "body"; id: string }
  | { kind: "face"; bodyId: string; face: FaceRef };

export type PickFilter = "all" | "body" | "face" | "edge" | "sketch";

export type ViewName = "iso" | "top" | "bottom" | "front" | "back" | "left" | "right";

export interface MeasureHit {
  point: Vec3;
  direction: Vec3 | null;
}

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
