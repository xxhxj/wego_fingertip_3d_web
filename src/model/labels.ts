import type { Feature } from "./types";

export function featureSummary(feature: Feature): string {
  switch (feature.type) {
    case "extrude": {
      const span = `${feature.start} → ${feature.end} mm`;
      if (feature.sheet) return `片体 ${span}`;
      if (feature.wall > 0) return `薄壁 ${feature.wall} mm，${span}`;
      if (feature.draftAngle !== 0) return `${span}，拔模 ${feature.draftAngle}°`;
      return span;
    }
    case "revolve": {
      const action = feature.operation === "fuse" ? "求和" : feature.operation === "cut" ? "求差" : "新建";
      return `${feature.axis.toUpperCase()} 轴 ${feature.angleDeg}° · ${action}`;
    }
    case "boolean":
      return feature.operation === "fuse" ? "并集" : feature.operation === "cut" ? "差集" : "交集";
    case "step":
      return "STEP";
    case "fillet":
      return feature.edges && feature.edges.length > 0
        ? `R${feature.radius} mm · ${feature.edges.length} 条边`
        : `R${feature.radius} mm · 全部边`;
    case "chamfer":
      return `${feature.distance} mm`;
    case "shell":
      return `壁厚 ${feature.thickness} mm`;
    case "move":
      return feature.copy
        ? `复制 ${feature.dx}, ${feature.dy}, ${feature.dz}`
        : `移动 ${feature.dx}, ${feature.dy}, ${feature.dz}`;
    case "mirror":
      return "镜像副本";
    case "linearPattern":
      return `${feature.count} 个，间距 ${feature.spacing} mm`;
    case "circularPattern":
      return `${feature.count} 个，间隔 ${feature.angleDeg}°`;
    case "sweep":
      return "沿路径";
    case "loft":
      return `${feature.profiles.length} 个截面${feature.ruled ? " · 直纹" : ""}`;
    case "push":
      return `${feature.distance} mm`;
    case "split":
      return feature.keep === "both" ? "保留两侧" : feature.keep === "positive" ? "保留法向一侧" : "保留反法向一侧";
    default: {
      const unreachable: never = feature;
      return unreachable;
    }
  }
}
