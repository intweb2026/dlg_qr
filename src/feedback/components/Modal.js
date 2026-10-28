import { useEffect } from "react";

// Modal markup styled by base.css, controlled by React.
export default function Modal({ title, onClose, children, footer, size = "", className = "" }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("dlgfb-modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("dlgfb-modal-open");
    };
  }, [onClose]);

  return (
    <>
      <div className={`dlgfb-modal dlgfb-fade dlgfb-show dlgfb-d-block dlgfb-app-modal${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
        <div className={`dlgfb-modal-dialog dlgfb-modal-dialog-centered ${size}`} role="document" onClick={(e) => e.stopPropagation()}>
          <div className="dlgfb-modal-content">
            <div className="dlgfb-modal-header">
              <h5 className="dlgfb-modal-title">{title}</h5>
              <button type="button" className="dlgfb-close" aria-label="Close" onClick={onClose}>
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="dlgfb-modal-body">{children}</div>
            {footer && <div className="dlgfb-modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="dlgfb-modal-backdrop dlgfb-fade dlgfb-show dlgfb-app-modal-backdrop" />
    </>
  );
}
