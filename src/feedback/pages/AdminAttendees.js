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
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/attendees/", { params: { q: q || undefined } });
      setList(data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    }
  }, [q, notify]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => setPage(1), [q]);
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount(list.length)));
  }, [list.length]);

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
      <div className="page-head">
        <div>
          <h1>Attendees</h1>
          <p className="text-muted mb-0">Everyone listed here can find their name on the feedback form.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-value">{list.length}</span><span className="stat-label">{q ? "Matching" : "Attendees"}</span></div>
        <div className="stat-card stat-good"><span className="stat-value">{submitted}</span><span className="stat-label">Submitted</span></div>
        <div className="stat-card"><span className="stat-value">{list.length - submitted}</span><span className="stat-label">Pending</span></div>
      </div>

      <div className="row">
        <div className="col-lg-8 mb-3">
          <form className="panel" onSubmit={add}>
            <h2 className="h6 mb-3">Add an attendee</h2>
            <div className="form-row">
              <div className="col-md-4 mb-2">
                <input className="form-control" placeholder="Attendee name" aria-label="Attendee name"
                  value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="col-md-4 mb-2">
                <input className="form-control" placeholder="Company name" aria-label="Company name"
                  value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
              <div className="col-md-4 mb-2">
                <input type="email" className="form-control" placeholder="Email, optional" aria-label="Email"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={saving}>{saving ? "Adding" : "Add attendee"}</button>
          </form>
        </div>
        <div className="col-lg-4 mb-3">
          <div className="panel h-100">
            <h2 className="h6 mb-2">Import from CSV</h2>
            <p className="small text-muted">Columns full_name, company_name, email. Rows with an existing email are skipped.</p>
            <div className="custom-file">
              <input ref={fileRef} type="file" accept=".csv" className="custom-file-input" id="csv-file" onChange={importCsv} disabled={importing} />
              <label className="custom-file-label" htmlFor="csv-file">{importing ? "Importing" : "Choose CSV file"}</label>
            </div>
          </div>
        </div>
      </div>

      <div className="filter-row">
        <input type="search" className="form-control" placeholder="Search by name, email or company"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search attendees" />
      </div>

      <div className="table-card">
        <table className="table table-hover table-stack mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Attendee name</th>
              <th>Company name</th>
              <th>Email</th>
              <th>Feedback</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="empty-row"><td colSpan={6} className="text-center text-muted py-4">
                {q ? "No attendees match this search." : "No attendees yet. Add one above or import a CSV."}
              </td></tr>
            )}
            {pageSlice(list, page).map((a) => (
              <tr key={a.attendee_id}>
                <td data-label="ID" className="id-cell">{a.attendee_id}</td>
                <td data-label="Name" className="font-weight-bold">{a.full_name}</td>
                <td data-label="Company">{a.company_name || "Not listed"}</td>
                <td data-label="Email" className="text-break">{a.email || "Not on file"}</td>
                <td data-label="Feedback">{a.has_submitted ? <span className="badge badge-active">Submitted</span> : <span className="badge badge-pending">Pending</span>}</td>
                <td className="text-right actions-cell">
                  <button className="btn btn-sm btn-outline-danger" disabled={a.has_submitted} title={a.has_submitted ? "Suspend the submission instead" : undefined}
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
