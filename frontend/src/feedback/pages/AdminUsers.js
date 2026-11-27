import { useCallback, useEffect, useState } from "react";
import api, { errorMessage } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEventTime } from "../utils/eventTime";
import { ADMIN, ROLE_LABELS, SUPPORT } from "../utils/roles";

const ROLE_HELP = {
  [ADMIN]: "Opens every admin screen, including Users.",
  [SUPPORT]: "On the floor. Can only read and change the Wi-Fi network and password, nothing else.",
};
const EMPTY = { username: "", full_name: "", role: SUPPORT, password: "", is_active: true };

/** Field errors of a 400, { field: "message" }. A { detail } answer is not about one field. */
function fieldErrors(err) {
  const data = err?.response?.data;
  if (err?.response?.status !== 400 || !data || typeof data !== "object" || data.detail) return {};
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
}

function UserModal({ user, self, onClose, onSaved }) {
  const notify = useToast();
  const isNew = !user;
  const [form, setForm] = useState(user ? { ...EMPTY, ...user, password: "" } : EMPTY);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (isNew) {
        await api.post("/admin/users/", form);
        notify(`${form.username.trim()} can now sign in as ${ROLE_LABELS[form.role].toLowerCase()}.`, "success", { title: "User added" });
      } else {
        // Only what changed is sent. A blank password leaves the password as it is.
        const body = { full_name: form.full_name, role: form.role, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await api.patch(`/admin/users/${user.id}/`, body);
        notify(`${user.username} is updated.${form.password || form.role !== user.role || !form.is_active ? " They have to sign in again." : ""}`, "success", { title: "User saved" });
      }
      onSaved();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) notify(errorMessage(err), "danger", { title: "Not saved" });
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? "Add user" : `Edit ${user.username}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="dlgfb-btn dlgfb-btn-light" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" form="user-form" className="dlgfb-btn dlgfb-btn-primary" disabled={busy}>
            {busy && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            {isNew ? "Add user" : "Save user"}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate autoComplete="off">
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="user-username">Username</label>
          <input id="user-username" className={`dlgfb-form-control${errors.username ? " dlgfb-is-invalid" : ""}`} maxLength={150}
            value={form.username} onChange={(e) => set("username")(e.target.value)} disabled={!isNew} autoFocus={isNew}
            autoCapitalize="none" autoComplete="off" />
          {errors.username ? <div className="dlgfb-invalid-feedback">{errors.username}</div>
            : isNew && <small className="dlgfb-form-text dlgfb-text-muted">Used to sign in. Letters, digits, dots, dashes and underscores. It cannot be changed later.</small>}
        </div>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="user-name">Full name</label>
          <input id="user-name" className={`dlgfb-form-control${errors.full_name ? " dlgfb-is-invalid" : ""}`} maxLength={255}
            value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} autoComplete="off" />
          {errors.full_name && <div className="dlgfb-invalid-feedback">{errors.full_name}</div>}
        </div>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="user-role">Role</label>
          <select id="user-role" className={`dlgfb-custom-select${errors.role ? " dlgfb-is-invalid" : ""}`} value={form.role}
            onChange={(e) => set("role")(e.target.value)} disabled={self}>
            <option value={SUPPORT}>{ROLE_LABELS[SUPPORT]}</option>
            <option value={ADMIN}>{ROLE_LABELS[ADMIN]}</option>
          </select>
          {errors.role && <div className="dlgfb-invalid-feedback">{errors.role}</div>}
          <small className="dlgfb-form-text dlgfb-text-muted">{self ? "You cannot change your own role." : ROLE_HELP[form.role]}</small>
        </div>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="user-password">{isNew ? "Password" : "New password"}</label>
          <div className="dlgfb-input-group">
            <input id="user-password" type={show ? "text" : "password"} className={`dlgfb-form-control${errors.password ? " dlgfb-is-invalid" : ""}`}
              maxLength={128} value={form.password} onChange={(e) => set("password")(e.target.value)} autoComplete="new-password"
              placeholder={isNew ? "" : "Leave blank to keep the current one"} />
            <button type="button" className="dlgfb-btn dlgfb-btn-light" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
          </div>
          {errors.password ? <div className="dlgfb-invalid-feedback dlgfb-d-block">{errors.password}</div>
            : <small className="dlgfb-form-text dlgfb-text-muted">At least 8 characters. Share it with the user in person.</small>}
        </div>
        <label className="dlgfb-ed-check">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active")(e.target.checked)} disabled={self} />
          <span>Can sign in{self ? " (you cannot disable yourself)" : ""}</span>
        </label>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const notify = useToast();
  const eventTime = useEventTime();
  const { user: me } = useAuth();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // null closed, "new", or a user
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/users/");
      setList(data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    const u = deleting;
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/users/${u.id}/`);
      notify(`${u.username} was deleted and signed out.`, "success", { title: "User deleted" });
      setDeleting(null);
      load();
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Not deleted" });
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const users = list || [];
  const isMe = (u) => u.username.toLowerCase() === me?.username?.toLowerCase();

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Users</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">Who can sign in to this event's admin panel. An admin opens every screen. A support user can only change the Wi-Fi network and password.</p>
        </div>
        <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" onClick={() => setEditing("new")}>Add user</button>
      </div>

      <div className="dlgfb-table-card">
        <table className="dlgfb-table dlgfb-table-hover dlgfb-table-stack dlgfb-mb-0">
          <thead>
            <tr>
              <th>Username</th>
              <th>Full name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign in</th>
              <th className="dlgfb-text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list && users.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={6} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">No users yet.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="Username" className="dlgfb-font-weight-bold">
                  {u.username}
                  {isMe(u) && <span className="dlgfb-badge dlgfb-badge-pending dlgfb-ml-2">You</span>}
                </td>
                <td data-label="Full name">{u.full_name || "---"}</td>
                <td data-label="Role"><span className={`dlgfb-badge ${u.role === ADMIN ? "dlgfb-badge-active" : "dlgfb-badge-self-registered"}`}>{ROLE_LABELS[u.role] || u.role}</span></td>
                <td data-label="Status">{u.is_active ? <span className="dlgfb-badge dlgfb-badge-active">Active</span> : <span className="dlgfb-badge dlgfb-badge-suspended">Disabled</span>}</td>
                <td data-label="Last sign in">{u.last_login ? eventTime(u.last_login) : "Never"}</td>
                <td className="dlgfb-text-right dlgfb-actions-cell">
                  <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-light dlgfb-mr-2" onClick={() => setEditing(u)}>Edit</button>
                  <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-danger" disabled={isMe(u)} title={isMe(u) ? "You cannot delete your own account" : undefined}
                    onClick={() => setDeleting(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          self={editing !== "new" && isMe(editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog title="Delete user" confirmLabel="Delete" busy={deleteBusy} onConfirm={remove} onCancel={() => setDeleting(null)}>
          Delete <strong>{deleting.username}</strong>{deleting.full_name && deleting.full_name !== deleting.username ? ` (${deleting.full_name})` : ""}. They are signed out at once and cannot sign in again. To keep the account, disable it instead.
        </ConfirmDialog>
      )}
    </>
  );
}
