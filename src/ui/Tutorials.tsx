import { loadDeskOrganizer, newDocument } from "../state/editor";
import { setHistory, setScreen } from "../state/shell";
import { useEditor } from "../state/hooks";

export function Tutorials() {
  const editor = useEditor();
  const ready = editor.kernel === "ready";
  return (
    <main className="learn">
      <header className="learn-head">
        <h1>教程</h1>
        <div className="learn-tools" aria-hidden="true">
          <span>+</span>
          <span>⌕</span>
        </div>
      </header>
      <section>
        <h2>应用内教程</h2>
        <div className="lesson-grid">
          <article className="lesson">
            <div className="lesson-copy lesson-blue">
              <h3>重温基本知识</h3>
              <p>回到工作区，在基准面上绘制矩形或圆，再拉伸成实体。</p>
              <button
                type="button"
                onClick={() => {
                  newDocument();
                  setScreen("model");
                }}
              >
                打开工作区
              </button>
            </div>
            <div className="lesson-art lesson-pen" />
          </article>
          <article className="lesson lesson-focus">
            <div className="lesson-copy lesson-blue">
              <h3>制作桌面收纳盒模型</h3>
              <p>用拉伸、抽壳、隔板和前开口生成一个桌面收纳盒，完成后可导出 STEP。</p>
              <button
                type="button"
                data-tutorial="organizer"
                disabled={!ready}
                onClick={() => {
                  loadDeskOrganizer();
                  setScreen("model");
                  setHistory(true);
                }}
              >
                {ready ? "生成样例" : "内核加载中"}
              </button>
            </div>
            <OrganizerArt />
          </article>
          <article className="lesson">
            <div className="lesson-copy lesson-blue">
              <h3>建模一个托架</h3>
              <p>先画封闭截面，再用拉伸和圆角完成一个简单托架。</p>
              <button
                type="button"
                onClick={() => {
                  newDocument();
                  setScreen("model");
                }}
              >
                开始练习
              </button>
            </div>
            <div className="lesson-art lesson-bracket" />
          </article>
        </div>
      </section>
      <section>
        <h2>初级课程</h2>
        <p className="learn-note">工作区左侧是绘制草图、插入、构造、变换、工具和可视化。按下滚轮拖动，右键绕坐标系原点旋转，滚轮缩放。</p>
      </section>
    </main>
  );
}

function OrganizerArt() {
  return (
    <svg className="lesson-svg" viewBox="0 0 220 150" aria-hidden="true">
      <polygon points="28,48 150,28 196,58 74,82" fill="#d5dee6" stroke="#8ea0ae" strokeWidth="1.4" />
      <polygon points="28,48 74,82 74,124 28,92" fill="#b7c6d0" stroke="#8ea0ae" strokeWidth="1.4" />
      <polygon points="74,82 196,58 196,100 74,124" fill="#c5d2db" stroke="#8ea0ae" strokeWidth="1.4" />
      <polygon points="40,58 138,42 176,64 78,82" fill="#e7eef2" stroke="#9aadb8" strokeWidth="1" />
      <polygon points="86,52 92,50 96,78 88,80" fill="#c3d0d8" />
      <polygon points="118,46 124,44 132,74 124,76" fill="#c3d0d8" />
      <polygon points="70,70 150,54 154,62 74,78" fill="#d7e1e7" />
      <polygon points="48,86 118,112 118,100 48,76" fill="#aebdc7" />
    </svg>
  );
}
