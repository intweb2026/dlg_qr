import Modal from "./Modal";

// In-app replacement for window.confirm, styled like the rest of the admin.
export default function ConfirmDialog({ title, children, confirmLabel = "Confirm", tone = "danger", busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={() => !busy && onCancel()}
      footer={
        <>
          <button type="button" className="dlgfb-btn dlgfb-btn-light" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`dlgfb-btn dlgfb-btn-${tone}`} disabled={busy} onClick={onConfirm} autoFocus>
            {busy && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dlgfb-mb-0">{children}</p>
    </Modal>
  );
}
