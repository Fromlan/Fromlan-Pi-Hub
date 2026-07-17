import { ThemeToggle } from "./ThemeToggle";

export function SettingsPanel() {
  return (
    <div className="settings-panel">
      <header className="settings-header">
        <h2>设置</h2>
        <p className="settings-subtitle">Fromlan Pi Hub 的偏好配置</p>
      </header>

      <section className="settings-section">
        <h3>外观</h3>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-title">主题</span>
            <span className="settings-row-hint">切换深色 / 浅色界面</span>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section className="settings-section">
        <h3>关于</h3>
        <p className="settings-about">
          Fromlan Pi Hub 是一个 Electron 桌面客户端，启动多个独立的 <code>pi --mode rpc</code> 子进程，通过 JSONL 协议通信。<br />
          本设置面板为占位，后续可扩展：默认 provider、字体大小、会话持久化策略等。
        </p>
      </section>
    </div>
  );
}