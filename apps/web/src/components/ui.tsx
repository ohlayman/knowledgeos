import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { statusLabel, statusTone } from '../lib/format.js';

export function Badge({
  children,
  tone = '',
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'bad' | 'accent' | '';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {description ? <p className="tiny">{description}</p> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <h3>加载失败</h3>
      <p className="tiny">{message}</p>
      {onRetry ? (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn sm" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 48 }} />
      ))}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="tiny muted">{hint}</span> : null}
    </div>
  );
}

interface ToastItem {
  id: string;
  message: string;
  tone: 'default' | 'error';
}

const ToastContext = createContext<(message: string, tone?: 'default' | 'error') => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: 'default' | 'error' = 'default') => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now() + Math.random());
    setItems((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="toast" role={item.tone === 'error' ? 'alert' : 'status'}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useMemo(() => `drawer-${Math.random().toString(36).slice(2)}`, []);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') {
            return;
          }
          const items = Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
          );
          if (items.length === 0) {
            return;
          }
          const first = items[0]!;
          const last = items.at(-1)!;
          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === panelRef.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="drawer-head">
          <h2 id={titleId} style={{ fontSize: 16 }}>
            {title}
          </h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
