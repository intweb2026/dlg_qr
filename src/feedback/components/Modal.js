import { useEffect } from "react";

// Bootstrap 4 modal markup, controlled by React (no jQuery needed).
export default function Modal({ title, onClose, children, footer, size = "", className = "" }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  return (
    <>
      <div className={`modal fade show d-block app-modal${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
        <div className={`modal-dialog modal-dialog-centered ${size}`} role="document" onClick={(e) => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="close" aria-label="Close" onClick={onClose}>
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show app-modal-backdrop" />
    </>
  );
}
