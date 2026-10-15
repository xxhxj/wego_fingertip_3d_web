import { useState } from "react";
import { buyMembership, useSession } from "../session";
import { setMemberOpen, useShell } from "../state/shell";

export function MemberBanner() {
  const session = useSession();
  if (!session.user || session.user.member) return null;
  return (
    <div className="access-banner">
      <span>受限访问版本</span>
      <button type="button" className="primary pill" onClick={() => setMemberOpen(true)}>获取完全访问权限</button>
    </div>
  );
}

export function MemberDialog() {
  const shell = useShell();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"month" | "year" | null>(null);
  if (!shell.memberOpen) return null;

  async function buy(plan: "month" | "year") {
    setPending(plan);
    setMessage("");
    try {
      setMessage(await buyMembership(plan));
      setMemberOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开通失败");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="modal-back" onClick={() => setMemberOpen(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="member-title">
        <h2 id="member-title">获取完全访问权限</h2>
        <p className="hint-copy">开通后去掉受限提示。订单记在单点系统里，和包装样机会员是同一套。</p>
        <div className="button-row">
          <button type="button" className="primary" disabled={pending !== null} onClick={() => void buy("month")}>
            {pending === "month" ? "开通中" : "月会员 29"}
          </button>
          <button type="button" className="primary" disabled={pending !== null} onClick={() => void buy("year")}>
            {pending === "year" ? "开通中" : "年会员 199"}
          </button>
          <button type="button" onClick={() => setMemberOpen(false)}>关闭</button>
        </div>
        {message && <p className="hint-copy">{message}</p>}
      </div>
    </div>
  );
}
