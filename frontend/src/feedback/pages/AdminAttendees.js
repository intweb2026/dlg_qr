import { useCallback, useEffect, useState } from "react";
import api, { errorMessage, padId } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination, { pageCount, pageSlice } from "../components/Pagination";
import { useToast } from "../context/ToastContext";
import { useEventTime } from "../utils/eventTime";

const EMPTY = { full_name: "", company_name: "", email: "" };

export default function AdminAttendees() {
  const notify = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [walkIn, setWalkIn] = useState("");
  const [form, setForm] = useState(EMPTY);
  // eslint-disable-next-line no-unused-vars -- used by the Add an attendee panel, commented out in the JSX below
  const [saving, setSaving] = useState(false);
  const eventTime = useEventTime();
  const [sync, setSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/attendees/", { params: { q: q || undefined, walk_in: walkIn || undefined } });
      setList(data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    }
  }, [q, walkIn, notify]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const loadSync = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/attendees/sync/");
      setSync(data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    }
  }, [notify]);

  useEffect(() => {
    loadSync();
  }, [loadSync]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post("/admin/attendees/sync/");
      setSync(data);
      const r = data.result;
      notify(`${r.fetched} delegates in the CRM. ${r.created} added, ${r.updated} updated, ${r.removed} removed.`, "success", {
        title: "Attendees synced",
      });
      load();
    } catch (err) {
      if (err.response?.data?.last_sync_at !== undefined) setSync(err.response.data);
      notify(errorMessage(err), "danger", { title: "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => setPage(1), [q, walkIn]);
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount(list.length)));
  }, [list.length]);

  // eslint-disable-next-line no-unused-vars -- used by the Add an attendee panel, commented out in the JSX below
  const add = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return notify("Enter the attendee's name to add them.", "warning", { title: "Name is required" });
    setSaving(true);
    try {
      await api.post("/admin/attendees/", { ...form, email: form.email.trim() || null });
      notify(`${form.full_name.trim()} can now find their name on the feedback form.`, "success", { title: "Attendee added" });
      setForm(EMPTY);
      load();
    } catch (err) {
      notify(errorMessage(err), "danger");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const a = deleting;
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/attendees/${a.attendee_id}/`);
      notify(`${a.full_name} was removed from the attendee list.`, "success", { title: "Attendee deleted" });
      setDeleting(null);
      load();
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Not deleted" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitted = list.filter((a) => a.has_submitted).length;

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Attendees</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">The registered delegates from the CRM and the self-registered walk-ins. Everyone listed here can find their name on the feedback form.</p>
        </div>
      </div>

      <div className="dlgfb-stat-grid">
        <div className="dlgfb-stat-card"><span className="dlgfb-stat-value">{list.length}</span><span className="dlgfb-stat-label">{q || walkIn ? "Matching" : "Attendees"}</span></div>
        <div className="dlgfb-stat-card dlgfb-stat-good"><span className="dlgfb-stat-value">{submitted}</span><span className="dlgfb-stat-label">Submitted</span></div>
        <div className="dlgfb-stat-card"><span className="dlgfb-stat-value">{list.length - submitted}</span><span className="dlgfb-stat-label">Pending</span></div>
      </div>

      <div className="dlgfb-panel dlgfb-mb-3">
        <div className="dlgfb-crm-sync">
          <div>
            <h2 className="dlgfb-h6 dlgfb-mb-1">Registered delegates from the CRM</h2>
            <p className="dlgfb-small dlgfb-text-muted dlgfb-mb-0">
              {!sync
                ? "Checking the CRM sync."
                : !sync.enabled
                  ? sync.reason
                  : <>
                      CRM event code <strong>{sync.event_code}</strong>.{" "}
                      {sync.synced_at
                        ? `${sync.synced_count} delegates copied on ${eventTime(sync.synced_at)}. Press Sync now to fetch the list again.`
                        : "Not copied yet. The first visitor to the site fetches the list, or press Sync now."}{" "}
                      {/* The daily sync, from the second day on, until the event's last day is over. */}
                      {sync.refresh_active
                        ? `The list is fetched again every 24 hours until ${eventTime(sync.refresh_until)}, 11:59 PM of the last day${sync.location ? ` in ${sync.location}` : ""}.`
                        : sync.refresh_until
                          ? "The event is over, the daily sync has stopped."
                          : "The event's last day could not be read from the agenda, so there is no daily sync."}
                    </>}
            </p>
            {sync?.error && <p className="dlgfb-small dlgfb-text-danger dlgfb-mb-0 dlgfb-mt-2">Last try failed, {sync.error}</p>}
            {sync?.ok && !sync.synced_at && sync.result?.fetched === 0 && (
              <p className="dlgfb-small dlgfb-text-danger dlgfb-mb-0 dlgfb-mt-2">The CRM has no delegates for this event code yet.</p>
            )}
          </div>
          <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" onClick={syncNow} disabled={syncing || !sync?.enabled}>
            {syncing ? "Syncing" : "Sync now"}
          </button>
        </div>
      </div>

      {/* <div className="dlgfb-row">
        <div className="dlgfb-col-lg-8 dlgfb-mb-3">
          <form className="dlgfb-panel" onSubmit={add}>
            <h2 className="dlgfb-h6 dlgfb-mb-3">Add an attendee</h2>
            <div className="dlgfb-form-row">
              <div className="dlgfb-col-md-4 dlgfb-mb-2">
                <input className="dlgfb-form-control" placeholder="Attendee name" aria-label="Attendee name"
                  value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="dlgfb-col-md-4 dlgfb-mb-2">
                <input className="dlgfb-form-control" placeholder="Company name" aria-label="Company name"
                  value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
              <div className="dlgfb-col-md-4 dlgfb-mb-2">
                <input type="email" className="dlgfb-form-control" placeholder="Email, optional" aria-label="Email"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <button className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" disabled={saving}>{saving ? "Adding" : "Add attendee"}</button>
          </form>
        </div>
      </div> */}

      <div className="dlgfb-filter-row">
        <input type="search" className="dlgfb-form-control" placeholder="Search by name, display name, email or company"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />
        <select className="dlgfb-custom-select" value={walkIn} onChange={(e) => setWalkIn(e.target.value)} aria-label="Filter by source">
          <option value="">All attendees</option>
          <option value="false">From the CRM</option>
          <option value="true">Self-registered</option>
        </select>
      </div>

      <div className="dlgfb-table-card">
        <table className="dlgfb-table dlgfb-table-hover dlgfb-table-stack dlgfb-mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Attendee name</th>
              <th>Company name</th>
              <th>Display name</th>
              <th>Display company</th>
              <th>Email</th>
              <th>Feedback</th>
              <th className="dlgfb-text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={8} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">
                {q || walkIn ? "No attendees match these filters." : "No attendees yet. Use Sync now to fetch them from the CRM."}
              </td></tr>
            )}
            {pageSlice(list, page).map((a) => (
              <tr key={a.attendee_id}>
                <td data-label="ID" className="dlgfb-id-cell">{padId(a.attendee_id, 3)}</td>
                <td data-label="Name" className="dlgfb-font-weight-bold">
                  {a.full_name}
                  {a.is_walk_in && <span className="dlgfb-badge dlgfb-badge-self-registered dlgfb-ml-2" title="Added on the feedback form">Self-registered</span>}
                </td>
                <td data-label="Company">{a.company_name || "---"}</td>
                {/* Confirmed on the feedback form, empty until the attendee submits. */}
                <td data-label="Display name" className="dlgfb-font-weight-bold">{a.alias_name || "---"}</td>
                <td data-label="Display company">{a.company_alias_name || "---"}</td>
                <td data-label="Email" className="dlgfb-text-break">{a.email || "---"}</td>
                <td data-label="Feedback">{a.has_submitted ? <span className="dlgfb-badge dlgfb-badge-active">Submitted</span> : <span className="dlgfb-badge dlgfb-badge-pending">Pending</span>}</td>
                <td className="dlgfb-text-right dlgfb-actions-cell">
                  <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-danger" disabled={a.has_submitted} title={a.has_submitted ? "Suspend the submission instead" : undefined}
                    onClick={() => setDeleting(a)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={list.length} onChange={setPage} noun="attendees" />

      {deleting && (
        <ConfirmDialog
          title="Delete attendee"
          confirmLabel="Delete"
          busy={deleteBusy}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        >
          Delete <strong>{deleting.full_name}</strong>{deleting.company_name ? ` from ${deleting.company_name}` : ""}. They will no longer appear in the feedback form.
        </ConfirmDialog>
      )}
    </>
  );
}
