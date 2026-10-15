import type { DocumentModel, SketchEntity } from "../model/types";
import { sampleEntity } from "../model/profiles";

/** 把草图按所在平面的二维坐标写成 DXF。不同平面的草图分成不同图层。 */
export function sketchesToDxf(document: DocumentModel): string | null {
  const entities: string[] = [];
  for (const sketch of document.sketches) {
    const layer = sketch.name.replace(/[\r\n]/g, " ") || sketch.id;
    for (const entity of sketch.entities) {
      entities.push(entityDxf(entity, layer));
    }
  }
  if (entities.length === 0) return null;
  return [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$INSUNITS",
    "70", "4",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
    ...entities,
    "0", "ENDSEC",
    "0", "EOF",
    "",
  ].join("\n");
}

function entityDxf(entity: SketchEntity, layer: string): string {
  if (entity.type === "circle") {
    return [
      "0", "CIRCLE",
      "8", layer,
      "10", String(entity.center.x),
      "20", String(entity.center.y),
      "30", "0",
      "40", String(entity.radius),
    ].join("\n");
  }
  const sample = sampleEntity(entity);
  if (sample.points.length < 2) return "";
  const body = [
    "0", "LWPOLYLINE",
    "8", layer,
    "90", String(sample.points.length),
    "70", sample.closed ? "1" : "0",
  ];
  for (const point of sample.points) {
    body.push("10", String(point.x), "20", String(point.y));
  }
  return body.join("\n");
}
