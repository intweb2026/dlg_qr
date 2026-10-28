import { useCallback, useEffect, useRef, useState } from "react";
import api, { errorMessage } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination, { pageCount, pageSlice } from "../components/Pagination";
import { useToast } from "../context/ToastContext";

const EMPTY = { full_name: "", company_name: "", email: "" };

export default function AdminAttendees() {
  const notify = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [walkIn, setWalkIn] = useState("");
  const [form, setForm] = useState(EMPTY);
  // eslint-disable-next-line no-unused-vars -- used by the add and import panels, commented out in the JSX below
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line no-unused-vars -- used by the add and import panels, commented out in the JSX below
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const fileRef = useRef(null);

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

  useEffect(() => setPage(1), [q, walkIn]);
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount(list.length)));
  }, [list.length]);

  // eslint-disable-next-line no-unused-vars -- used by the add and import panels, commented out in the JSX below
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

  // eslint-disable-next-line no-unused-vars -- used by the add and import panels, commented out in the JSX below
  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const { data } = await api.post("/admin/attendees/import/", body);
      notify(`${data.created} added, ${data.skipped} skipped as duplicates or blank rows.`, data.created ? "success" : "info", {
        title: "CSV imported",
      });
      if (data.errors?.length) notify(data.errors[0], "danger", { title: `${data.errors.length} row${data.errors.length > 1 ? "s" : ""} failed` });
      load();
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Import failed" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Attendees</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">Everyone listed here can find their name on the feedback form.</p>
        </div>
      </div>

      <div className="dlgfb-stat-grid">
        <div className="dlgfb-stat-card"><span className="dlgfb-stat-value">{list.length}</span><span className="dlgfb-stat-label">{q || walkIn ? "Matching" : "Attendees"}</span></div>
        <div className="dlgfb-stat-card dlgfb-stat-good"><span className="dlgfb-stat-value">{submitted}</span><span className="dlgfb-stat-label">Submitted</span></div>
        <div className="dlgfb-stat-card"><span className="dlgfb-stat-value">{list.length - submitted}</span><span className="dlgfb-stat-label">Pending</span></div>
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
        <div className="dlgfb-col-lg-4 dlgfb-mb-3">
          <div className="dlgfb-panel dlgfb-h-100">
            <h2 className="dlgfb-h6 dlgfb-mb-2">Import from CSV</h2>
            <p className="dlgfb-small dlgfb-text-muted">Columns full_name, company_name, email. Rows with an existing email are skipped.</p>
            <div className="dlgfb-custom-file">
              <input ref={fileRef} type="file" accept=".csv" className="dlgfb-custom-file-input" id="csv-file" onChange={importCsv} disabled={importing} />
              <label className="dlgfb-custom-file-label" htmlFor="csv-file">{importing ? "Importing" : "Choose CSV file"}</label>
            </div>
          </div>
        </div>
      </div> */}

      <div className="dlgfb-filter-row">
        <input type="search" className="dlgfb-form-control" placeholder="Search by name, email or company"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />
        <select className="dlgfb-custom-select" value={walkIn} onChange={(e) => setWalkIn(e.target.value)} aria-label="Filter by source">
          <option value="">All attendees</option>
          <option value="false">From the list</option>
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
              <th>Email</th>
              <th>Feedback</th>
              <th className="dlgfb-text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={6} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">
                {q || walkIn ? "No attendees match these filters." : "No attendees yet. Add one above or import a CSV."}
              </td></tr>
            )}
            {pageSlice(list, page).map((a) => (
              <tr key={a.attendee_id}>
                <td data-label="ID" className="dlgfb-id-cell">{a.attendee_id}</td>
                <td data-label="Name" className="dlgfb-font-weight-bold">
                  {a.full_name}
                  {a.is_walk_in && <span className="dlgfb-badge dlgfb-badge-self-registered dlgfb-ml-2" title="Added on the feedback form">Self-registered</span>}
                </td>
                <td data-label="Company">{a.company_name || "---"}</td>
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
