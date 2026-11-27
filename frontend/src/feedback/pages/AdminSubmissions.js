import { useCallback, useEffect, useState } from "react";
import api, { errorMessage, padId } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import Pagination, { pageCount, pageSlice } from "../components/Pagination";
import { orderedAnswers, questionLabel, ratingScale } from "../config/feedbackQuestions";
import { useToast } from "../context/ToastContext";
import { useEventTime } from "../utils/eventTime";

const MIN_SPIN_SECONDS = 1;
const MAX_SPIN_SECONDS = 60;

function formatAnswer(val) {
  if (typeof val === "number") {
    const r = ratingScale.find((s) => s.value === val);
    return r ? `${val}, ${r.label}` : String(val);
  }
  if (Array.isArray(val)) return val.join(", ");
  return typeof val === "object" ? JSON.stringify(val) : String(val);
}

/** The speaker session reviews of one submission, one line per reviewed session. */
function SpeakerReviewList({ reviews }) {
  return (
    <ul className="dlgfb-review-list">
      {reviews.map((r) => (
        <li key={r.session_id}>
          <strong>{r.title}</strong>
          {r.speakers && <span className="dlgfb-text-muted"> ({r.speakers})</span>}
          <div>
            {[r.rating ? `${r.rating} of 5, ${r.rating_label}` : "", r.comment ? `"${r.comment}"` : ""].filter(Boolean).join(" · ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Whether the feedback form opens by itself when the event starts, or is open with no condition. */
function FormOpeningPanel({ cfg, onSaved }) {
  const notify = useToast();
  const eventTime = useEventTime();
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const save = async (body, title, message) => {
    setSaving(true);
    try {
      const { data } = await api.patch("/admin/settings/", body);
      onSaved(data);
      notify(message, "success", { title });
      return true;
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Setting not saved" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleAuto = () => {
    const auto = !cfg.form_open_auto;
    save(
      { form_open_auto: auto },
      auto ? "Automatic opening on" : "Automatic opening off",
      auto ? "The form opens by itself when the event starts." : "The form no longer waits for the event to start."
    );
  };

  // The open switch turned on: undoes a close, or, before the event starts, turns the automatic opening off so it opens now.
  const openForm = () =>
    save(cfg.form_closed ? { form_closed: false } : { form_open_auto: false }, "Form opened", "Attendees can submit feedback now.");

  const closeForm = async () => {
    if (await save({ form_closed: true }, "Form closed", "Attendees see that the form is closed until you open it again.")) {
      setConfirmClose(false);
    }
  };

  let state;
  let status;
  if (cfg.form_closed) {
    state = "closed";
    status = "Closed by an admin. No feedback is taken until you open it again.";
  } else if (cfg.feedback_open) {
    state = "open";
    // Open with the automatic opening off needs no explanation, so no line is shown.
    if (!cfg.form_open_auto) status = "";
    else if (cfg.feedback_opens_at) status = `Open since ${eventTime(cfg.feedback_opens_at)}.`;
    else status = "Open now. The event's first day could not be read, so the form opened by default.";
  } else {
    state = "waiting";
    status = `Opens ${eventTime(cfg.feedback_opens_at)}.`;
  }
  const label = { open: "Open", closed: "Closed", waiting: "Not open yet" }[state];

  return (
    <div className="dlgfb-panel dlgfb-form-opening">
      <span className="dlgfb-panel-label">Feedback form</span>
      <p className={`dlgfb-form-opening-status is-${state}`}>
        <span className="dlgfb-form-opening-dot" aria-hidden="true" />
        {label}
      </p>
      {status && <p className="dlgfb-text-muted dlgfb-form-opening-note">{status}</p>}
      {/* On: attendees can submit feedback. Off: closed, after a confirm. */}
      <label className="dlgfb-switch">
        <input
          type="checkbox"
          role="switch"
          checked={state === "open"}
          disabled={saving}
          onChange={(e) => (e.target.checked ? openForm() : setConfirmClose(true))}
        />
        <span className="dlgfb-switch-track" aria-hidden="true" />
        <span className="dlgfb-switch-label">Feedback form open</span>
      </label>
      <label className="dlgfb-switch">
        <input type="checkbox" role="switch" checked={cfg.form_open_auto} disabled={saving || cfg.form_closed} onChange={toggleAuto} />
        <span className="dlgfb-switch-track" aria-hidden="true" />
        <span className="dlgfb-switch-label">Open automatically when the event starts</span>
      </label>
      <small className="dlgfb-form-text dlgfb-text-muted">
        {cfg.form_closed
          ? "The form stays closed while you have it closed, whatever the date."
          : "Turn off to open the form right away, for example if the automatic opening fails."}
      </small>
      {confirmClose && (
        <ConfirmDialog
          title="Close the feedback form?"
          confirmLabel="Close form"
          busy={saving}
          onConfirm={closeForm}
          onCancel={() => setConfirmClose(false)}
        >
          Attendees will not be able to submit feedback until you open it again. Feedback already sent is kept.
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * The feedback submissions PDF, emailed by the server the day after the event ends. Download it to check it, or
 * send it now when the automatic email did not go out.
 */
function ReportPanel() {
  const notify = useToast();
  const eventTime = useEventTime();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(""); // "", "download" or "send"

  useEffect(() => {
    api.get("/admin/feedback-report/").then(({ data }) => setStatus(data)).catch(() => {});
  }, []);

  const download = async () => {
    setBusy("download");
    try {
      const res = await api.get("/admin/feedback-report/pdf/", { responseType: "blob" });
      const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || "feedback-submissions.pdf";
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "PDF not downloaded" });
    } finally {
      setBusy("");
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      const { data } = await api.post("/admin/feedback-report/send/");
      setStatus(data);
      notify(`${data.sent} submission${data.sent === 1 ? "" : "s"} sent to ${data.recipients.join(", ")}.`, "success", { title: "Report emailed" });
    } catch (err) {
      if (err?.response?.data?.recipients) setStatus(err.response.data);
      notify(errorMessage(err), "danger", { title: "Report not sent" });
    } finally {
      setBusy("");
    }
  };

  if (!status) return null;
  const when = (iso) => eventTime(iso);
  let text;
  if (status.sent_at) text = `Sent ${when(status.sent_at)}, with ${status.sent_count ?? 0} submission${status.sent_count === 1 ? "" : "s"}.`;
  else if (!status.sends_at) text = "The event's last day could not be read, so it will not be sent by itself. Use Send now.";
  else if (new Date(status.sends_at) > new Date()) text = `Sends by itself on ${when(status.sends_at)}, the day after the event ends.`;
  else if (status.auto) text = "Due now, it goes out within the hour.";
  else text = "Not sent, the event ended more than a week ago. Use Send now.";

  return (
    <div className="dlgfb-panel dlgfb-report-panel">
      <div>
        <span className="dlgfb-panel-label">Submissions report (PDF)</span>
        <p className="dlgfb-mb-0">
          Every submission with the attendee's details and answers, emailed to <strong>{status.recipients.join(", ")}</strong>.
        </p>
        <p className="dlgfb-text-muted dlgfb-mb-0 dlgfb-report-status">{text}</p>
        {!status.mail_ready && (
          <p className="dlgfb-report-warn dlgfb-mb-0">Email is not set up on the server (SMTP_HOST), so it can only be downloaded.</p>
        )}
        {status.last_error && !status.sent_at && (
          <p className="dlgfb-report-warn dlgfb-mb-0">Last try failed: {status.last_error.message}</p>
        )}
      </div>
      <div className="dlgfb-report-actions">
        <button className="dlgfb-btn dlgfb-btn-outline-primary dlgfb-btn-sm" onClick={download} disabled={!!busy}>
          {busy === "download" ? "Preparing" : "Download PDF"}
        </button>
        <button className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" onClick={send} disabled={!!busy || !status.mail_ready}>
          {busy === "send" ? "Sending" : status.sent_at ? "Send again" : "Send now"}
        </button>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const notify = useToast();
  const [cfg, setCfg] = useState(null);
  const [spins, setSpins] = useState("0");
  const [seconds, setSeconds] = useState("5");
  const [savingDraw, setSavingDraw] = useState(false);

  const apply = (data) => {
    setCfg(data);
    setSpins(String(data.max_spin_attempts));
    setSeconds(String(data.spin_duration_seconds));
  };

  useEffect(() => {
    api.get("/admin/settings/").then(({ data }) => apply(data)).catch((err) => notify(errorMessage(err), "danger"));
  }, [notify]);

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
      <div className="dlgfb-settings-grid">
        <div className="dlgfb-panel dlgfb-skeleton-panel"><div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-75" /><div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-50" /></div>
        <div className="dlgfb-panel dlgfb-skeleton-panel"><div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-75" /><div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-50" /></div>
      </div>
    );
  }

  const dirty = spins !== String(cfg.max_spin_attempts) || seconds !== String(cfg.spin_duration_seconds);

  return (
    <div className="dlgfb-settings-grid">
      <FormOpeningPanel cfg={cfg} onSaved={setCfg} />
      <form className="dlgfb-panel dlgfb-draw-settings" onSubmit={saveDraw}>
        <span className="dlgfb-panel-label">Raffle draw</span>
        <div className="dlgfb-draw-settings-fields">
          <div className="dlgfb-form-group dlgfb-mb-0">
            <label htmlFor="max-spins">Spins allowed per draw</label>
            <input id="max-spins" type="number" min="0" inputMode="numeric" className="dlgfb-form-control"
              value={spins} onChange={(e) => setSpins(e.target.value)} />
            <small className="dlgfb-form-text dlgfb-text-muted">0 means no limit</small>
          </div>
          <div className="dlgfb-form-group dlgfb-mb-0">
            <label htmlFor="spin-seconds">Spin duration</label>
            <div className="dlgfb-input-group">
              <input id="spin-seconds" type="number" min={MIN_SPIN_SECONDS} max={MAX_SPIN_SECONDS} inputMode="numeric"
                className="dlgfb-form-control" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
              <div className="dlgfb-input-group-append"><span className="dlgfb-input-group-text">seconds</span></div>
            </div>
            <small className="dlgfb-form-text dlgfb-text-muted">Reels stop on their own, 1 to 60</small>
          </div>
        </div>
        <button className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" disabled={savingDraw || !dirty}>
          {savingDraw ? "Saving" : dirty ? "Save draw settings" : "Saved"}
        </button>
      </form>
    </div>
  );
}

export default function AdminSubmissions() {
  const notify = useToast();
  const eventTime = useEventTime();
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
      if (sub.is_suspended) notify(`${sub.attendee_name} is back in the raffle draw.`, "success", { title: `Entry ${entry} restored` });
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
      <div className="dlgfb-page-head">
        <div>
          <h1>Feedback submissions</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">Choose when the form opens, set up the draw and manage entries.</p>
        </div>
      </div>

      <div className="dlgfb-stat-grid">
        <div className="dlgfb-stat-card"><span className="dlgfb-stat-value">{stats.total}</span><span className="dlgfb-stat-label">Received</span></div>
        <div className="dlgfb-stat-card dlgfb-stat-good"><span className="dlgfb-stat-value">{stats.active}</span><span className="dlgfb-stat-label">In the draw</span></div>
        <div className="dlgfb-stat-card dlgfb-stat-bad"><span className="dlgfb-stat-value">{stats.suspended}</span><span className="dlgfb-stat-label">Suspended</span></div>
      </div>

      <SettingsPanel />
      <ReportPanel />

      <div className="dlgfb-filter-row">
        <input type="search" className="dlgfb-form-control" placeholder="Search by ID, name, display name, email or company"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search submissions" />
        <select className="dlgfb-custom-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className={`dlgfb-table-card${loading ? " dlgfb-is-loading" : ""}`}>
        <table className="dlgfb-table dlgfb-table-hover dlgfb-table-stack dlgfb-mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Attendee name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Display name</th>
              <th>Display company</th>
              <th>Submitted at</th>
              <th>Status</th>
              <th className="dlgfb-text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.results.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={9} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">Loading submissions</td></tr>
            )}
            {!loading && data.results.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={9} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">
                {q || statusFilter ? "No submissions match these filters." : "No feedback has been submitted yet. Share the form link with attendees."}
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className={s.is_suspended ? "dlgfb-row-suspended" : ""}>
                <td data-label="ID" className="dlgfb-id-cell">{padId(s.id, data.pad_length)}</td>
                <td data-label="Attendee" className="dlgfb-font-weight-bold">{s.attendee_name}</td>
                <td data-label="Email" className="dlgfb-text-break">{s.email || "---"}</td>
                <td data-label="Company">{s.company_name || "Not listed"}</td>
                {/* The name and company confirmed on the form, used for the lucky draw. */}
                <td data-label="Display name" className="dlgfb-font-weight-bold">{s.alias_name}</td>
                <td data-label="Display company">{s.company_alias_name || "Not listed"}</td>
                <td data-label="Submitted" className="dlgfb-text-nowrap">{eventTime(s.created_at)}</td>
                <td data-label="Status">
                  <span className={`dlgfb-badge ${s.is_suspended ? "dlgfb-badge-suspended" : "dlgfb-badge-active"}`}>
                    {s.is_suspended ? "Suspended" : "Active"}
                  </span>
                </td>
                <td className="dlgfb-text-right dlgfb-text-nowrap dlgfb-actions-cell">
                  <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-light dlgfb-mr-2" onClick={() => setViewing(s)}>View</button>
                  <button
                    className={`dlgfb-btn dlgfb-btn-sm ${s.is_suspended ? "dlgfb-btn-outline-success" : "dlgfb-btn-outline-danger"}`}
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
        <Modal title={`Entry ${padId(viewing.id, data.pad_length)}, ${viewing.attendee_name}`} onClose={() => setViewing(null)} size="dlgfb-modal-lg">
          <dl className="dlgfb-answer-list">
            {orderedAnswers(viewing.feedback_data).map(([key, val]) => (
              <div key={key} className="dlgfb-answer-row">
                <dt>{questionLabel(key)}</dt>
                <dd>{key === "speaker_reviews" && Array.isArray(val) ? <SpeakerReviewList reviews={val} /> : formatAnswer(val)}</dd>
              </div>
            ))}
          </dl>
          <p className="dlgfb-small dlgfb-text-muted dlgfb-mb-0">
            Display name {viewing.alias_name}, {viewing.company_alias_name || "no company"}. Submitted {eventTime(viewing.created_at)}
          </p>
        </Modal>
      )}
    </>
  );
}
