import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { normalize, rayAxisScalar, rayPlane, snap2, toWorld, worldToPlane, yAxis } from "../model/math";
import { centroidOf, sampleDraft, sampleEntity } from "../model/profiles";
import type { PlaneFrame, Sample, SketchEntity, Vec2, Vec3 } from "../model/types";
import {
  beginTransient,
  drawingClick,
  drawingDown,
  drawingMove,
  drawingUp,
  endTransient,
  getState,
  select,
  setDraftDistances,
  setFeatureDistances,
  setViewportMessage,
  pickEdgeAt,
  subscribe,
} from "../state/editor";
import { getGesture, setGesture, subscribeGesture } from "../state/gesture";

export type ViewName = "iso" | "top" | "front" | "right";

export interface ViewportApi {
  dispose: () => void;
  look: (view: ViewName) => void;
  alignToActiveSketch: () => void;
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
  let pendingView: ViewName | null = null;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dfe5ec");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.minDistance = 8;
    controls.maxDistance = 8000;
    controls.mouseButtons.LEFT = -1 as typeof THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xf7f8fb, 0xb7c0ca, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(140, -90, 220);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd5e2f2, 1.1);
    fill.position.set(-160, 120, 40);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0x9aa6b4, 0xc5ced8);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(48));

    const planeGroup = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const sketchGroup = new THREE.Group();
    const handleGroup = new THREE.Group();
    scene.add(planeGroup, bodyGroup, sketchGroup, handleGroup);

    const planeMeshes = new Map<string, THREE.Mesh>();

    const bodies = new Map<string, { mesh: THREE.Mesh; edges: THREE.LineSegments }>();
    const previewMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f6fed,
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

    const handleMaterial = new THREE.MeshBasicMaterial({ color: 0x1f6feb, depthTest: false });
    const startMaterial = new THREE.MeshBasicMaterial({ color: 0x0f9f6e, depthTest: false });
    const endHandle = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), handleMaterial);
    const startHandle = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10), startMaterial);
    const handleLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false }),
    );
    endHandle.renderOrder = 3;
    startHandle.renderOrder = 3;
    handleLine.renderOrder = 2;
    handleGroup.add(handleLine, startHandle, endHandle);
    handleGroup.visible = false;

    const raycaster = new THREE.Raycaster();
    let appliedRevision = -1;
    let drag: { which: "start" | "end"; pointerId: number } | null = null;
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
      else if (view === "front") placeCamera({ x: 0, y: -320, z: 0 }, { x: 0, y: 0, z: 1 });
      else if (view === "right") placeCamera({ x: 320, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
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
    applyView(pendingView ?? "iso");
    pendingView = null;

    const sync = () => {
      const currentState = getState();
      if (currentState.meshRevision !== appliedRevision) {
        appliedRevision = currentState.meshRevision;
        syncBodies(currentState);
        syncPreview(currentState);
      }
      syncAppearance(currentState);
      syncPlanes(currentState);
      syncHandles(currentState);
      syncSketch();
    };
    const unsub = subscribe(sync);
    const unsubGesture = subscribeGesture(syncSketch);
    sync();

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = extrudeTarget();
      const which = target ? handleHit(event, target) : null;
      if (which && target) {
        drag = { which, pointerId: event.pointerId };
        beginTransient();
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const tool = getState().tool;
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
        const target = extrudeTarget();
        if (!target) return;
        const distance = axisDistance(event, target);
        if (distance == null) return;
        const snapped = snapNumber(distance, event.altKey);
        if (target.mode === "draft") {
          setDraftDistances(drag.which === "start" ? snapped : target.start, drag.which === "end" ? snapped : target.end);
        } else {
          setFeatureDistances(target.featureId, drag.which === "start" ? snapped : target.start, drag.which === "end" ? snapped : target.end);
        }
        return;
      }
      const tool = getState().tool;
      if (isDrawTool(tool) && getState().activeSketchId) {
        const point = sketchPoint(event);
        if (!point) return;
        if (tool === "rectangle" || tool === "circle") {
          if (getGesture().draft) drawingMove(point);
        } else {
          const draft = getGesture().draft;
          if (draft && (draft.type === "polyline" || draft.type === "arc")) drawingMove(point);
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
        endTransient();
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
      if (moved < 5 && tool === "select") pick(event);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("contextmenu", prevent);
    setViewportMessage(null);

    renderer.setAnimationLoop(() => {
      controls.update();
      const distance = camera.position.distanceTo(endHandle.position);
      const scale = Math.max(distance / 90, 0.8);
      endHandle.scale.setScalar(scale);
      startHandle.scale.setScalar(scale);
      renderer.render(scene, camera);
    });

    api.dispose = () => {
      disposed = true;
      if (current === api) current = null;
      unsub();
      unsubGesture();
      observer.disconnect();
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
          const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1c2430 }));
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
      for (const body of currentState.doc.bodies) {
        const visual = bodies.get(body.id);
        if (!visual) continue;
        visual.mesh.visible = body.visible;
        visual.edges.visible = body.visible;
        const material = visual.mesh.material as THREE.MeshStandardMaterial;
        material.color.set(body.color);
        material.emissive.set(selectedBody === body.id ? body.color : "#000000");
        material.emissiveIntensity = selectedBody === body.id ? 0.28 : 0;
      }
      for (const [id, mesh] of planeMeshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        const selected = currentState.selection?.kind === "plane" && currentState.selection.id === id;
        material.opacity = selected ? 0.34 : 0.16;
      }
    }

    function syncHandles(currentState: ReturnType<typeof getState>): void {
      const target = extrudeTarget();
      handleGroup.visible = Boolean(target);
      if (!target) return;
      const origin = toWorld(target.plane, centroidOf(target.entity));
      const normal = normalize(target.plane.normal);
      const start = {
        x: origin.x + normal.x * target.start,
        y: origin.y + normal.y * target.start,
        z: origin.z + normal.z * target.start,
      };
      const end = {
        x: origin.x + normal.x * target.end,
        y: origin.y + normal.y * target.end,
        z: origin.z + normal.z * target.end,
      };
      startHandle.position.set(start.x, start.y, start.z);
      endHandle.position.set(end.x, end.y, end.z);
      const positions = new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]);
      handleLine.geometry.dispose();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      handleLine.geometry = geometry;
      handleMaterial.color.set(currentState.extrudeDraft ? 0x1f6feb : 0xd4880f);
    }

    function syncSketch(): void {
      clearGroup(sketchGroup);
      const currentState = getState();
      const drawing = Boolean(currentState.activeSketchId);
      for (const sketch of currentState.doc.sketches) {
        const plane = currentState.doc.planes.find((item) => item.id === sketch.planeId);
        if (!plane) continue;
        for (const entity of sketch.entities) {
          const selected = currentState.selection?.kind === "entity" && currentState.selection.entityId === entity.id;
          addSample(sampleEntity(entity), plane, selected ? 0xd4880f : 0x16325c, drawing);
        }
      }
      const draft = getGesture().draft;
      const sketch = currentState.doc.sketches.find((item) => item.id === currentState.activeSketchId);
      const plane = currentState.doc.planes.find((item) => item.id === sketch?.planeId);
      if (draft && plane) addSample(sampleDraft(draft), plane, 0x1f6feb, true);
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
      if (getState().edgePick) {
        const edgeHit = closestEdgePoint();
        if (edgeHit) {
          void pickEdgeAt(edgeHit.bodyId, edgeHit.point);
          return;
        }
      }
      if (hits[0]?.object.userData.kind === "body") {
        select({ kind: "body", id: String(hits[0].object.userData.id) }, pointer);
        return;
      }
      const planeHits = raycaster.intersectObjects([...planeMeshes.values()], false);
      if (planeHits[0]?.object.userData.kind === "plane") {
        select({ kind: "plane", id: String(planeHits[0].object.userData.id) }, pointer);
        return;
      }
      select(null, null);
    }

    function closestEdgePoint(): { bodyId: string; point: Vec3 } | null {
      const meshes = getState().meshes;
      const bodiesInDoc = getState().doc.bodies;
      let best: { bodyId: string; point: Vec3; distance: number } | null = null;
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
          const distance = raycaster.ray.distanceToPoint(point);
          if (distance > threshold) continue;
          if (!best || distance < best.distance) {
            best = { bodyId: body.id, point: { x: point.x, y: point.y, z: point.z }, distance };
          }
        }
      }
      return best ? { bodyId: best.bodyId, point: best.point } : null;
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
        material.opacity = selected ? 0.34 : hovered === id ? 0.26 : 0.16;
      }
    }

    function extrudeTarget(): {
      mode: "draft" | "feature";
      featureId: string;
      plane: PlaneFrame;
      entity: SketchEntity;
      start: number;
      end: number;
    } | null {
      const currentState = getState();
      const draft = currentState.extrudeDraft;
      if (draft) {
        const located = locate(draft.sketchId, draft.entityId);
        if (!located) return null;
        return { mode: "draft", featureId: "", ...located, start: draft.start, end: draft.end };
      }
      const picked = currentState.selection;
      const featureId = picked?.kind === "feature"
        ? picked.id
        : picked?.kind === "body"
          ? currentState.doc.bodies.find((body) => body.id === picked.id)?.featureId
          : undefined;
      const feature = currentState.doc.features.find((item) => item.id === featureId);
      if (!feature || feature.type !== "extrude") return null;
      const located = locate(feature.sketchId, feature.entityId);
      if (!located) return null;
      return { mode: "feature", featureId: feature.id, ...located, start: feature.start, end: feature.end };
    }

    function locate(sketchId: string, entityId: string): { plane: PlaneFrame; entity: SketchEntity } | null {
      const currentState = getState();
      const sketch = currentState.doc.sketches.find((item) => item.id === sketchId);
      const entity = sketch?.entities.find((item) => item.id === entityId);
      const plane = currentState.doc.planes.find((item) => item.id === sketch?.planeId);
      if (!sketch || !entity || !plane) return null;
      return { plane, entity };
    }

    function handleHit(event: PointerEvent, target: NonNullable<ReturnType<typeof extrudeTarget>>): "start" | "end" | null {
      const origin = toWorld(target.plane, centroidOf(target.entity));
      const normal = normalize(target.plane.normal);
      const start = project({
        x: origin.x + normal.x * target.start,
        y: origin.y + normal.y * target.start,
        z: origin.z + normal.z * target.start,
      });
      const end = project({
        x: origin.x + normal.x * target.end,
        y: origin.y + normal.y * target.end,
        z: origin.z + normal.z * target.end,
      });
      const endDist = end ? Math.hypot(end.x - event.clientX, end.y - event.clientY) : Infinity;
      const startDist = start ? Math.hypot(start.x - event.clientX, start.y - event.clientY) : Infinity;
      if (endDist <= 16 && endDist <= startDist) return "end";
      if (startDist <= 16) return "start";
      return null;
    }

    function axisDistance(event: PointerEvent, target: NonNullable<ReturnType<typeof extrudeTarget>>): number | null {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const origin = toWorld(target.plane, centroidOf(target.entity));
      return rayAxisScalar(
        { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z },
        { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z },
        origin,
        normalize(target.plane.normal),
      );
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

function orientPlane(mesh: THREE.Mesh, plane: PlaneFrame): void {
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
  return tool === "rectangle" || tool === "circle" || tool === "polyline" || tool === "arc";
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
