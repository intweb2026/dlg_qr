import { useCallback, useEffect, useState } from "react";
import api, { errorMessage } from "../api";
import { useToast } from "../context/ToastContext";
import { useEventTime, useEventTimeZone } from "../utils/eventTime";

const KIND_LABELS = {
  crm_webhook: "CRM, feedback responses",
  event_dates: "Event website, dates",
  crm_sync: "CRM, delegates",
  email: "Email",
  gemini: "Gemini",
};
const PAGE = 50;
/** Pretty text of a saved reply, JSON is laid out, anything else is shown as it is. */
function pretty(text) {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function AdminLogbook() {
  const notify = useToast();
  const eventTime = useEventTime();
  const zone = useEventTimeZone();
  const [rows, setRows] = useState(null);
  const [kinds, setKinds] = useState(Object.keys(KIND_LABELS));
  const [kind, setKind] = useState("");
  const [ok, setOk] = useState("");
  const [more, setMore] = useState(null); // the id to continue from, null when there is no more
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before) => {
      setBusy(true);
      try {
        const params = { limit: PAGE };
        if (kind) params.kind = kind;
        if (ok) params.ok = ok;
        if (before) params.before = before;
        const { data } = await api.get("/admin/logbook/", { params });
        if (Array.isArray(data.kinds)) setKinds(data.kinds);
        setRows((cur) => (before && cur ? [...cur, ...data.results] : data.results));
        setMore(data.has_more ? data.next_before : null);
      } catch (err) {
        notify(errorMessage(err), "danger", { title: "Log not loaded" });
      } finally {
        setBusy(false);
      }
    },
    [kind, ok, notify]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Logbook</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">
            Everything this app sent out or asked of another service, with the answer, the time and what started it. Times are in the event's time zone{zone ? ` (${zone})` : ""}. Keys, attendee answers and typed text are never kept here, and old rows are removed after 90 days.
          </p>
        </div>
        <button type="button" className="dlgfb-btn dlgfb-btn-light dlgfb-btn-sm" disabled={busy} onClick={() => load()}>Refresh</button>
      </div>

      <div className="dlgfb-log-filters">
        <select className="dlgfb-custom-select" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k] || k}</option>)}
        </select>
        <select className="dlgfb-custom-select" aria-label="Result" value={ok} onChange={(e) => setOk(e.target.value)}>
          <option value="">Any result</option>
          <option value="1">Worked</option>
          <option value="0">Failed</option>
        </select>
      </div>

      <div className="dlgfb-table-card">
        <table className="dlgfb-table dlgfb-table-hover dlgfb-table-stack dlgfb-mb-0">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>To</th>
              <th>Result</th>
              <th>Took</th>
              <th>Started by</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr className="dlgfb-empty-row"><td colSpan={7} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">Nothing logged yet.</td></tr>
            )}
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td data-label="When">{eventTime(r.created_at, { seconds: true })}</td>
                <td data-label="Type">{KIND_LABELS[r.kind] || r.kind}</td>
                <td data-label="To" className="dlgfb-log-target">{r.target || "---"}</td>
                <td data-label="Result">
                  <span className={`dlgfb-badge ${r.ok ? "dlgfb-badge-active" : "dlgfb-badge-suspended"}`}>{r.ok ? "Worked" : "Failed"}</span>
                  {r.http_status ? <span className="dlgfb-text-muted dlgfb-ml-2">{r.http_status}</span> : null}
                </td>
                <td data-label="Took">{r.duration_ms === null ? "---" : `${r.duration_ms} ms`}</td>
                <td data-label="Started by">{r.triggered_by || "---"}</td>
                <td data-label="Details">
                  {r.summary && <div>{r.summary}</div>}
                  {r.error && <div className="dlgfb-log-error">{r.error}</div>}
                  {r.response && (
                    <details className="dlgfb-log-response">
                      <summary>Reply</summary>
                      <pre>{pretty(r.response)}</pre>
                    </details>
                  )}
                  {!r.summary && !r.error && !r.response && "---"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {more && (
        <div className="dlgfb-text-center dlgfb-mt-3">
          <button type="button" className="dlgfb-btn dlgfb-btn-light" disabled={busy} onClick={() => load(more)}>Show older</button>
        </div>
      )}
    </>
  );
}
