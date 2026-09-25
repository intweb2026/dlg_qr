import { useCallback, useEffect, useState } from "react";
import api, { errorMessage, padId } from "../api";
import Modal from "../components/Modal";
import Pagination, { pageCount, pageSlice } from "../components/Pagination";
import { questionLabel, ratingScale } from "../config/feedbackQuestions";
import { useToast } from "../context/ToastContext";

const MIN_SPIN_SECONDS = 1;
const MAX_SPIN_SECONDS = 60;

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatAnswer(val) {
  if (typeof val === "number") {
    const r = ratingScale.find((s) => s.value === val);
    return r ? `${val}, ${r.label}` : String(val);
  }
  if (Array.isArray(val)) return val.join(", ");
  return typeof val === "object" ? JSON.stringify(val) : String(val);
}

function SettingsPanel() {
  const notify = useToast();
  const [cfg, setCfg] = useState(null);
  const [spins, setSpins] = useState("0");
  const [seconds, setSeconds] = useState("5");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingDraw, setSavingDraw] = useState(false);

  const apply = (data) => {
    setCfg(data);
    setSpins(String(data.max_spin_attempts));
    setSeconds(String(data.spin_duration_seconds));
  };

  useEffect(() => {
    api.get("/admin/settings/").then(({ data }) => apply(data)).catch((err) => notify(errorMessage(err), "danger"));
  }, [notify]);

  const toggleForm = async () => {
    const opening = cfg.form_status !== "active";
    setSavingStatus(true);
    try {
      const { data } = await api.patch("/admin/settings/", { form_status: opening ? "active" : "inactive" });
      setCfg((c) => ({ ...c, ...data }));
      if (opening) {
        notify("Attendees can submit their feedback now.", "success", { title: "Feedback form is open" });
      } else {
        notify("New responses are paused until you open the form again.", "warning", { title: "Feedback form is closed" });
      }
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Status not changed" });
    } finally {
      setSavingStatus(false);
    }
  };

  const saveDraw = async (e) => {
    e.preventDefault();
    const n = parseInt(spins, 10);
    const s = parseInt(seconds, 10);
    if (Number.isNaN(n) || n < 0) return notify("Spins allowed must be 0 or more.", "warning", { title: "Check the spin limit" });
    if (Number.isNaN(s) || s < MIN_SPIN_SECONDS || s > MAX_SPIN_SECONDS) {
      return notify(`Spin duration must be between ${MIN_SPIN_SECONDS} and ${MAX_SPIN_SECONDS} seconds.`, "warning", {
        title: "Check the spin duration",
      });
    }
    setSavingDraw(true);
    try {
      const { data } = await api.patch("/admin/settings/", { max_spin_attempts: n, spin_duration_seconds: s });
      apply(data);
      notify(`${n === 0 ? "No spin limit" : `${n} spin${n > 1 ? "s" : ""} per draw`}, reels stop after ${s} second${s > 1 ? "s" : ""}.`, "success", {
        title: "Draw settings saved",
      });
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Settings not saved" });
    } finally {
      setSavingDraw(false);
    }
  };

  if (!cfg) {
    return (
      <div className="settings-grid">
        <div className="panel skeleton-panel"><div className="skeleton skeleton-line w-75" /><div className="skeleton skeleton-line w-50" /></div>
        <div className="panel skeleton-panel"><div className="skeleton skeleton-line w-75" /><div className="skeleton skeleton-line w-50" /></div>
      </div>
    );
  }

  const active = cfg.form_status === "active";
  const dirty = spins !== String(cfg.max_spin_attempts) || seconds !== String(cfg.spin_duration_seconds);

  return (
    <div className="settings-grid">
      <div className={`panel status-card${active ? " is-open" : " is-closed"}`}>
        <div className="status-card-text">
          <span className="panel-label">Feedback form</span>
          <span className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            {active ? "Open for responses" : "Closed"}
          </span>
          <p className="panel-help mb-0">
            {active ? "Attendees can find their name and submit." : "Attendees see a closed message."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="Feedback form open"
          className={`big-switch${active ? " on" : ""}`}
          disabled={savingStatus}
          onClick={toggleForm}
        >
          <span className="big-switch-knob">
            {savingStatus && <span className="spinner-border spinner-border-sm" aria-hidden="true" />}
          </span>
        </button>
      </div>

      <form className="panel draw-settings" onSubmit={saveDraw}>
        <span className="panel-label">Lucky draw</span>
        <div className="draw-settings-fields">
          <div className="form-group mb-0">
            <label htmlFor="max-spins">Spins allowed per draw</label>
            <input id="max-spins" type="number" min="0" inputMode="numeric" className="form-control"
              value={spins} onChange={(e) => setSpins(e.target.value)} />
            <small className="form-text text-muted">0 means no limit</small>
          </div>
          <div className="form-group mb-0">
            <label htmlFor="spin-seconds">Spin duration</label>
            <div className="input-group">
              <input id="spin-seconds" type="number" min={MIN_SPIN_SECONDS} max={MAX_SPIN_SECONDS} inputMode="numeric"
                className="form-control" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
              <div className="input-group-append"><span className="input-group-text">seconds</span></div>
            </div>
            <small className="form-text text-muted">Reels stop on their own, 1 to 60</small>
          </div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={savingDraw || !dirty}>
          {savingDraw ? "Saving" : dirty ? "Save draw settings" : "Saved"}
        </button>
      </form>
    </div>
  );
}

export default function AdminSubmissions() {
  const notify = useToast();
  const [data, setData] = useState({ results: [], stats: { total: 0, active: 0, suspended: 0 }, pad_length: 2 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/submissions/", { params: { q: q || undefined, status: statusFilter || undefined } });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, notify]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => setPage(1), [q, statusFilter]);
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount(data.results.length)));
  }, [data.results.length]);

  const toggleSuspend = async (sub) => {
    setBusyId(sub.id);
    const entry = padId(sub.id, data.pad_length);
    try {
      await api.patch(`/admin/submissions/${sub.id}/suspend/`, { is_suspended: !sub.is_suspended });
      if (sub.is_suspended) notify(`${sub.attendee_name} is back in the lucky draw.`, "success", { title: `Entry ${entry} restored` });
      else notify(`${sub.attendee_name} can no longer be drawn.`, "warning", { title: `Entry ${entry} suspended` });
      load();
    } catch (err) {
      notify(errorMessage(err), "danger");
    } finally {
      setBusyId(null);
    }
  };

  const { stats } = data;
  const rows = pageSlice(data.results, page);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Feedback submissions</h1>
          <p className="text-muted mb-0">Open or close the form, set up the draw and manage entries.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-value">{stats.total}</span><span className="stat-label">Received</span></div>
        <div className="stat-card stat-good"><span className="stat-value">{stats.active}</span><span className="stat-label">In the draw</span></div>
        <div className="stat-card stat-bad"><span className="stat-value">{stats.suspended}</span><span className="stat-label">Suspended</span></div>
      </div>

      <SettingsPanel />

      <div className="filter-row">
        <input type="search" className="form-control" placeholder="Search by ID, name, email or company"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search submissions" />
        <select className="custom-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className={`table-card${loading ? " is-loading" : ""}`}>
        <table className="table table-hover table-stack mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Attendee name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Submitted at</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.results.length === 0 && (
              <tr className="empty-row"><td colSpan={7} className="text-center text-muted py-4">Loading submissions</td></tr>
            )}
            {!loading && data.results.length === 0 && (
              <tr className="empty-row"><td colSpan={7} className="text-center text-muted py-4">
                {q || statusFilter ? "No submissions match these filters." : "No feedback has been submitted yet. Share the form link with attendees."}
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className={s.is_suspended ? "row-suspended" : ""}>
                <td data-label="ID" className="id-cell">{padId(s.id, data.pad_length)}</td>
                <td data-label="Attendee" className="font-weight-bold">{s.attendee_name}</td>
                <td data-label="Email" className="text-break">{s.email || "Not on file"}</td>
                <td data-label="Company">{s.company_name || "Not listed"}</td>
                <td data-label="Submitted" className="text-nowrap">{formatDate(s.created_at)}</td>
                <td data-label="Status">
                  <span className={`badge ${s.is_suspended ? "badge-suspended" : "badge-active"}`}>
                    {s.is_suspended ? "Suspended" : "Active"}
                  </span>
                </td>
                <td className="text-right text-nowrap actions-cell">
                  <button className="btn btn-sm btn-light mr-2" onClick={() => setViewing(s)}>View</button>
                  <button
                    className={`btn btn-sm ${s.is_suspended ? "btn-outline-success" : "btn-outline-danger"}`}
                    disabled={busyId === s.id}
                    onClick={() => toggleSuspend(s)}
                  >
                    {s.is_suspended ? "Restore" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={data.results.length} onChange={setPage} noun="submissions" />

      {viewing && (
        <Modal title={`Entry ${padId(viewing.id, data.pad_length)}, ${viewing.attendee_name}`} onClose={() => setViewing(null)} size="modal-lg">
          <dl className="answer-list">
            {Object.entries(viewing.feedback_data || {}).map(([key, val]) => (
              <div key={key} className="answer-row">
                <dt>{questionLabel(key)}</dt>
                <dd>{formatAnswer(val)}</dd>
              </div>
            ))}
          </dl>
          <p className="small text-muted mb-0">
            Submitted {formatDate(viewing.created_at)}. Device fingerprint {viewing.device_fingerprint.slice(0, 16)}
          </p>
        </Modal>
      )}
    </>
  );
}
