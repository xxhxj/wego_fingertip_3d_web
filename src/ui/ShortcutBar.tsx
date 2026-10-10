import { beginExtrude, deleteSelection, isolateBody, setBodyVisible, showAllBodies, startSketch } from "../state/editor";
import { useEditor } from "../state/hooks";

export function ShortcutBar() {
  const editor = useEditor();
  const pointer = editor.pointer;
  const selection = editor.selection;
  if (!pointer || !selection) return null;
  if (selection.kind !== "plane" && selection.kind !== "body" && selection.kind !== "entity") return null;
  const left = Math.min(pointer.x + 14, window.innerWidth - 240);
  const top = Math.min(pointer.y + 16, window.innerHeight - 52);
  return (
    <div className="shortcut" style={{ left, top }}>
      {selection.kind === "plane" && <button type="button" onClick={() => startSketch(selection.id)}>在此开草图</button>}
      {selection.kind === "entity" && (
        <button type="button" onClick={() => beginExtrude(selection.sketchId, selection.entityId)}>拉伸</button>
      )}
      {selection.kind === "body" && (
        <>
          <button type="button" onClick={() => setBodyVisible(selection.id, false)}>隐藏</button>
          <button type="button" onClick={() => isolateBody(selection.id)}>单独显示</button>
          <button type="button" onClick={showAllBodies}>全部显示</button>
          <button type="button" onClick={deleteSelection}>删除</button>
        </>
      )}
    </div>
  );
}
