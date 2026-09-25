import Modal from "./Modal";

// In-app replacement for window.confirm, styled like the rest of the admin.
export default function ConfirmDialog({ title, children, confirmLabel = "Confirm", tone = "danger", busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={() => !busy && onCancel()}
      footer={
        <>
          <button type="button" className="btn btn-light" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn btn-${tone}`} disabled={busy} onClick={onConfirm} autoFocus>
            {busy && <span className="spinner-border spinner-border-sm mr-2" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="mb-0">{children}</p>
    </Modal>
  );
}
