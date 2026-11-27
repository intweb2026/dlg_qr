import { useCallback, useEffect, useState } from "react";
import api, { errorMessage } from "../api";
import { useToast } from "../context/ToastContext";
import { formatEventTime } from "../utils/eventTime";

const SOURCES = { website: "event website", setting: "set in events.json" };

/** "Nov 9, 2026", a day with no time, shown as it is whatever the browser's time zone. */
function dayText(day) {
  if (!day) return "Not known";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/** A moment in the event's time zone, "Not known" when there is none. */
const momentText = (iso, timeZone) => (iso ? formatEventTime(iso, timeZone) : "Not known");

/**
 * The event's dates for the admin, with where they come from and the times that follow from them. The dates are read from
 * the event website once a day together with the registered attendees, Refresh now reads them at once. The times that
 * depend on them, the form opening, the end of the daily sync and the report, follow a change by themselves.
 */
export default function EventDatesPanel({ reloadKey }) {
  const notify = useToast();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/event-dates/");
      setInfo(data);
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Event dates not loaded" });
    }
  }, [notify]);

  // reloadKey changes when the website address is saved, which reads the dates again from the new site.
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const refresh = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/event-dates/refresh/");
      if (data.detail || (data.error && !data.start && !data.end)) {
        notify(data.error || data.detail, "danger", { title: "Dates not read" });
      } else if (data.error) {
        notify(`${data.error}. The dates last read are kept.`, "warning", { title: "Dates not read" });
      } else {
        notify("The event dates were read again from the event website.", "success", { title: "Dates refreshed" });
      }
      setInfo(data.start !== undefined ? data : info);
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Dates not refreshed" });
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;
  const zone = info.time_zone;
  const source = (key) => (info.sources?.[key] ? <span className="dlgfb-text-muted"> ({SOURCES[info.sources[key]]})</span> : null);

  return (
    <div className="dlgfb-panel dlgfb-mb-3 dlgfb-event-dates">
      <div className="dlgfb-event-dates-head">
        <div>
          <span className="dlgfb-panel-label">Event dates</span>
          <p className="dlgfb-panel-help dlgfb-mb-0">
            {info.readable
              ? "Read from the event website once a day, together with the registered attendees. A change there reaches the form opening, the daily sync and the report by itself."
              : "This event has no website link, so the dates cannot be read. Add the website domain below, or set the dates in events.json."}
          </p>
        </div>
        <button type="button" className="dlgfb-btn dlgfb-btn-light dlgfb-btn-sm" disabled={busy || !info.readable} onClick={refresh}>
          {busy ? "Reading" : "Refresh now"}
        </button>
      </div>

      <dl className="dlgfb-event-dates-list">
        <div><dt>First day</dt><dd>{dayText(info.start)}{source("start")}</dd></div>
        <div><dt>Last day</dt><dd>{dayText(info.end)}{source("end")}</dd></div>
        <div><dt>Time zone</dt><dd>{zone || "Not known"}{source("time_zone")}</dd></div>
        <div><dt>Location</dt><dd>{info.location || "Not known"}</dd></div>
        <div><dt>Feedback form opens</dt><dd>{momentText(info.form_opens_at, zone)}</dd></div>
        <div><dt>Daily attendee sync stops</dt><dd>{momentText(info.sync_until, zone)}</dd></div>
        <div><dt>Report is emailed</dt><dd>{momentText(info.report_due_at, zone)}</dd></div>
        <div><dt>Last read</dt><dd>{info.read_at ? momentText(info.read_at, zone) : "Not yet"}</dd></div>
        <div><dt>Read again</dt><dd>{info.readable ? momentText(info.next_read_at, zone) : "Never"}</dd></div>
      </dl>
      {info.error && <p className="dlgfb-event-dates-error dlgfb-mb-0">The last read failed, {info.error}. The dates last read are kept and it tries again soon.</p>}
    </div>
  );
}
