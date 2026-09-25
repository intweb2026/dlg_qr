import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(() => {});

const MAX_TOASTS = 4;
const EXIT_MS = 220;

const ICONS = {
  success: <path d="M5 12.5l4.2 4.2L19 7" />,
  danger: (
    <>
      <path d="M12 7.5v6" />
      <path d="M12 16.8v.2" />
    </>
  ),
  warning: (
    <>
      <path d="M12 8v5" />
      <path d="M12 16.3v.2" />
    </>
  ),
  info: (
    <>
      <path d="M12 11v6" />
      <path d="M12 7.3v.2" />
    </>
  ),
};

function ToastItem({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.timeout);
  const startedAt = useRef(Date.now());

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), EXIT_MS);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (paused || leaving) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, leaving, close]);

  const urgent = toast.variant === "danger" || toast.variant === "warning";

  return (
    <div
      className={`app-toast app-toast-${toast.variant}${leaving ? " is-leaving" : ""}`}
      role={urgent ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="app-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[toast.variant] || ICONS.info}
        </svg>
      </span>
      <div className="app-toast-text">
        {toast.title && <p className="app-toast-title">{toast.title}</p>}
        <p className="app-toast-message">{toast.message}</p>
      </div>
      <button type="button" className="app-toast-close" aria-label="Dismiss notification" onClick={close}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <span
        className="app-toast-timer"
        aria-hidden="true"
        style={{ animationDuration: `${toast.timeout}ms`, animationPlayState: paused ? "paused" : "running" }}
      />
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  /**
   * notify(message, variant, options)
   * variant is success, danger, warning or info.
   * options is a timeout in ms, or { title, timeout }.
   */
  const notify = useCallback((message, variant = "success", options = {}) => {
    const opts = typeof options === "number" ? { timeout: options } : options || {};
    const id = Date.now() + Math.random();
    const timeout = opts.timeout || (variant === "danger" ? 6500 : 4500);
    setToasts((list) => [...list, { id, message, variant, title: opts.title, timeout }].slice(-MAX_TOASTS));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
