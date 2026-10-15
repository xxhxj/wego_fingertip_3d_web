import type { Mesh } from "occt-wasm";

export interface MeshPart {
  name: string;
  mesh: Mesh;
}

export function meshesToObj(parts: MeshPart[]): string {
  const lines: string[] = ["# Wego CAD"];
  let offset = 0;
  for (const part of parts) {
    const { positions, normals, indices } = part.mesh;
    lines.push(`o ${part.name.replace(/\s+/g, "_") || "body"}`);
    for (let index = 0; index < positions.length; index += 3) {
      lines.push(`v ${positions[index]} ${positions[index + 1]} ${positions[index + 2]}`);
    }
    const hasNormals = normals.length === positions.length;
    if (hasNormals) {
      for (let index = 0; index < normals.length; index += 3) {
        lines.push(`vn ${normals[index]} ${normals[index + 1]} ${normals[index + 2]}`);
      }
    }
    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] + offset + 1;
      const b = indices[index + 1] + offset + 1;
      const c = indices[index + 2] + offset + 1;
      lines.push(hasNormals ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`);
    }
    offset += positions.length / 3;
  }
  return `${lines.join("\n")}\n`;
}

export function meshesTo3mf(parts: MeshPart[]): Uint8Array {
  const vertices: string[] = [];
  const triangles: string[] = [];
  let offset = 0;
  for (const part of parts) {
    const { positions, indices } = part.mesh;
    for (let index = 0; index < positions.length; index += 3) {
      vertices.push(`<vertex x="${positions[index]}" y="${positions[index + 1]}" z="${positions[index + 2]}"/>`);
    }
    for (let index = 0; index < indices.length; index += 3) {
      triangles.push(
        `<triangle v1="${indices[index] + offset}" v2="${indices[index + 1] + offset}" v3="${indices[index + 2] + offset}"/>`,
      );
    }
    offset += positions.length / 3;
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>${vertices.join("")}</vertices>
        <triangles>${triangles.join("")}</triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const encoder = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(types) },
    { name: "_rels/.rels", data: encoder.encode(rels) },
    { name: "3D/3dmodel.model", data: encoder.encode(model) },
  ]);
}

function zipStore(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const local of locals) {
    output.set(local, cursor);
    cursor += local.length;
  }
  for (const central of centrals) {
    output.set(central, cursor);
    cursor += central.length;
  }
  output.set(end, cursor);
  return output;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
