import type { Tool } from "../model/types";
import { setTool } from "../state/editor";
import { useEditor } from "../state/hooks";

const GROUPS: { label: string; tools: { id: Tool; label: string; hint: string }[] }[] = [
  {
    label: "草图",
    tools: [
      { id: "select", label: "选择", hint: "V" },
      { id: "rectangle", label: "矩形", hint: "R" },
      { id: "circle", label: "圆", hint: "C" },
      { id: "polyline", label: "多段线", hint: "L" },
      { id: "arc", label: "圆弧", hint: "A" },
    ],
  },
  {
    label: "成型",
    tools: [
      { id: "extrude", label: "拉伸", hint: "E" },
      { id: "revolve", label: "旋转", hint: "旋转体" },
      { id: "fuse", label: "并集", hint: "两个实体相加" },
      { id: "cut", label: "差集", hint: "从选中实体减去另一个" },
      { id: "common", label: "交集", hint: "只保留重叠部分" },
    ],
  },
  {
    label: "修饰",
    tools: [
      { id: "fillet", label: "圆角", hint: "对当前实体的边倒圆" },
      { id: "chamfer", label: "倒角", hint: "对当前实体的边倒角" },
      { id: "shell", label: "抽壳", hint: "去掉法向最接近 +Z 的面" },
    ],
  },
  {
    label: "变换",
    tools: [
      { id: "move", label: "移动", hint: "平移当前实体" },
      { id: "copy", label: "复制", hint: "复制并平移" },
      { id: "mirror", label: "镜像", hint: "对选中平面镜像，默认 XY" },
      { id: "linear", label: "线性", hint: "沿方向阵列" },
      { id: "circular", label: "圆周", hint: "绕轴阵列" },
    ],
  },
];

export function ToolRail() {
  const editor = useEditor();
  return (
    <nav className="rail" aria-label="建模工具">
      {GROUPS.map((group) => (
        <div key={group.label} className="rail-group">
          <span>{group.label}</span>
          {group.tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              data-tool={tool.id}
              className={editor.tool === tool.id ? "active" : ""}
              title={`${tool.label}（${tool.hint}）`}
              onClick={() => setTool(tool.id)}
            >
              <Icon name={tool.id} />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Icon({ name }: { name: Tool }) {
  if (name === "select") return <svg viewBox="0 0 24 24"><path d="M6 4l4.5 15 2.2-5.3L18 11.5z" /></svg>;
  if (name === "rectangle") return <svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" /></svg>;
  if (name === "circle") return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" /></svg>;
  if (name === "polyline") return <svg viewBox="0 0 24 24"><path d="M5 17l5-8 4 4 5-7" /></svg>;
  if (name === "arc") return <svg viewBox="0 0 24 24"><path d="M6 16a8 8 0 0 1 12-2" /></svg>;
  if (name === "revolve") return <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8" /><path d="M12 4v6" /></svg>;
  if (name === "fuse") return <svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" /></svg>;
  if (name === "cut") return <svg viewBox="0 0 24 24"><rect x="4" y="8" width="10" height="10" /><path d="M12 6h8v8" /></svg>;
  if (name === "common") return <svg viewBox="0 0 24 24"><rect x="5" y="7" width="9" height="9" /><rect x="10" y="10" width="9" height="9" /></svg>;
  if (name === "fillet") return <svg viewBox="0 0 24 24"><path d="M6 18V10a4 4 0 0 1 4-4h8" /></svg>;
  if (name === "chamfer") return <svg viewBox="0 0 24 24"><path d="M6 18V9l5-5h7v14" /></svg>;
  if (name === "shell") return <svg viewBox="0 0 24 24"><path d="M6 8h12v10H6z" /><path d="M9 11h6v4H9z" /></svg>;
  if (name === "move" || name === "copy") return <svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16M12 4l-3 3M12 4l3 3M20 12l-3-3M20 12l-3 3" /></svg>;
  if (name === "mirror") return <svg viewBox="0 0 24 24"><path d="M12 4v16" /><path d="M8 8l-3 4 3 4M16 8l3 4-3 4" /></svg>;
  if (name === "linear") return <svg viewBox="0 0 24 24"><rect x="3" y="8" width="5" height="8" /><rect x="10" y="8" width="5" height="8" /><rect x="17" y="8" width="4" height="8" /></svg>;
  if (name === "circular") return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><rect x="15" y="4" width="4" height="4" /><rect x="15" y="16" width="4" height="4" /><rect x="5" y="10" width="4" height="4" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M8 16V8m0 0l6 4-6 4" /><path d="M8 8h8v8" /></svg>;
}
