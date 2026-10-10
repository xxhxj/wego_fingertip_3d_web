import type { Tool } from "../model/types";
import { setTool } from "../state/editor";
import { useEditor } from "../state/hooks";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "选择", hint: "V" },
  { id: "rectangle", label: "矩形", hint: "R" },
  { id: "circle", label: "圆", hint: "C" },
  { id: "polyline", label: "多段线", hint: "L" },
  { id: "arc", label: "圆弧", hint: "A" },
  { id: "extrude", label: "拉伸", hint: "E" },
];

export function ToolRail() {
  const editor = useEditor();
  return (
    <nav className="rail" aria-label="建模工具">
      {TOOLS.map((tool) => (
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
    </nav>
  );
}

function Icon({ name }: { name: Tool }) {
  if (name === "select") return <svg viewBox="0 0 24 24"><path d="M6 4l4.5 15 2.2-5.3L18 11.5z" /></svg>;
  if (name === "rectangle") return <svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" /></svg>;
  if (name === "circle") return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" /></svg>;
  if (name === "polyline") return <svg viewBox="0 0 24 24"><path d="M5 17l5-8 4 4 5-7" /></svg>;
  if (name === "arc") return <svg viewBox="0 0 24 24"><path d="M6 16a8 8 0 0 1 12-2" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M8 16V8m0 0l6 4-6 4" /><path d="M8 8h8v8" /></svg>;
}
