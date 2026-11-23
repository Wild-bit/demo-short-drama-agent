export function Brand() {
  return (
    <span className="brand">
      <img src="/static/images/logo.svg" alt="" />
      <span className="brand-text">短剧工坊</span>
      <span className="brand-badge" aria-hidden="true">
        STUDIO
      </span>
    </span>
  );
}

export function Slate() {
  return (
    <div className="art" aria-hidden="true">
      <div className="orb orb-amber" />
      <div className="orb orb-indigo" />
      <div className="beam" />
      <div className="clapper-shell">
        <div className="clapper">
          <i />
          <b />
          <span>
            <em className="rec-dot" />
            SCENE 01 · TAKE 1
            <strong>▶</strong>
          </span>
        </div>
      </div>
      <div className="filmline" />
    </div>
  );
}
