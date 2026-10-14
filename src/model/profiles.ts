import type { Draft, Sample, SketchEntity, Vec2 } from "./types";

export function isClosed(entity: SketchEntity): boolean {
  if (entity.type === "rectangle") {
    return Math.abs(entity.b.x - entity.a.x) > 0.2 && Math.abs(entity.b.y - entity.a.y) > 0.2;
  }
  if (entity.type === "circle") return entity.radius > 0.2;
  if (entity.type === "polyline") return entity.closed && entity.points.length >= 3;
  if (entity.type === "line" || entity.type === "spline") return false;
  return separated(entity.start, entity.mid) && separated(entity.mid, entity.end) && separated(entity.start, entity.end);
}

export function entityLabel(entity: SketchEntity): string {
  if (entity.type === "rectangle") {
    const width = Math.abs(entity.b.x - entity.a.x);
    const height = Math.abs(entity.b.y - entity.a.y);
    return `矩形 ${width.toFixed(1)} × ${height.toFixed(1)}`;
  }
  if (entity.type === "circle") return `圆 R${entity.radius.toFixed(1)}`;
  if (entity.type === "polyline") return `多段线 ${entity.points.length} 点`;
  if (entity.type === "line") return "直线";
  if (entity.type === "spline") return `样条 ${entity.points.length} 点`;
  return "圆弧";
}

export function rectangleCorners(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function centroidOf(entity: SketchEntity): Vec2 {
  if (entity.type === "circle") return entity.center;
  if (entity.type === "rectangle") {
    return { x: (entity.a.x + entity.b.x) / 2, y: (entity.a.y + entity.b.y) / 2 };
  }
  const sample = sampleEntity(entity);
  if (sample.points.length === 0) return { x: 0, y: 0 };
  const sum = sample.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / sample.points.length, y: sum.y / sample.points.length };
}

export function sampleEntity(entity: SketchEntity): Sample {
  if (entity.type === "rectangle") return { points: rectangleCorners(entity.a, entity.b), closed: true };
  if (entity.type === "circle") return { points: circlePoints(entity.center, entity.radius, 64), closed: true };
  if (entity.type === "polyline") return { points: entity.points, closed: entity.closed };
  if (entity.type === "line") return { points: [entity.a, entity.b], closed: false };
  if (entity.type === "spline") return { points: sampleSpline(entity.points), closed: false };
  return { points: sampleArc(entity.start, entity.mid, entity.end), closed: true };
}

export function sampleDraft(draft: Draft): Sample {
  if (draft.type === "rectangle") return { points: rectangleCorners(draft.a, draft.b), closed: true };
  if (draft.type === "circle") {
    if (draft.radius < 0.05) return { points: [draft.center], closed: false };
    return { points: circlePoints(draft.center, draft.radius, 64), closed: true };
  }
  if (draft.type === "polyline" || draft.type === "line") {
    const points = draft.hover ? [...draft.points, draft.hover] : draft.points;
    return { points, closed: false };
  }
  if (draft.type === "spline") {
    const points = draft.hover ? [...draft.points, draft.hover] : draft.points;
    return { points: points.length >= 3 ? sampleSpline(points) : points, closed: false };
  }
  const points = draft.hover ? [...draft.points, draft.hover] : draft.points;
  if (points.length >= 3) return { points: sampleArc(points[0], points[1], points[2]), closed: true };
  return { points, closed: false };
}

function sampleSpline(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const samples: Vec2[] = [];
  const steps = 8;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      samples.push(catmull(p0, p1, p2, p3, t));
    }
  }
  samples.push(points[points.length - 1]);
  return samples;
}

function catmull(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function circlePoints(center: Vec2, radius: number, count: number): Vec2[] {
  const points: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return points;
}

function sampleArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const circle = circumcircle(start, mid, end);
  if (!circle) return [start, mid, end];
  const angleOf = (point: Vec2) => Math.atan2(point.y - circle.center.y, point.x - circle.center.x);
  const sweep = sweepContaining(angleOf(start), angleOf(end), angleOf(mid));
  const startAngle = angleOf(start);
  const points: Vec2[] = [];
  const steps = 32;
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + sweep * (index / steps);
    points.push({
      x: circle.center.x + Math.cos(angle) * circle.r,
      y: circle.center.y + Math.sin(angle) * circle.r,
    });
  }
  return points;
}

function sweepContaining(start: number, end: number, mid: number): number {
  const turn = Math.PI * 2;
  const relative = (angle: number) => {
    let value = (angle - start) % turn;
    if (value < 0) value += turn;
    return value;
  };
  const endOffset = relative(end);
  const midOffset = relative(mid);
  if (midOffset <= endOffset + 1e-4) return endOffset === 0 ? turn : endOffset;
  return endOffset - turn;
}

function circumcircle(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; r: number } | null {
  const determinant = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(determinant) < 1e-8) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / determinant;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / determinant;
  return { center: { x, y }, r: Math.hypot(a.x - x, a.y - y) };
}

function separated(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.2;
}
