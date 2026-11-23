import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Dialog({
  title,
  subtitle,
  wide,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog-wide' : undefined}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="dialog-inner">
        <header className="panel-head dialog-head">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p className="muted dialog-sub">{subtitle}</p>}
          </div>
          <button type="button" className="icon" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}
