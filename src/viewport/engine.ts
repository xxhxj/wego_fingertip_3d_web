import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { normalize, rayAxisScalar, rayPlane, snap2, toWorld, worldToPlane, yAxis } from "../model/math";
import { centroidOf, isClosed, sampleDraft, sampleEntity } from "../model/profiles";
import type { PlaneFrame, Sample, SketchEntity, Vec2, Vec3 } from "../model/types";
import {
  armFaceOffset,
  armProfile,
  cancelExtrude,
  cancelFaceOffset,
  confirmExtrude,
  confirmFaceOffset,
  drawingClick,
  drawingDown,
  drawingMove,
  drawingUp,
  addMeasureHit,
  getState,
  pickFaceAt,
  select,
  setDraftDistances,
  setFaceDistance,
  setViewportMessage,
  pickEdgeAt,
  startSketch,
  subscribe,
} from "../state/editor";
import { getGesture, setGesture, subscribeGesture } from "../state/gesture";

export type ViewName = "iso" | "top" | "bottom" | "front" | "back" | "left" | "right";

export type DisplayMode = "shaded" | "wireframe";

export interface ViewportApi {
  dispose: () => void;
  look: (view: ViewName) => void;
  alignToActiveSketch: () => void;
  setDisplayMode: (mode: DisplayMode) => void;
  capture: () => string;
}

const PLANE_SIZE = 180;
let current: ViewportApi | null = null;

export function getViewport(): ViewportApi | null {
  return current;
}

export function mountViewport(canvas: HTMLCanvasElement): ViewportApi {
  let disposed = false;
  let applyView: ((view: ViewName) => void) | null = null;
  let align: (() => void) | null = null;
  let applyDisplay: ((mode: DisplayMode) => void) | null = null;
  let pendingView: ViewName | null = null;
  let pendingDisplay: DisplayMode | null = null;
  const api: ViewportApi = {
    dispose() {
      disposed = true;
      if (current === api) current = null;
    },
    look(view) {
      if (applyView) applyView(view);
      else pendingView = view;
    },
    alignToActiveSketch() {
      align?.();
    },
    setDisplayMode(mode) {
      if (applyDisplay) applyDisplay(mode);
      else pendingDisplay = mode;
    },
    capture: () => "",
  };
  current = api;
  void start();
  return api;

  async function start(): Promise<void> {
    if (!navigator.gpu) {
      setViewportMessage("当前浏览器没有 WebGPU。请用桌面版 Chrome 或 Edge 打开。");
      return;
    }
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    try {
      await renderer.init();
    } catch (error) {
      setViewportMessage(error instanceof Error ? error.message : "WebGPU 初始化失败");
      return;
    }
    if (disposed) {
      renderer.dispose();
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    (renderer as unknown as { localClippingEnabled: boolean }).localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    api.capture = () => {
      try {
        return renderer.domElement.toDataURL("image/png");
      } catch {
        return "";
      }
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e6e7ea");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.minDistance = 8;
    controls.maxDistance = 8000;
    controls.mouseButtons.LEFT = -1 as typeof THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xf7f8fb, 0xb7c0ca, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(140, -90, 220);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd5e2f2, 1.1);
    fill.position.set(-160, 120, 40);
    scene.add(fill);

    const grid = new THREE.GridHelper(500, 10, 0xb7bcc4, 0xd5d8de);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(72));

    const planeGroup = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const sketchGroup = new THREE.Group();
    const handleGroup = new THREE.Group();
    scene.add(planeGroup, bodyGroup, sketchGroup, handleGroup);

    const planeMeshes = new Map<string, THREE.Mesh>();

    const bodies = new Map<string, { mesh: THREE.Mesh; edges: THREE.LineSegments }>();
    const previewMaterial = new THREE.MeshStandardMaterial({
      color: 0x14919b,
      transparent: true,
      opacity: 0.38,
      roughness: 0.35,
      metalness: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const previewEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1d4f91 }),
    );
    const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), previewMaterial);
    previewMesh.visible = false;
    previewEdges.visible = false;
    previewEdges.raycast = () => undefined;
    bodyGroup.add(previewMesh, previewEdges);

    const gizmo = new THREE.Group();
    const dash = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x2c3138, dashSize: 2.4, gapSize: 1.6, depthTest: false }),
    );
    dash.frustumCulled = false;
    const upCone = new THREE.Mesh(
      new THREE.ConeGeometry(4.2, 11, 18),
      new THREE.MeshBasicMaterial({ color: 0x2f6feb, depthTest: false }),
    );
    const downCone = new THREE.Mesh(
      new THREE.ConeGeometry(3.4, 10, 18),
      new THREE.MeshBasicMaterial({ color: 0x1c2430, depthTest: false }),
    );
    upCone.geometry.translate(0, 5.5, 0);
    downCone.geometry.translate(0, 5, 0);
    upCone.rotation.x = Math.PI / 2;
    downCone.rotation.x = -Math.PI / 2;
    upCone.renderOrder = 6;
    downCone.renderOrder = 6;
    dash.renderOrder = 5;
    gizmo.add(dash, upCone, downCone);
    gizmo.visible = false;
    scene.add(gizmo);
    const sketchGrid = planeGrid(160, 10);
    sketchGrid.visible = false;
    scene.add(sketchGrid);
    const overlay = canvas.parentElement ?? document.body;
    const readout = document.createElement("div");
    readout.className = "pull-readout";
    readout.hidden = true;
    const totalTag = document.createElement("span");
    totalTag.className = "dim-tag";
    totalTag.textContent = "总计";
    const distanceInput = document.createElement("input");
    distanceInput.className = "pull-input";
    distanceInput.inputMode = "decimal";
    distanceInput.setAttribute("aria-label", "距离");
    const unit = document.createElement("span");
    unit.textContent = "毫米";
    const field = document.createElement("label");
    field.className = "pull-field";
    field.append(distanceInput, unit);
    readout.append(totalTag, field);
    const widthLabel = chip("dim-label");
    const heightLabel = chip("dim-label");
    overlay.append(readout, widthLabel, heightLabel);
    distanceInput.addEventListener("input", () => {
      const value = Number(distanceInput.value);
      if (!Number.isFinite(value)) return;
      const pull = pullTarget();
      if (!pull) return;
      if (pull.kind === "extrude") {
        const draft = getState().extrudeDraft;
        if (!draft) return;
        const sign = draft.end - draft.start < 0 ? -1 : 1;
        setDraftDistances(draft.start, draft.start + sign * value);
      } else setFaceDistance(value - pull.span);
    });
    distanceInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        if (getState().faceDraft) confirmFaceOffset();
        else if (getState().extrudeDraft) confirmExtrude();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (getState().faceDraft) cancelFaceOffset();
        else if (getState().extrudeDraft) cancelExtrude();
      }
    });
    const profileMeshes: THREE.Mesh[] = [];

    const raycaster = new THREE.Raycaster();
    let appliedRevision = -1;
    let drag: { kind: "extrude" | "face"; pointerId: number; grab: number } | null = null;
    let clickStart: { x: number; y: number } | null = null;

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const placeCamera = (position: Vec3, up: Vec3) => {
      camera.up.set(up.x, up.y, up.z);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    applyView = (view) => {
      if (view === "top") placeCamera({ x: 0, y: 0, z: 320 }, { x: 0, y: 1, z: 0 });
      else if (view === "bottom") placeCamera({ x: 0, y: 0, z: -320 }, { x: 0, y: -1, z: 0 });
      else if (view === "front") placeCamera({ x: 0, y: -320, z: 0 }, { x: 0, y: 0, z: 1 });
      else if (view === "back") placeCamera({ x: 0, y: 320, z: 0 }, { x: 0, y: 0, z: 1 });
      else if (view === "right") placeCamera({ x: 320, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      else if (view === "left") placeCamera({ x: -320, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      else placeCamera({ x: 190, y: -190, z: 150 }, { x: 0, y: 0, z: 1 });
    };
    align = () => {
      const currentState = getState();
      const sketch = currentState.doc.sketches.find((item) => item.id === currentState.activeSketchId);
      const plane = currentState.doc.planes.find((item) => item.id === sketch?.planeId);
      if (!plane) return;
      const normal = normalize(plane.normal);
      const y = yAxis(plane);
      placeCamera(
        { x: normal.x * 280, y: normal.y * 280, z: normal.z * 280 },
        y,
      );
    };
    let shownView: ViewName | "" = "";
    applyView(pendingView ?? getState().viewName);
    shownView = pendingView ?? getState().viewName;
    pendingView = null;
    const clipPlane = new THREE.Plane();
    let displayMode: DisplayMode = pendingDisplay ?? "shaded";
    pendingDisplay = null;
    applyDisplay = (mode) => {
      displayMode = mode;
      syncAppearance(getState());
    };

    const sync = () => {
      const currentState = getState();
      if (currentState.viewName !== shownView) {
        shownView = currentState.viewName;
        applyView?.(shownView);
      }
      if (currentState.meshRevision !== appliedRevision) {
        appliedRevision = currentState.meshRevision;
        syncBodies(currentState);
        syncPreview(currentState);
      }
      syncAppearance(currentState);
      syncPlanes(currentState);
      syncHandles();
      syncSketch();
      grid.visible = !currentState.activeSketchId;
      const sketching = currentState.doc.sketches.find((item) => item.id === currentState.activeSketchId);
      const sketchPlane = currentState.doc.planes.find((item) => item.id === sketching?.planeId);
      sketchGrid.visible = Boolean(sketchPlane);
      if (sketchPlane) orientPlane(sketchGrid, sketchPlane);
    };
    const unsub = subscribe(sync);
    const unsubGesture = subscribeGesture(syncSketch);
    sync();

    const pivotOfView = () => {
      const current = getState();
      const sketch = current.doc.sketches.find((item) => item.id === current.activeSketchId);
      const selectedPlane = current.selection?.kind === "plane" ? current.selection.id : null;
      const planeId = sketch?.planeId ?? selectedPlane;
      const plane = current.doc.planes.find((item) => item.id === planeId);
      if (!plane) return new THREE.Vector3(0, 0, 0);
      return new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z);
    };
    const onNavigateDown = (event: PointerEvent) => {
      if (event.button !== 1 && event.button !== 2) return;
      event.preventDefault();
      if (event.button !== 2) return;
      const pivot = pivotOfView();
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(pivot);
      camera.position.copy(pivot).add(offset);
      controls.update();
    };
    canvas.addEventListener("pointerdown", onNavigateDown, true);

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const pull = pullTarget();
      if (pull && pullHit(event, pull)) {
        const scalar = axisDistance(event, pull.origin, pull.normal) ?? 0;
        drag = { kind: pull.kind, pointerId: event.pointerId, grab: scalar - pull.distance };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const tool = getState().tool;
      if (isDrawTool(tool) && !getState().activeSketchId) {
        const planeId = planeUnderPointer(event);
        if (!planeId) return;
        startSketch(planeId, tool);
      }
      if (isDrawTool(tool) && getState().activeSketchId) {
        const point = sketchPoint(event);
        if (!point) return;
        if (tool === "rectangle" || tool === "circle") {
          drawingDown(point);
          canvas.setPointerCapture(event.pointerId);
        }
        clickStart = { x: event.clientX, y: event.clientY };
        return;
      }
      clickStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag) {
        const pull = pullTarget();
        if (!pull) return;
        const distance = axisDistance(event, pull.origin, pull.normal);
        if (distance == null) return;
        const snapped = snapNumber(distance - drag.grab, event.altKey);
        if (drag.kind === "extrude") {
          const draft = getState().extrudeDraft;
          if (draft) setDraftDistances(draft.start, snapped);
        } else setFaceDistance(snapped);
        return;
      }
      const tool = getState().tool;
      if (isDrawTool(tool) && getState().activeSketchId) {
        const point = sketchPoint(event);
        if (!point) return;
        if (tool === "rectangle" || tool === "circle") {
          if (getGesture().draft) drawingMove(point);
        } else {
          const gestureDraft = getGesture().draft;
          if (gestureDraft && (gestureDraft.type === "polyline" || gestureDraft.type === "arc" || gestureDraft.type === "line" || gestureDraft.type === "spline")) drawingMove(point);
          else setGesture({ readout: `u ${point.x.toFixed(1)}  v ${point.y.toFixed(1)}` });
        }
        return;
      }
      highlightPlane(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (drag && drag.pointerId === event.pointerId) {
        drag = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      const moved = clickStart ? Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) : 0;
      clickStart = null;
      const tool = getState().tool;
      const point = sketchPoint(event);
      if (isDrawTool(tool) && point && getState().activeSketchId) {
        if (tool === "rectangle" || tool === "circle") {
          drawingUp(point);
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          return;
        }
        if (moved < 5) drawingClick(point, closeToFirst(event));
        return;
      }
      const picks = tool === "select" || tool === "measure" || tool === "sweep" || tool === "loft" || tool === "push" || tool === "split";
      if (moved < 5 && picks) pick(event);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("contextmenu", prevent);
    setViewportMessage(null);

    renderer.setAnimationLoop(() => {
      controls.update();
      const scale = Math.max(camera.position.distanceTo(gizmo.position) / 220, 0.85);
      upCone.scale.setScalar(scale);
      downCone.scale.setScalar(scale);
      renderer.render(scene, camera);
    });

    api.dispose = () => {
      disposed = true;
      if (current === api) current = null;
      unsub();
      unsubGesture();
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onNavigateDown, true);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("contextmenu", prevent);
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeGroup(planeGroup);
      disposeGroup(bodyGroup);
      disposeGroup(sketchGroup);
      disposeGroup(handleGroup);
      sketchGrid.geometry.dispose();
      (sketchGrid.material as THREE.Material).dispose();
      disposeGroup(gizmo);
      readout.remove();
      widthLabel.remove();
      heightLabel.remove();
      renderer.dispose();
    };

    function syncPlanes(currentState: ReturnType<typeof getState>): void {
      const alive = new Set(currentState.doc.planes.map((plane) => plane.id));
      for (const [id, mesh] of planeMeshes) {
        if (alive.has(id)) continue;
        planeGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        planeMeshes.delete(id);
      }
      for (const plane of currentState.doc.planes) {
        let mesh = planeMeshes.get(plane.id);
        if (!mesh) {
          const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
          const color = planeColor(plane.id);
          const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(geometry, material);
          mesh.userData = { kind: "plane", id: plane.id };
          const border = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color }),
          );
          border.raycast = () => undefined;
          mesh.add(border);
          planeGroup.add(mesh);
          planeMeshes.set(plane.id, mesh);
        }
        orientPlane(mesh, plane);
      }
    }

    function syncBodies(currentState: ReturnType<typeof getState>): void {
      const alive = new Set(Object.keys(currentState.meshes));
      for (const [id, visual] of bodies) {
        if (alive.has(id)) continue;
        bodyGroup.remove(visual.mesh, visual.edges);
        visual.mesh.geometry.dispose();
        visual.edges.geometry.dispose();
        (visual.mesh.material as THREE.Material).dispose();
        (visual.edges.material as THREE.Material).dispose();
        bodies.delete(id);
      }
      for (const [id, meshState] of Object.entries(currentState.meshes)) {
        let visual = bodies.get(id);
        if (!visual) {
          const mesh = new THREE.Mesh(
            new THREE.BufferGeometry(),
            new THREE.MeshStandardMaterial({ color: 0x2f6fed, roughness: 0.42, metalness: 0.06, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
          );
          const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x5e6974 }));
          edges.raycast = () => undefined;
          mesh.userData = { kind: "body", id };
          bodyGroup.add(mesh, edges);
          visual = { mesh, edges };
          bodies.set(id, visual);
        }
        replaceGeometry(visual.mesh, meshState.positions, meshState.normals, meshState.indices);
        replaceLines(visual.edges, meshState.edges);
      }
    }

    function syncPreview(currentState: ReturnType<typeof getState>): void {
      const preview = currentState.preview;
      previewMesh.visible = Boolean(preview);
      previewEdges.visible = Boolean(preview && preview.edges.length > 0);
      if (!preview) return;
      replaceGeometry(previewMesh, preview.positions, preview.normals, preview.indices);
      replaceLines(previewEdges, preview.edges);
    }

    function syncAppearance(currentState: ReturnType<typeof getState>): void {
      const selectedBody = currentState.selection?.kind === "body" ? currentState.selection.id : null;
      const clips = clippingOf(currentState);
      const wire = displayMode === "wireframe";
      previewMaterial.clippingPlanes = clips;
      previewMaterial.wireframe = wire;
      (previewEdges.material as THREE.LineBasicMaterial).clippingPlanes = clips;
      previewEdges.visible = Boolean(currentState.preview && currentState.preview.edges.length > 0 && !wire);
      for (const body of currentState.doc.bodies) {
        const visual = bodies.get(body.id);
        if (!visual) continue;
        visual.mesh.visible = body.visible;
        visual.edges.visible = body.visible && !wire;
        const material = visual.mesh.material as THREE.MeshStandardMaterial;
        material.wireframe = wire;
        material.color.set(body.color);
        material.emissive.set(selectedBody === body.id ? body.color : "#000000");
        material.emissiveIntensity = selectedBody === body.id ? 0.18 : 0;
        material.clippingPlanes = clips;
        (visual.edges.material as THREE.LineBasicMaterial).clippingPlanes = clips;
      }
      for (const [id, mesh] of planeMeshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        const selected = currentState.selection?.kind === "plane" && currentState.selection.id === id;
        material.opacity = selected ? 0.22 : 0.08;
      }
    }

    function clippingOf(currentState: ReturnType<typeof getState>): THREE.Plane[] {
      if (!currentState.sectionPlaneId) return [];
      const plane = currentState.doc.planes.find((item) => item.id === currentState.sectionPlaneId);
      if (!plane) return [];
      clipPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize(),
        new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z),
      );
      return [clipPlane];
    }

    function syncHandles(): void {
      const pull = pullTarget();
      gizmo.visible = Boolean(pull);
      if (!pull) {
        readout.hidden = true;
        return;
      }
      const direction = normalize(pull.normal);
      gizmo.position.set(pull.origin.x, pull.origin.y, pull.origin.z);
      const zAxis = new THREE.Vector3(direction.x, direction.y, direction.z);
      const helper = Math.abs(zAxis.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const xAxis = new THREE.Vector3().crossVectors(helper, zAxis).normalize();
      const yAxisVector = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      gizmo.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxisVector, zAxis));
      upCone.position.set(0, 0, pull.distance);
      downCone.position.set(0, 0, pull.distance);
      const tail = pull.kind === "extrude" ? 0 : -Math.max(pull.span, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, tail, 0, 0, pull.distance]), 3));
      dash.geometry.dispose();
      dash.geometry = geometry;
      dash.computeLineDistances();
      const total = pull.kind === "extrude"
        ? Math.abs(pull.distance - (getState().extrudeDraft?.start ?? 0))
        : pull.span + pull.distance;
      if (document.activeElement !== distanceInput) distanceInput.value = formatMm(Math.max(total, 0));
      placeElement(readout, {
        x: pull.origin.x + direction.x * (pull.distance + 18),
        y: pull.origin.y + direction.y * (pull.distance + 18),
        z: pull.origin.z + direction.z * (pull.distance + 18),
      });
    }

    function syncSketch(): void {
      clearGroup(sketchGroup);
      profileMeshes.length = 0;
      widthLabel.hidden = true;
      heightLabel.hidden = true;
      const currentState = getState();
      const drawing = Boolean(currentState.activeSketchId);
      for (const sketch of currentState.doc.sketches) {
        const plane = currentState.doc.planes.find((item) => item.id === sketch.planeId);
        if (!plane) continue;
        for (const entity of sketch.entities) {
          const sample = sampleEntity(entity);
          const selected = currentState.selection?.kind === "entity" && currentState.selection.entityId === entity.id;
          addSample(sample, plane, selected ? 0xf0b45a : 0x3d4c63, drawing);
          if (isClosed(entity)) addFill(sample, plane, sketch.id, entity.id, selected);
        }
      }
      const draft = getGesture().draft;
      const sketch = currentState.doc.sketches.find((item) => item.id === currentState.activeSketchId);
      const plane = currentState.doc.planes.find((item) => item.id === sketch?.planeId);
      if (draft && plane) {
        addSample(sampleDraft(draft), plane, 0x2f6feb, true);
        if (draft.type === "rectangle") labelRectangle(plane, draft.a, draft.b);
      }
    }

    function addSample(sample: Sample, plane: PlaneFrame, color: number, overlay: boolean): void {
      if (sample.points.length < 2) return;
      const flat: number[] = [];
      for (const point of sample.points) {
        const world = toWorld(plane, point);
        flat.push(world.x + plane.normal.x * 0.25, world.y + plane.normal.y * 0.25, world.z + plane.normal.z * 0.25);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(toSegments(flat, sample.closed), 3));
      const material = new THREE.LineBasicMaterial({ color, depthTest: !overlay });
      const line = new THREE.LineSegments(geometry, material);
      line.raycast = () => undefined;
      sketchGroup.add(line);
    }

    function sketchPoint(event: PointerEvent): Vec2 | null {
      const sketchId = getState().activeSketchId;
      const sketch = getState().doc.sketches.find((item) => item.id === sketchId);
      const plane = getState().doc.planes.find((item) => item.id === sketch?.planeId);
      if (!plane) return null;
      const hit = rayOnPlane(event, plane);
      if (!hit) return null;
      return snap2(worldToPlane(plane, hit), event.altKey);
    }

    function rayOnPlane(event: PointerEvent, plane: PlaneFrame): Vec3 | null {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const origin = raycaster.ray.origin;
      const direction = raycaster.ray.direction;
      return rayPlane(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: direction.x, y: direction.y, z: direction.z },
        plane,
      );
    }

    function closeToFirst(event: PointerEvent): boolean {
      const draft = getGesture().draft;
      if (draft?.type !== "polyline" || draft.points.length < 3) return false;
      const sketch = getState().doc.sketches.find((item) => item.id === getState().activeSketchId);
      const plane = getState().doc.planes.find((item) => item.id === sketch?.planeId);
      if (!plane) return false;
      const world = toWorld(plane, draft.points[0]);
      const screen = project(world);
      if (!screen) return false;
      return Math.hypot(screen.x - event.clientX, screen.y - event.clientY) < 12;
    }

    function pick(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const hits = raycaster.intersectObjects([...bodies.values()].map((visual) => visual.mesh).filter((mesh) => mesh.visible), false);
      const pointer = { x: event.clientX, y: event.clientY };
      const current = getState();
      const edgeHit = closestEdgePoint();
      if (current.tool === "measure") {
        if (edgeHit) addMeasureHit({ point: edgeHit.point, direction: edgeHit.direction });
        else if (hits[0]) {
          const point = hits[0].point;
          addMeasureHit({ point: { x: point.x, y: point.y, z: point.z }, direction: null });
        }
        return;
      }
      if (current.edgePick && edgeHit) {
        void pickEdgeAt(edgeHit.bodyId, edgeHit.point);
        return;
      }
      if (current.pickFilter === "edge") {
        if (edgeHit) select({ kind: "body", id: edgeHit.bodyId }, pointer);
        else select(null, pointer);
        return;
      }
      if (current.tool === "push" || current.pickFilter === "face") {
        const hit = hits[0];
        if (hit?.object.userData.kind === "body") {
          void pickFaceAt(String(hit.object.userData.id), { x: hit.point.x, y: hit.point.y, z: hit.point.z });
          return;
        }
        select(null, pointer);
        return;
      }
      if (current.pickFilter === "sketch") {
        selectPlane(pointer, true);
        return;
      }
      if (current.pickFilter === "body") {
        if (hits[0]?.object.userData.kind === "body") select({ kind: "body", id: String(hits[0].object.userData.id) }, pointer);
        else select(null, pointer);
        return;
      }
      if (current.extrudeDraft) return;
      const profileHits = raycaster.intersectObjects(profileMeshes, false);
      const profile = profileHits[0];
      const bodyHit = hits[0];
      const direct = current.tool === "select" && current.pickFilter === "all" && !current.pendingBoolean && !current.pendingSweep && current.pendingLoft.length === 0 && !current.edgePick;
      const profileFirst = Boolean(profile && (!bodyHit || profile.distance + 0.5 < bodyHit.distance));
      if (direct && profileFirst && profile?.object.userData.kind === "profile") {
        armProfile(String(profile.object.userData.sketchId), String(profile.object.userData.entityId));
        return;
      }
      if (direct && bodyHit?.object.userData.kind === "body") {
        void armFaceOffset(String(bodyHit.object.userData.id), { x: bodyHit.point.x, y: bodyHit.point.y, z: bodyHit.point.z });
        return;
      }
      if (bodyHit?.object.userData.kind === "body") {
        select({ kind: "body", id: String(bodyHit.object.userData.id) }, pointer);
        return;
      }
      selectPlane(pointer, false);
    }

    function selectPlane(pointer: { x: number; y: number }, preferSketch: boolean): void {
      const planeHits = raycaster.intersectObjects([...planeMeshes.values()], false);
      if (planeHits[0]?.object.userData.kind === "plane") {
        const id = String(planeHits[0].object.userData.id);
        if (preferSketch) {
          const sketch = getState().doc.sketches.find((item) => item.planeId === id);
          if (sketch) {
            select({ kind: "sketch", id: sketch.id }, pointer);
            return;
          }
        }
        select({ kind: "plane", id }, pointer);
        return;
      }
      select(null, pointer);
    }

    function closestEdgePoint(): { bodyId: string; point: Vec3; direction: Vec3 } | null {
      const meshes = getState().meshes;
      const bodiesInDoc = getState().doc.bodies;
      let best: { bodyId: string; point: Vec3; direction: Vec3; distance: number } | null = null;
      const threshold = camera.position.distanceTo(controls.target) * 0.02;
      for (const body of bodiesInDoc) {
        if (!body.visible) continue;
        const edges = meshes[body.id]?.edges;
        if (!edges) continue;
        for (let index = 0; index < edges.length; index += 6) {
          const start = new THREE.Vector3(edges[index], edges[index + 1], edges[index + 2]);
          const end = new THREE.Vector3(edges[index + 3], edges[index + 4], edges[index + 5]);
          const point = closestPointOnSegment(raycaster.ray, start, end);
          if (!point) continue;
          const segment = end.clone().sub(start);
          if (segment.lengthSq() < 1e-8) continue;
          segment.normalize();
          const distance = raycaster.ray.distanceToPoint(point);
          if (distance > threshold) continue;
          if (!best || distance < best.distance) {
            best = {
              bodyId: body.id,
              point: { x: point.x, y: point.y, z: point.z },
              direction: { x: segment.x, y: segment.y, z: segment.z },
              distance,
            };
          }
        }
      }
      return best ? { bodyId: best.bodyId, point: best.point, direction: best.direction } : null;
    }

    function highlightPlane(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const hits = raycaster.intersectObjects([...planeMeshes.values()], false);
      const hovered = hits[0]?.object.userData.id as string | undefined;
      for (const [id, mesh] of planeMeshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        const selection = getState().selection;
        const selected = selection?.kind === "plane" && selection.id === id;
        material.opacity = selected ? 0.22 : hovered === id ? 0.14 : 0.08;
      }
    }

    function pullTarget(): { kind: "extrude" | "face"; origin: Vec3; normal: Vec3; distance: number; span: number } | null {
      const currentState = getState();
      const draft = currentState.extrudeDraft;
      if (draft) {
        const located = locate(draft.sketchId, draft.entityId);
        if (!located) return null;
        return {
          kind: "extrude",
          origin: toWorld(located.plane, centroidOf(located.entity)),
          normal: normalize(located.plane.normal),
          distance: draft.end,
          span: Math.abs(draft.end - draft.start),
        };
      }
      const face = currentState.faceDraft;
      if (!face) return null;
      return {
        kind: "face",
        origin: face.face.midpoint,
        normal: normalize(face.face.normal),
        distance: face.distance,
        span: face.span,
      };
    }

    function pullHit(event: PointerEvent, pull: NonNullable<ReturnType<typeof pullTarget>>): boolean {
      const tip = project({
        x: pull.origin.x + pull.normal.x * pull.distance,
        y: pull.origin.y + pull.normal.y * pull.distance,
        z: pull.origin.z + pull.normal.z * pull.distance,
      });
      const base = project(pull.origin);
      if (tip && Math.hypot(tip.x - event.clientX, tip.y - event.clientY) <= 28) return true;
      if (!tip || !base) return false;
      return distanceToSegment(event.clientX, event.clientY, base, tip) <= 16;
    }

    function locate(sketchId: string, entityId: string): { plane: PlaneFrame; entity: SketchEntity } | null {
      const currentState = getState();
      const sketch = currentState.doc.sketches.find((item) => item.id === sketchId);
      const entity = sketch?.entities.find((item) => item.id === entityId);
      const plane = currentState.doc.planes.find((item) => item.id === sketch?.planeId);
      if (!sketch || !entity || !plane) return null;
      return { plane, entity };
    }

    function axisDistance(event: PointerEvent, origin: Vec3, normal: Vec3): number | null {
      aim(event);
      return rayAxisScalar(
        { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z },
        { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z },
        origin,
        normalize(normal),
      );
    }

    function aim(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
    }

    function planeUnderPointer(event: PointerEvent): string | null {
      aim(event);
      const hits = raycaster.intersectObjects([...planeMeshes.values()], false);
      const id = hits[0]?.object.userData.id;
      return typeof id === "string" ? id : null;
    }

    function addFill(sample: Sample, plane: PlaneFrame, sketchId: string, entityId: string, selected: boolean): void {
      if (sample.points.length < 3) return;
      const positions: number[] = [];
      for (const point of sample.points) {
        const world = toWorld(plane, point);
        positions.push(world.x, world.y, world.z);
      }
      const indices: number[] = [];
      for (let index = 1; index < sample.points.length - 1; index += 1) indices.push(0, index, index + 1);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        color: selected ? 0x8eb6ff : 0xb9c7dc,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { kind: "profile", sketchId, entityId };
      sketchGroup.add(mesh);
      profileMeshes.push(mesh);
    }

    function labelRectangle(plane: PlaneFrame, a: Vec2, b: Vec2): void {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      placeChip(widthLabel, toWorld(plane, { x: (x0 + x1) / 2, y: y0 }), `${formatMm(x1 - x0)}毫米`);
      placeChip(heightLabel, toWorld(plane, { x: x0, y: (y0 + y1) / 2 }), `${formatMm(y1 - y0)}毫米`);
    }

    function placeChip(label: HTMLDivElement, point: Vec3, text: string): void {
      if (!placeElement(label, point)) return;
      label.textContent = text;
    }

    function placeElement(label: HTMLElement, point: Vec3): boolean {
      const screen = project(point);
      const parent = canvas.parentElement?.getBoundingClientRect();
      if (!screen || !parent) {
        label.hidden = true;
        return false;
      }
      label.hidden = false;
      label.style.left = `${screen.x - parent.left}px`;
      label.style.top = `${screen.y - parent.top}px`;
      return true;
    }

    function project(point: Vec3): { x: number; y: number } | null {
      const vector = new THREE.Vector3(point.x, point.y, point.z).project(camera);
      if (vector.z < -1 || vector.z > 1) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    }
  }
}

function orientPlane(mesh: THREE.Object3D, plane: PlaneFrame): void {
  const x = new THREE.Vector3(plane.xDir.x, plane.xDir.y, plane.xDir.z).normalize();
  const z = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  mesh.position.set(plane.origin.x, plane.origin.y, plane.origin.z);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function planeColor(id: string): number {
  if (id === "plane-xy") return 0x2f9e6b;
  if (id === "plane-xz") return 0x2f6fed;
  if (id === "plane-yz") return 0xd45353;
  return 0x7a5af8;
}

function closestPointOnSegment(ray: THREE.Ray, start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 | null {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq < 1e-8) return null;
  const origin = start.clone().sub(ray.origin);
  const dotRay = ray.direction.dot(segment);
  const dotOrigin = ray.direction.dot(origin);
  const denom = 1 - dotRay * dotRay / lengthSq;
  let along = 0;
  if (Math.abs(denom) > 1e-6) along = (dotOrigin * dotRay / lengthSq - origin.dot(segment) / lengthSq) / denom;
  along = Math.max(0, Math.min(1, along));
  return start.clone().addScaledVector(segment, along);
}

function isDrawTool(tool: string): boolean {
  return tool === "rectangle" || tool === "circle" || tool === "polyline" || tool === "line" || tool === "spline" || tool === "arc";
}

function snapNumber(value: number, fine: boolean): number {
  if (fine) return Math.round(value * 10) / 10;
  return Math.round(value);
}

function toSegments(flat: number[], closed: boolean): Float32Array<ArrayBuffer> {
  const count = flat.length / 3;
  const segments: number[] = [];
  const span = closed ? count : count - 1;
  for (let index = 0; index < span; index += 1) {
    const start = index * 3;
    const end = ((index + 1) % count) * 3;
    segments.push(flat[start], flat[start + 1], flat[start + 2], flat[end], flat[end + 1], flat[end + 2]);
  }
  const copy = new Float32Array(segments.length);
  copy.set(segments);
  return copy;
}

function prevent(event: Event): void {
  event.preventDefault();
}

function chip(className: string): HTMLDivElement {
  const label = document.createElement("div");
  label.className = className;
  label.hidden = true;
  return label;
}

function formatMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function planeGrid(size: number, step: number): THREE.LineSegments {
  const positions: number[] = [];
  for (let coordinate = -size; coordinate <= size; coordinate += step) {
    positions.push(-size, coordinate, 0.05, size, coordinate, 0.05);
    positions.push(coordinate, -size, 0.05, coordinate, size, 0.05);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xc5cad1 }));
  lines.raycast = () => undefined;
  return lines;
}

function projectFactor(x: number, y: number, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1) return 0;
  return ((x - start.x) * dx + (y - start.y) * dy) / lengthSq;
}

function distanceToSegment(x: number, y: number, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const factor = Math.max(0, Math.min(1, projectFactor(x, y, start, end)));
  const px = start.x + (end.x - start.x) * factor;
  const py = start.y + (end.y - start.y) * factor;
  return Math.hypot(x - px, y - py);
}

function replaceGeometry(mesh: THREE.Mesh, positions: Float32Array, normals: Float32Array, indices: Uint32Array): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  if (indices.length > 0) geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

function replaceLines(lines: THREE.LineSegments, edges: Float32Array): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(edges, 3));
  lines.geometry.dispose();
  lines.geometry = geometry;
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const object = child as THREE.Mesh;
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  }
}

function disposeGroup(group: THREE.Group): void {
  clearGroup(group);
}
