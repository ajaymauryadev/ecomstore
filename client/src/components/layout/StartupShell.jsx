export default function StartupShell({ children }) {
  return (
    <div className="startup-shell" aria-busy="true" aria-label="Opening Smart Kirana">
      <aside className="startup-sidebar" aria-hidden="true">
        <p className="startup-brand"><span className="startup-mark">S</span>Smart Kirana</p>
        {[0, 1, 2, 3, 4].map((index) => <div key={index} className="startup-line" />)}
      </aside>
      <div className="startup-body">
        <header className="startup-header"><p className="startup-brand">Smart Kirana</p></header>
        <main className="startup-content">
          {children && <div className="startup-message">{children}</div>}
          <div aria-hidden="true">
            <div className="startup-line startup-title" />
            <div className="startup-toolbar" />
            <div className="startup-card">{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="startup-line" />)}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
