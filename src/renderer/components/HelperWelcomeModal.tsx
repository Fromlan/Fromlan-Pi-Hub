import { useState } from "react";
import { useStore } from "../store";
import {
  HELPER_NAME,
  HELPER_STARTER_PROMPTS,
  STARTER_CARD_IDS,
  type StarterCardId,
} from "../../shared/default-agents/pi-hub-helper";

/**
 * 首次进入欢迎弹窗（对齐 Multica OnboardingHelperModal）。
 * 门控：settings.onboardedAt 为空。选卡 → 建 Issue 派给 pi-hub-helper；跳过只记 onboardedAt。
 */
export function HelperWelcomeModal() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markOnboarded(): Promise<void> {
    const r = await window.appAPI.updateSettings({ onboardedAt: Date.now() });
    if (!r.ok) throw new Error(r.error);
    useStore.getState().setAppSettings(r.settings);
  }

  async function onSkip(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await markOnboarded();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function onPick(id: StarterCardId): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    const card = HELPER_STARTER_PROMPTS[id];
    try {
      const created = await window.issueAPI.create({
        title: card.title,
        description: card.prompt,
        status: "todo",
        priority: "medium",
        assignee: { kind: "agent", id: HELPER_NAME },
      });
      if (!created.ok) {
        setError(created.error);
        setBusy(false);
        return;
      }
      useStore.getState().upsertIssue(created.issue);
      await markOnboarded();
      useStore.getState().setPanel("chat");
      useStore.getState().setActiveIssue(created.issue.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay helper-welcome-overlay" role="dialog" aria-modal="true">
      <div className="modal helper-welcome-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p className="helper-welcome-eyebrow">第一个队友</p>
            <h2>认识 Pi Hub Helper</h2>
          </div>
        </header>
        <div className="modal-body">
          <p className="helper-welcome-lede">
            Pi Hub Helper 是内置引导助手。选一个起步任务，它会出现在看板上并开始执行；也可以稍后在
            Agents 面板找到它。
          </p>
          <div className="helper-welcome-cards">
            {STARTER_CARD_IDS.map((id) => {
              const card = HELPER_STARTER_PROMPTS[id];
              return (
                <button
                  key={id}
                  type="button"
                  className="helper-welcome-card"
                  disabled={busy}
                  onClick={() => void onPick(id)}
                >
                  <span className="helper-welcome-card-title">{card.title}</span>
                  <span className="helper-welcome-card-sub">{card.subtitle}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <footer className="modal-foot helper-welcome-foot">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void onSkip()}
          >
            跳过，稍后再说
          </button>
        </footer>
      </div>
    </div>
  );
}
