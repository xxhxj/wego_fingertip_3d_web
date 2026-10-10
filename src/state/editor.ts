import { replay, initKernel } from "../kernel/client";
import { isBuiltMesh, type BuildResult } from "../kernel/build";
import type { ReplayRequest } from "../kernel/protocol";
import { BODY_COLORS, cloneDoc, createDocument, uid } from "../model/document";
import { entityLabel, isClosed } from "../model/profiles";
import type {
  DocumentModel,
  ExtrudeDraft,
  Feature,
  PendingBoolean,
  RevolveDraft,
  Selection,
  SketchEntity,
  Tool,
  Vec2,
} from "../model/types";
import { getGesture, setGesture } from "./gesture";

export interface MeshState {
  id: string;
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  edges: Float32Array<ArrayBuffer>;
  volume: number;
}

export interface EditorState {
  doc: DocumentModel;
  past: DocumentModel[];
  future: DocumentModel[];
  canUndo: boolean;
  canRedo: boolean;
  tool: Tool;
  activeSketchId: string | null;
  selection: Selection | null;
  pointer: { x: number; y: number } | null;
  extrudeDraft: ExtrudeDraft | null;
  revolveDraft: RevolveDraft | null;
  pendingBoolean: PendingBoolean | null;
  status: string;
  kernel: "loading" | "ready" | "error";
  kernelMessage: string;
  viewportMessage: string | null;
  meshes: Record<string, MeshState>;
  preview: MeshState | null;
  errors: Record<string, string>;
  volumes: Record<string, number>;
  meshRevision: number;
  licenseOpen: boolean;
}

let state: EditorState = {
  doc: createDocument(),
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  tool: "select",
  activeSketchId: null,
  selection: null,
  pointer: null,
  extrudeDraft: null,
  revolveDraft: null,
  pendingBoolean: null,
  status: "选择一个基准面，然后开始草图。",
  kernel: "loading",
  kernelMessage: "正在加载 Open CASCADE…",
  viewportMessage: null,
  meshes: {},
  preview: null,
  errors: {},
  volumes: {},
  meshRevision: 0,
  licenseOpen: false,
};

const listeners = new Set<() => void>();
let booted = false;
let ticket = 0;
let transientAnchor: DocumentModel | null = null;

function replace(next: EditorState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function update(patch: Partial<EditorState>): void {
  replace({ ...state, ...patch });
}

export function getState(): EditorState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function boot(): void {
  if (booted) return;
  booted = true;
  initKernel()
    .then(() => {
      update({ kernel: "ready", kernelMessage: "几何内核已就绪" });
      scheduleReplay();
    })
    .catch((error: unknown) => {
      update({
        kernel: "error",
        kernelMessage: error instanceof Error ? error.message : "几何内核加载失败",
      });
    });
}

export function setViewportMessage(message: string | null): void {
  update({ viewportMessage: message });
}

export function setLicenseOpen(open: boolean): void {
  update({ licenseOpen: open });
}

export function scheduleReplay(): void {
  if (state.kernel !== "ready") return;
  const mine = ticket + 1;
  ticket = mine;
  window.setTimeout(() => {
    if (mine !== ticket) return;
    void runReplay(mine);
  }, 40);
}

async function runReplay(mine: number): Promise<void> {
  const model = collectModel(state);
  try {
    const results = await replay(model);
    if (mine !== ticket) return;
    applyReplay(results);
  } catch (error) {
    if (mine !== ticket) return;
    update({ kernelMessage: error instanceof Error ? error.message : "重放失败" });
  }
}

function collectModel(current: EditorState): ReplayRequest {
  let preview: ReplayRequest["preview"] = null;
  if (current.extrudeDraft) {
    preview = {
      kind: "extrude",
      sketchId: current.extrudeDraft.sketchId,
      entityId: current.extrudeDraft.entityId,
      start: current.extrudeDraft.start,
      end: current.extrudeDraft.end,
    };
  } else if (current.revolveDraft) {
    preview = {
      kind: "revolve",
      sketchId: current.revolveDraft.sketchId,
      entityId: current.revolveDraft.entityId,
      axis: current.revolveDraft.axis,
      angleDeg: current.revolveDraft.angleDeg,
    };
  }
  return {
    planes: current.doc.planes,
    sketches: current.doc.sketches,
    features: current.doc.features,
    bodies: current.doc.bodies,
    preview,
  };
}

function applyReplay(results: BuildResult[]): void {
  const meshes: Record<string, MeshState> = {};
  const errors: Record<string, string> = {};
  const volumes: Record<string, number> = {};
  let preview: MeshState | null = null;
  for (const result of results) {
    if (!isBuiltMesh(result)) {
      errors[result.id] = result.error;
      continue;
    }
    if (result.id === "__preview__") preview = result;
    else {
      meshes[result.id] = result;
      volumes[result.id] = result.volume;
    }
  }
  for (const body of state.doc.bodies) {
    if (!meshes[body.id] && !errors[body.id]) errors[body.id] = errors[body.featureId] ?? "没有生成实体";
  }
  update({ meshes, preview, errors, volumes, meshRevision: state.meshRevision + 1 });
}

function commitDoc(recipe: (document: DocumentModel) => void, extra: Partial<EditorState> = {}, shouldReplay = true): void {
  transientAnchor = null;
  const next = cloneDoc(state.doc);
  recipe(next);
  update({
    past: [...state.past, state.doc].slice(-100),
    future: [],
    doc: next,
    canUndo: true,
    canRedo: false,
    ...extra,
  });
  if (shouldReplay) scheduleReplay();
}

function writeTransient(recipe: (document: DocumentModel) => void, shouldReplay: boolean): void {
  const next = cloneDoc(state.doc);
  recipe(next);
  if (transientAnchor) update({ doc: next });
  else {
    update({
      past: [...state.past, state.doc].slice(-100),
      future: [],
      doc: next,
      canUndo: true,
      canRedo: false,
    });
  }
  if (shouldReplay) scheduleReplay();
}

export function beginTransient(): void {
  if (!transientAnchor) transientAnchor = state.doc;
}

export function endTransient(): void {
  if (!transientAnchor) return;
  if (transientAnchor !== state.doc) {
    update({
      past: [...state.past, transientAnchor].slice(-100),
      future: [],
      canUndo: true,
      canRedo: false,
    });
  }
  transientAnchor = null;
}

function sanitize(current: EditorState): EditorState {
  let activeSketchId = current.activeSketchId;
  if (activeSketchId && !current.doc.sketches.some((sketch) => sketch.id === activeSketchId)) activeSketchId = null;
  const selection = validSelection(current.doc, current.selection);
  let extrudeDraft = current.extrudeDraft;
  if (extrudeDraft) {
    const sketch = current.doc.sketches.find((item) => item.id === extrudeDraft?.sketchId);
    const entity = sketch?.entities.find((item) => item.id === extrudeDraft?.entityId);
    if (!sketch || !entity) extrudeDraft = null;
  }
  let revolveDraft = current.revolveDraft;
  if (revolveDraft) {
    const sketch = current.doc.sketches.find((item) => item.id === revolveDraft?.sketchId);
    const entity = sketch?.entities.find((item) => item.id === revolveDraft?.entityId);
    if (!sketch || !entity) revolveDraft = null;
  }
  let pendingBoolean = current.pendingBoolean;
  if (pendingBoolean && !current.doc.bodies.some((body) => body.id === pendingBoolean?.targetBodyId)) pendingBoolean = null;
  let tool = current.tool;
  const drawing = tool === "rectangle" || tool === "circle" || tool === "polyline" || tool === "arc";
  if ((drawing && !activeSketchId) || (tool === "extrude" && !extrudeDraft) || (tool === "revolve" && !revolveDraft)) tool = "select";
  if ((tool === "fuse" || tool === "cut" || tool === "common") && !pendingBoolean) tool = "select";
  return { ...current, activeSketchId, selection, extrudeDraft, revolveDraft, pendingBoolean, tool };
}

function validSelection(document: DocumentModel, selection: Selection | null): Selection | null {
  if (!selection) return null;
  if (selection.kind === "plane") return document.planes.some((plane) => plane.id === selection.id) ? selection : null;
  if (selection.kind === "sketch") return document.sketches.some((sketch) => sketch.id === selection.id) ? selection : null;
  if (selection.kind === "feature") return document.features.some((feature) => feature.id === selection.id) ? selection : null;
  if (selection.kind === "body") return document.bodies.some((body) => body.id === selection.id) ? selection : null;
  const sketch = document.sketches.find((item) => item.id === selection.sketchId);
  const entity = sketch?.entities.find((item) => item.id === selection.entityId);
  return sketch && entity ? selection : null;
}

export function undo(): void {
  if (state.past.length === 0) return;
  transientAnchor = null;
  const previous = state.past[state.past.length - 1];
  const past = state.past.slice(0, -1);
  const future = [...state.future, state.doc];
  setGesture({ draft: null, readout: "" });
  replace(sanitize({
    ...state,
    doc: previous,
    past,
    future,
    canUndo: past.length > 0,
    canRedo: true,
    status: "已撤销。",
  }));
  scheduleReplay();
}

export function redo(): void {
  if (state.future.length === 0) return;
  transientAnchor = null;
  const next = state.future[state.future.length - 1];
  const future = state.future.slice(0, -1);
  const past = [...state.past, state.doc];
  setGesture({ draft: null, readout: "" });
  replace(sanitize({
    ...state,
    doc: next,
    past,
    future,
    canUndo: true,
    canRedo: future.length > 0,
    status: "已重做。",
  }));
  scheduleReplay();
}

export function select(selection: Selection | null, pointer: { x: number; y: number } | null = null): void {
  const pending = state.pendingBoolean;
  if (pending && selection?.kind === "body" && selection.id !== pending.targetBodyId) {
    applyBoolean(pending.operation, pending.targetBodyId, selection.id);
    return;
  }
  update({
    selection,
    pointer,
    pendingBoolean: pending && selection?.kind === "body" ? pending : null,
    tool: pending && selection?.kind !== "body" ? "select" : state.tool,
  });
}

export function setTool(tool: Tool): void {
  if (tool === "extrude") {
    beginExtrude();
    return;
  }
  if (tool === "revolve") {
    beginRevolve();
    return;
  }
  if (tool === "fuse" || tool === "cut" || tool === "common") {
    beginBoolean(tool);
    return;
  }
  if (
    tool === "fillet"
    || tool === "chamfer"
    || tool === "shell"
    || tool === "move"
    || tool === "copy"
    || tool === "mirror"
    || tool === "linear"
    || tool === "circular"
  ) {
    applyBodyTool(tool);
    return;
  }
  const drawing = tool === "rectangle" || tool === "circle" || tool === "polyline" || tool === "arc";
  if (drawing && !state.activeSketchId) {
    const selection = state.selection;
    let planeId = "plane-xy";
    if (selection?.kind === "plane") planeId = selection.id;
    if (selection?.kind === "sketch") {
      planeId = state.doc.sketches.find((sketch) => sketch.id === selection.id)?.planeId ?? planeId;
    }
    startSketch(planeId);
    update({ tool });
    setGesture({ draft: null, readout: "" });
    return;
  }
  const hadPreview = state.extrudeDraft != null || state.revolveDraft != null;
  update({ tool, extrudeDraft: null, revolveDraft: null, pendingBoolean: null });
  setGesture({ draft: null, readout: "" });
  if (hadPreview) scheduleReplay();
}

export function startSketch(planeId: string): void {
  const plane = state.doc.planes.find((item) => item.id === planeId);
  if (!plane) return;
  const id = uid("sk");
  commitDoc((document) => {
    document.sketches.push({ id, name: `草图 ${document.sketches.length + 1}`, planeId, entities: [] });
  }, {
    activeSketchId: id,
    tool: "rectangle",
    selection: { kind: "sketch", id },
    extrudeDraft: null,
    revolveDraft: null,
    pendingBoolean: null,
    pointer: null,
    status: `正在 ${plane.name} 上绘制。左键画图，中键旋转，右键平移。`,
  }, false);
  setGesture({ draft: null, readout: "" });
}

export function continueSketch(sketchId: string): void {
  const sketch = state.doc.sketches.find((item) => item.id === sketchId);
  if (!sketch) return;
  const hadPreview = state.extrudeDraft != null || state.revolveDraft != null;
  update({
    activeSketchId: sketchId,
    tool: "rectangle",
    selection: { kind: "sketch", id: sketchId },
    extrudeDraft: null,
    revolveDraft: null,
    pendingBoolean: null,
    status: `继续绘制 ${sketch.name}。`,
  });
  setGesture({ draft: null, readout: "" });
  if (hadPreview) scheduleReplay();
}

export function finishSketch(): void {
  const id = state.activeSketchId;
  const sketch = state.doc.sketches.find((item) => item.id === id);
  setGesture({ draft: null, readout: "" });
  if (sketch && sketch.entities.length === 0) {
    commitDoc((document) => {
      document.sketches = document.sketches.filter((item) => item.id !== id);
    }, { activeSketchId: null, tool: "select", selection: null, status: "已退出空草图。" }, false);
    return;
  }
  update({ activeSketchId: null, tool: "select", status: "草图已完成。选中封闭截面后可以拉伸。" });
}

function addEntity(sketchId: string, entity: SketchEntity): void {
  commitDoc((document) => {
    document.sketches.find((sketch) => sketch.id === sketchId)?.entities.push(entity);
  }, {
    selection: { kind: "entity", sketchId, entityId: entity.id },
    status: `${entityLabel(entity)} 已加入草图。封闭截面可以拉伸。`,
  }, false);
}

export function addRectangle(sketchId: string, a: Vec2, b: Vec2): void {
  addEntity(sketchId, { id: uid("en"), type: "rectangle", a, b });
}

export function drawingDown(point: Vec2): void {
  if (!state.activeSketchId) return;
  if (state.tool === "rectangle") setGesture({ draft: { type: "rectangle", a: point, b: point }, readout: "矩形" });
  if (state.tool === "circle") setGesture({ draft: { type: "circle", center: point, radius: 0 }, readout: "圆" });
}

export function drawingMove(point: Vec2): void {
  const draft = getGesture().draft;
  if (!draft) return;
  if (draft.type === "rectangle") {
    const width = Math.abs(point.x - draft.a.x);
    const height = Math.abs(point.y - draft.a.y);
    setGesture({ draft: { ...draft, b: point }, readout: `矩形 ${width.toFixed(1)} × ${height.toFixed(1)} mm` });
  } else if (draft.type === "circle") {
    const radius = Math.hypot(point.x - draft.center.x, point.y - draft.center.y);
    setGesture({ draft: { ...draft, radius }, readout: `圆 R${radius.toFixed(1)} mm` });
  } else if (draft.type === "polyline") {
    setGesture({ draft: { ...draft, hover: point }, readout: `多段线 ${draft.points.length} 点` });
  } else {
    setGesture({ draft: { ...draft, hover: point }, readout: `圆弧 ${draft.points.length}/3` });
  }
}

export function drawingUp(point: Vec2): void {
  const draft = getGesture().draft;
  const sketchId = state.activeSketchId;
  if (!draft || !sketchId) return;
  if (draft.type === "rectangle") {
    setGesture({ draft: null, readout: "" });
    if (Math.abs(point.x - draft.a.x) < 0.2 || Math.abs(point.y - draft.a.y) < 0.2) return;
    addEntity(sketchId, { id: uid("en"), type: "rectangle", a: draft.a, b: point });
  } else if (draft.type === "circle") {
    const radius = Math.hypot(point.x - draft.center.x, point.y - draft.center.y);
    setGesture({ draft: null, readout: "" });
    if (radius < 0.2) return;
    addEntity(sketchId, { id: uid("en"), type: "circle", center: draft.center, radius });
  }
}

export function drawingClick(point: Vec2, closeToFirst: boolean): void {
  const sketchId = state.activeSketchId;
  if (!sketchId) return;
  if (state.tool === "polyline") {
    const draft = getGesture().draft;
    const points = draft?.type === "polyline" ? draft.points : [];
    if (closeToFirst && points.length >= 3) {
      setGesture({ draft: null, readout: "" });
      addEntity(sketchId, { id: uid("en"), type: "polyline", points, closed: true });
      return;
    }
    setGesture({ draft: { type: "polyline", points: [...points, point], hover: null }, readout: `多段线 ${points.length + 1} 点` });
    return;
  }
  if (state.tool !== "arc") return;
  const draft = getGesture().draft;
  const points = draft?.type === "arc" ? draft.points : [];
  const next = [...points, point];
  if (next.length >= 3) {
    setGesture({ draft: null, readout: "" });
    addEntity(sketchId, { id: uid("en"), type: "arc", start: next[0], mid: next[1], end: next[2] });
    return;
  }
  setGesture({ draft: { type: "arc", points: next, hover: null }, readout: `圆弧 ${next.length}/3` });
}

export function closePolyline(): void {
  const sketchId = state.activeSketchId;
  const draft = getGesture().draft;
  if (!sketchId || draft?.type !== "polyline" || draft.points.length < 3) return;
  setGesture({ draft: null, readout: "" });
  addEntity(sketchId, { id: uid("en"), type: "polyline", points: draft.points, closed: true });
}

export function cancelDraft(): void {
  setGesture({ draft: null, readout: "" });
}

function resolveProfile(sketchId?: string, entityId?: string): { sketchId: string; entityId: string } | null {
  const candidates: { sketchId: string; entityId: string }[] = [];
  if (sketchId && entityId) candidates.push({ sketchId, entityId });
  const selection = state.selection;
  if (selection?.kind === "entity") candidates.push(selection);
  if (selection?.kind === "sketch") {
    const sketch = state.doc.sketches.find((item) => item.id === selection.id);
    const entity = sketch?.entities.find(isClosed);
    if (sketch && entity) candidates.push({ sketchId: sketch.id, entityId: entity.id });
  }
  if (state.activeSketchId) {
    const sketch = state.doc.sketches.find((item) => item.id === state.activeSketchId);
    const entity = [...(sketch?.entities ?? [])].reverse().find(isClosed);
    if (sketch && entity) candidates.push({ sketchId: sketch.id, entityId: entity.id });
  }
  for (const candidate of candidates) {
    const sketch = state.doc.sketches.find((item) => item.id === candidate.sketchId);
    const entity = sketch?.entities.find((item) => item.id === candidate.entityId);
    if (sketch && entity && isClosed(entity)) return candidate;
  }
  return null;
}

export function beginExtrude(sketchId?: string, entityId?: string): void {
  const profile = resolveProfile(sketchId, entityId);
  if (!profile) {
    update({ status: "先画一个封闭截面，再拉伸。" });
    return;
  }
  setGesture({ draft: null, readout: "" });
  update({
    tool: "extrude",
    activeSketchId: null,
    extrudeDraft: { sketchId: profile.sketchId, entityId: profile.entityId, start: 0, end: 20 },
    revolveDraft: null,
    pendingBoolean: null,
    selection: { kind: "entity", sketchId: profile.sketchId, entityId: profile.entityId },
    status: "拖动蓝色箭头，或输入起止距离。确认后生成实体。",
  });
  scheduleReplay();
}

export function setDraftDistances(start: number, end: number): void {
  if (!state.extrudeDraft || !Number.isFinite(start) || !Number.isFinite(end)) return;
  update({
    extrudeDraft: {
      ...state.extrudeDraft,
      start: clampDistance(start),
      end: clampDistance(end),
    },
  });
  scheduleReplay();
}

export function confirmExtrude(): void {
  const draft = state.extrudeDraft;
  if (!draft) return;
  if (Math.abs(draft.end - draft.start) < 0.2) {
    update({ status: "起止距离之差需要大于 0.2 mm。" });
    return;
  }
  const featureId = uid("ft");
  const bodyId = uid("bd");
  commitDoc((document) => {
    const color = BODY_COLORS[document.bodies.length % BODY_COLORS.length];
    document.features.push({
      id: featureId,
      type: "extrude",
      name: `拉伸 ${document.features.length + 1}`,
      sketchId: draft.sketchId,
      entityId: draft.entityId,
      start: draft.start,
      end: draft.end,
      bodyId,
      wall: 0,
      sheet: false,
      draftAngle: 0,
    });
    document.bodies.push({
      id: bodyId,
      name: `实体 ${document.bodies.length + 1}`,
      color,
      visible: true,
      featureId,
    });
  }, {
    extrudeDraft: null,
    revolveDraft: null,
    pendingBoolean: null,
    tool: "select",
    activeSketchId: null,
    selection: { kind: "body", id: bodyId },
    pointer: null,
    status: "已生成实体。可以在右侧改起止距离，或继续画下一个草图。",
  });
}

export function cancelExtrude(): void {
  if (!state.extrudeDraft) return;
  update({ extrudeDraft: null, tool: "select", preview: null, status: "已取消拉伸。" });
  scheduleReplay();
}

export function setFeatureDistances(featureId: string, start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  writeTransient((document) => {
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature || feature.type !== "extrude") return;
    feature.start = clampDistance(start);
    feature.end = clampDistance(end);
  }, true);
}

export function editFeature(featureId: string, recipe: (feature: Feature) => void): void {
  writeTransient((document) => {
    const feature = document.features.find((item) => item.id === featureId);
    if (feature) recipe(feature);
  }, true);
}

export function setBodyVisible(bodyId: string, visible: boolean): void {
  commitDoc((document) => {
    const body = document.bodies.find((item) => item.id === bodyId);
    if (body) body.visible = visible;
  }, { status: visible ? "已显示实体。" : "已隐藏实体。" }, false);
}

export function setBodyColor(bodyId: string, color: string): void {
  writeTransient((document) => {
    const body = document.bodies.find((item) => item.id === bodyId);
    if (body) body.color = color;
  }, false);
}

export function isolateBody(bodyId: string): void {
  commitDoc((document) => {
    for (const body of document.bodies) body.visible = body.id === bodyId;
  }, { status: "已单独显示该实体。" }, false);
}

export function showAllBodies(): void {
  commitDoc((document) => {
    for (const body of document.bodies) body.visible = true;
  }, { status: "已显示全部实体。" }, false);
}

export function deleteSelection(): void {
  const selection = state.selection;
  if (!selection || selection.kind === "plane") return;
  if (selection.kind === "body") {
    const body = state.doc.bodies.find((item) => item.id === selection.id);
    if (body) deleteFeature(body.featureId);
    return;
  }
  if (selection.kind === "feature") {
    deleteFeature(selection.id);
    return;
  }
  if (selection.kind === "entity") {
    commitDoc((document) => {
      const sketch = document.sketches.find((item) => item.id === selection.sketchId);
      if (sketch) sketch.entities = sketch.entities.filter((item) => item.id !== selection.entityId);
      removeFeatures(document, (feature) => {
        const profile = profileOf(feature);
        return profile != null && profile.entityId === selection.entityId;
      });
    }, { selection: null, extrudeDraft: null, revolveDraft: null, pendingBoolean: null, status: "已删除截面。" });
    return;
  }
  commitDoc((document) => {
    const sketch = document.sketches.find((item) => item.id === selection.id);
    const entityIds = new Set(sketch?.entities.map((entity) => entity.id) ?? []);
    document.sketches = document.sketches.filter((item) => item.id !== selection.id);
    removeFeatures(document, (feature) => {
      const profile = profileOf(feature);
      return profile != null && entityIds.has(profile.entityId);
    });
  }, { selection: null, activeSketchId: state.activeSketchId === selection.id ? null : state.activeSketchId, extrudeDraft: null, revolveDraft: null, pendingBoolean: null, status: "已删除草图。" });
}

function deleteFeature(featureId: string): void {
  commitDoc((document) => {
    removeFeatures(document, (feature) => feature.id === featureId);
  }, { selection: null, status: "已删除特征。" });
}

function removeFeatures(document: DocumentModel, predicate: (feature: Feature) => boolean): void {
  const doomed = new Set(document.features.filter(predicate).map((feature) => feature.id));
  let removedBodies = new Set(document.bodies.filter((body) => doomed.has(body.featureId)).map((body) => body.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const feature of document.features) {
      if (doomed.has(feature.id)) continue;
      if (referencedBodyIds(feature).some((id) => removedBodies.has(id))) {
        doomed.add(feature.id);
        grew = true;
      }
    }
    const nextBodies = new Set(document.bodies.filter((body) => doomed.has(body.featureId)).map((body) => body.id));
    if (nextBodies.size !== removedBodies.size) {
      removedBodies = nextBodies;
      grew = true;
    }
  }
  const restoredTools = document.features
    .filter((feature): feature is Extract<Feature, { type: "boolean" }> => feature.type === "boolean" && doomed.has(feature.id))
    .map((feature) => feature.toolBodyId);
  document.features = document.features.filter((feature) => !doomed.has(feature.id));
  document.bodies = document.bodies.filter((body) => !doomed.has(body.featureId));
  for (const toolId of restoredTools) {
    const tool = document.bodies.find((body) => body.id === toolId);
    if (tool) tool.visible = true;
  }
}

function clampDistance(value: number): number {
  return Math.max(-2000, Math.min(2000, value));
}

export function beginRevolve(sketchId?: string, entityId?: string): void {
  const targetBodyId = selectedBodyId();
  const profile = resolveProfile(sketchId, entityId);
  if (!profile) {
    update({ status: "先画一个封闭截面，再旋转。" });
    return;
  }
  setGesture({ draft: null, readout: "" });
  update({
    tool: "revolve",
    activeSketchId: null,
    extrudeDraft: null,
    pendingBoolean: null,
    revolveDraft: {
      sketchId: profile.sketchId,
      entityId: profile.entityId,
      axis: "u",
      angleDeg: 360,
      operation: "new",
      targetBodyId,
    },
    selection: { kind: "entity", sketchId: profile.sketchId, entityId: profile.entityId },
    status: "旋转轴通过草图原点。确认前可以改角度、轴向，以及新建、求和或求差。",
  });
  scheduleReplay();
}

export function setRevolveDraft(patch: Partial<RevolveDraft>): void {
  if (!state.revolveDraft) return;
  const next = { ...state.revolveDraft, ...patch };
  if (patch.angleDeg != null) next.angleDeg = clampAngle(patch.angleDeg);
  update({ revolveDraft: next });
  scheduleReplay();
}

export function confirmRevolve(): void {
  const draft = state.revolveDraft;
  if (!draft) return;
  if (Math.abs(draft.angleDeg) < 0.1) {
    update({ status: "旋转角度需要大于 0.1°。" });
    return;
  }
  if (draft.operation !== "new" && !draft.targetBodyId) {
    update({ status: "求和或求差需要已有实体。先选中实体再旋转。" });
    return;
  }
  const featureId = uid("ft");
  const bodyId = draft.operation === "new" ? uid("bd") : draft.targetBodyId ?? uid("bd");
  commitDoc((document) => {
    document.features.push({
      id: featureId,
      type: "revolve",
      name: featureName(document, "revolve", "旋转"),
      sketchId: draft.sketchId,
      entityId: draft.entityId,
      axis: draft.axis,
      angleDeg: draft.angleDeg,
      operation: draft.operation,
      targetBodyId: draft.operation === "new" ? null : draft.targetBodyId,
      bodyId,
    });
    if (draft.operation === "new") pushBody(document, bodyId, featureId);
  }, {
    revolveDraft: null,
    extrudeDraft: null,
    pendingBoolean: null,
    tool: "select",
    activeSketchId: null,
    selection: { kind: "body", id: bodyId },
    pointer: null,
    status: "已生成旋转体。",
  });
}

export function cancelRevolve(): void {
  if (!state.revolveDraft) return;
  update({ revolveDraft: null, tool: "select", preview: null, status: "已取消旋转。" });
  scheduleReplay();
}

export function beginBoolean(operation: PendingBoolean["operation"]): void {
  const targetBodyId = selectedBodyId();
  if (!targetBodyId) {
    update({ status: "先选中一个实体，再做布尔运算。", tool: "select", pendingBoolean: null });
    return;
  }
  const hadPreview = state.extrudeDraft != null || state.revolveDraft != null;
  update({
    tool: operation,
    pendingBoolean: { operation, targetBodyId },
    extrudeDraft: null,
    revolveDraft: null,
    status: "再点另一个实体，作为工具体。工具体在运算后会隐藏。",
  });
  if (hadPreview) scheduleReplay();
}

export function cancelBoolean(): void {
  if (!state.pendingBoolean) return;
  update({ pendingBoolean: null, tool: "select", status: "已取消布尔运算。" });
}

function applyBoolean(operation: PendingBoolean["operation"], targetBodyId: string, toolBodyId: string): void {
  const featureId = uid("ft");
  const label = operation === "fuse" ? "并集" : operation === "cut" ? "差集" : "交集";
  commitDoc((document) => {
    const count = document.features.filter((feature) => feature.type === "boolean" && feature.operation === operation).length + 1;
    document.features.push({
      id: featureId,
      type: "boolean",
      name: `${label} ${count}`,
      operation,
      targetBodyId,
      toolBodyId,
    });
    const tool = document.bodies.find((body) => body.id === toolBodyId);
    if (tool) tool.visible = false;
  }, {
    pendingBoolean: null,
    tool: "select",
    selection: { kind: "body", id: targetBodyId },
    pointer: null,
    status: "布尔运算已记入特征。工具体已隐藏，删除这条特征可以还原。",
  });
}

function applyBodyTool(tool: "fillet" | "chamfer" | "shell" | "move" | "copy" | "mirror" | "linear" | "circular"): void {
  const bodyId = selectedBodyId();
  if (!bodyId) {
    update({ status: "先选中一个实体。", tool: "select" });
    return;
  }
  const featureId = uid("ft");
  const planeId = selectedPlaneId();
  const newBodyId = tool === "copy" || tool === "mirror" ? uid("bd") : null;
  commitDoc((document) => {
    if (tool === "fillet") {
      document.features.push({ id: featureId, type: "fillet", name: featureName(document, "fillet", "圆角"), bodyId, radius: 2 });
    } else if (tool === "chamfer") {
      document.features.push({ id: featureId, type: "chamfer", name: featureName(document, "chamfer", "倒角"), bodyId, distance: 2 });
    } else if (tool === "shell") {
      document.features.push({
        id: featureId,
        type: "shell",
        name: featureName(document, "shell", "抽壳"),
        bodyId,
        thickness: 2,
        direction: { x: 0, y: 0, z: 1 },
      });
    } else if (tool === "move" || tool === "copy") {
      document.features.push({
        id: featureId,
        type: "move",
        name: featureName(document, "move", tool === "copy" ? "复制" : "移动"),
        bodyId,
        dx: tool === "copy" ? 30 : 20,
        dy: 0,
        dz: 0,
        copy: tool === "copy",
        newBodyId: tool === "copy" ? newBodyId : null,
      });
      if (tool === "copy" && newBodyId) pushBody(document, newBodyId, featureId);
    } else if (tool === "mirror") {
      document.features.push({
        id: featureId,
        type: "mirror",
        name: featureName(document, "mirror", "镜像"),
        bodyId,
        planeId,
        newBodyId: newBodyId ?? uid("bd"),
      });
      const mirror = document.features.find((feature) => feature.id === featureId);
      if (mirror?.type === "mirror") pushBody(document, mirror.newBodyId, featureId);
    } else if (tool === "linear") {
      document.features.push({
        id: featureId,
        type: "linearPattern",
        name: featureName(document, "linearPattern", "线性阵列"),
        bodyId,
        direction: { x: 1, y: 0, z: 0 },
        spacing: 30,
        count: 3,
      });
    } else {
      document.features.push({
        id: featureId,
        type: "circularPattern",
        name: featureName(document, "circularPattern", "圆周阵列"),
        bodyId,
        center: { x: 0, y: 0, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        angleDeg: 90,
        count: 4,
      });
    }
  }, {
    tool: "select",
    extrudeDraft: null,
    revolveDraft: null,
    pendingBoolean: null,
    selection: { kind: "feature", id: featureId },
    status: "特征已加入。改右侧参数会重新生成。",
  });
}

function selectedBodyId(): string | null {
  const selection = state.selection;
  if (!selection) return null;
  if (selection.kind === "body") return selection.id;
  if (selection.kind !== "feature") return null;
  const feature = state.doc.features.find((item) => item.id === selection.id);
  if (!feature) return null;
  if (feature.type === "boolean") return feature.targetBodyId;
  if (feature.type === "mirror") return feature.newBodyId;
  if (feature.type === "move") return feature.copy && feature.newBodyId ? feature.newBodyId : feature.bodyId;
  if (feature.type === "extrude" || feature.type === "revolve" || feature.type === "fillet" || feature.type === "chamfer" || feature.type === "shell" || feature.type === "linearPattern" || feature.type === "circularPattern") {
    return feature.bodyId;
  }
  return null;
}

function selectedPlaneId(): string {
  const selection = state.selection;
  if (selection?.kind === "plane") return selection.id;
  return "plane-xy";
}

function pushBody(document: DocumentModel, bodyId: string, featureId: string): void {
  document.bodies.push({
    id: bodyId,
    name: `实体 ${document.bodies.length + 1}`,
    color: BODY_COLORS[document.bodies.length % BODY_COLORS.length],
    visible: true,
    featureId,
  });
}

function featureName(document: DocumentModel, type: Feature["type"], label: string): string {
  const count = document.features.filter((feature) => feature.type === type).length + 1;
  return `${label} ${count}`;
}

function profileOf(feature: Feature): { entityId: string } | null {
  if (feature.type === "extrude" || feature.type === "revolve") return feature;
  return null;
}

function referencedBodyIds(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
      return [feature.bodyId];
    case "revolve":
      return feature.targetBodyId ? [feature.bodyId, feature.targetBodyId] : [feature.bodyId];
    case "boolean":
      return [feature.targetBodyId, feature.toolBodyId];
    case "fillet":
    case "chamfer":
    case "shell":
    case "linearPattern":
    case "circularPattern":
      return [feature.bodyId];
    case "move":
      return feature.newBodyId ? [feature.bodyId, feature.newBodyId] : [feature.bodyId];
    case "mirror":
      return [feature.bodyId, feature.newBodyId];
    default: {
      const unreachable: never = feature;
      return unreachable;
    }
  }
}

function clampAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-3600, Math.min(3600, value));
}
