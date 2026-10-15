import { createDocument } from "./document";
import type { DocumentModel, ExtrudeFeature, SketchEntity } from "./types";

const PLASTIC = "#b7c6d0";

function rectangle(id: string, x0: number, y0: number, x1: number, y1: number): SketchEntity {
  return { id, type: "rectangle", a: { x: x0, y: y0 }, b: { x: x1, y: y1 } };
}

function extrude(
  id: string,
  name: string,
  sketchId: string,
  entityId: string,
  start: number,
  end: number,
  bodyId: string,
): ExtrudeFeature {
  return {
    id,
    type: "extrude",
    name,
    sketchId,
    entityId,
    start,
    end,
    bodyId,
    wall: 0,
    sheet: false,
    draftAngle: 0,
  };
}

function solid(id: string, name: string, featureId: string, visible: boolean) {
  return {
    id,
    name,
    color: PLASTIC,
    visible,
    featureId,
    deflection: 0.18,
    faceDeflection: null,
    faceDirection: null,
  };
}

/** 桌面收纳盒：抽壳开口朝上，内有隔板，正面留一条拿取口。尺寸单位 mm。 */
export function createDeskOrganizer(): DocumentModel {
  const document = createDocument();
  document.sketches = [
    {
      id: "sk-outer",
      name: "外壳",
      planeId: "plane-xy",
      entities: [rectangle("en-outer", -88, -42, 88, 42)],
    },
    {
      id: "sk-walls",
      name: "隔板",
      planeId: "plane-xy",
      entities: [
        rectangle("en-long", -86, 6, 86, 9.2),
        rectangle("en-c1", -31, -41, -28, 10),
        rectangle("en-c2", 28, -41, 31, 10),
        rectangle("en-rear", -1.5, 6, 1.5, 41),
      ],
    },
    {
      id: "sk-notch",
      name: "前开口",
      planeId: "plane-xy",
      entities: [rectangle("en-notch", -34, -50, 34, -36.5)],
    },
  ];
  document.features = [
    extrude("ft-outer", "拉伸 外壳", "sk-outer", "en-outer", 0, 46, "body-tray"),
    {
      id: "ft-shell",
      type: "shell",
      name: "抽壳",
      bodyId: "body-tray",
      thickness: 2.6,
      direction: { x: 0, y: 0, z: 1 },
    },
    extrude("ft-long", "拉伸 纵隔板", "sk-walls", "en-long", 0, 43, "body-long"),
    {
      id: "ft-fuse-long",
      type: "boolean",
      name: "并集 纵隔板",
      operation: "fuse",
      targetBodyId: "body-tray",
      toolBodyId: "body-long",
      fuzzy: 0.05,
    },
    extrude("ft-c1", "拉伸 横隔板 1", "sk-walls", "en-c1", 0, 43, "body-c1"),
    {
      id: "ft-fuse-c1",
      type: "boolean",
      name: "并集 横隔板 1",
      operation: "fuse",
      targetBodyId: "body-tray",
      toolBodyId: "body-c1",
      fuzzy: 0.05,
    },
    extrude("ft-c2", "拉伸 横隔板 2", "sk-walls", "en-c2", 0, 43, "body-c2"),
    {
      id: "ft-fuse-c2",
      type: "boolean",
      name: "并集 横隔板 2",
      operation: "fuse",
      targetBodyId: "body-tray",
      toolBodyId: "body-c2",
      fuzzy: 0.05,
    },
    extrude("ft-rear", "拉伸 后隔板", "sk-walls", "en-rear", 0, 43, "body-rear"),
    {
      id: "ft-fuse-rear",
      type: "boolean",
      name: "并集 后隔板",
      operation: "fuse",
      targetBodyId: "body-tray",
      toolBodyId: "body-rear",
      fuzzy: 0.05,
    },
    extrude("ft-notch", "拉伸 前开口", "sk-notch", "en-notch", 12, 48, "body-notch"),
    {
      id: "ft-cut-notch",
      type: "boolean",
      name: "差集 前开口",
      operation: "cut",
      targetBodyId: "body-tray",
      toolBodyId: "body-notch",
      fuzzy: 0.05,
    },
  ];
  document.bodies = [
    solid("body-tray", "收纳盒", "ft-outer", true),
    solid("body-long", "纵隔板", "ft-long", false),
    solid("body-c1", "横隔板 1", "ft-c1", false),
    solid("body-c2", "横隔板 2", "ft-c2", false),
    solid("body-rear", "后隔板", "ft-rear", false),
    solid("body-notch", "前开口", "ft-notch", false),
  ];
  return document;
}
