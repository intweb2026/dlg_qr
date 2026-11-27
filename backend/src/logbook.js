const config = require("./config");
const { query } = require("./db");
const { isoDate } = require("./utils");

// The logbook. Everything this app sends out or asks of another service is written here, one row per attempt,
// into the event's own database, and read on the admin Logbook page.
//   crm_webhook  the feedback responses posted to the CRM when the lucky draw spins
//   crm_sync     the registered delegates read from the CRM
//   email        the feedback submissions report
//   gemini       the AI suggestions on the feedback form
//   event_dates  the event's dates and location read from its website
// Only a short summary and the other side's reply, cut short, are kept. Keys, passwords, attendees' answers and the
// text typed by attendees are never stored. Writing a row never stops the call it describes, a failure is only logged.

const KINDS = ["crm_webhook", "crm_sync", "email", "gemini", "event_dates"];
const MAX_LIST = 200;

const clip = (value, length) => (value === undefined || value === null ? "" : String(value).slice(0, length));

/** The address without any password in it. The keys of the services are sent in headers, never in the address. */
function cleanTarget(target) {
  try {
    const url = new URL(target);
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return String(target ?? "");
  }
}

function asText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Saves one row. entry is { kind, target, method, ok, status, ms, summary, response, error, by }. Runs inside the event's
 * database. Never throws.
 */
async function record(entry) {
  try {
    await query(
      `INSERT INTO logbook (created_at, kind, target, method, ok, http_status, duration_ms, summary, response, error, triggered_by)
       VALUES (UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clip(entry.kind, 30),
        clip(cleanTarget(entry.target), 500),
        clip(entry.method, 10),
        entry.ok ? 1 : 0,
        Number.isInteger(entry.status) ? entry.status : null,
        Number.isFinite(entry.ms) ? Math.max(0, Math.round(entry.ms)) : null,
        clip(entry.summary, 500),
        entry.response === undefined || entry.response === null ? null : clip(asText(entry.response), 1000),
        clip(entry.error, 1000),
        clip(entry.by, 150),
      ]
    );
    // Old rows are cleared now and then, not on every write.
    if (Math.random() < 0.02) {
      await query("DELETE FROM logbook WHERE created_at < UTC_TIMESTAMP(6) - INTERVAL ? SECOND", [Math.floor(config.timing.logbook.keepFor / 1000)]);
    }
  } catch (err) {
    console.error(`logbook entry not saved, ${err.message}`);
  }
}

/** Starts a clock, call the result for the milliseconds since. */
const stopwatch = () => {
  const started = Date.now();
  return () => Date.now() - started;
};

function rowJson(row) {
  return {
    id: Number(row.id),
    created_at: isoDate(row.created_at),
    kind: row.kind,
    target: row.target,
    method: row.method,
    ok: Boolean(row.ok),
    http_status: row.http_status,
    duration_ms: row.duration_ms,
    summary: row.summary,
    response: row.response,
    error: row.error,
    triggered_by: row.triggered_by,
  };
}

/** The newest rows, optionally of one kind and only the ok or failed ones, `before` is the id to continue from. */
async function list({ kind, ok, limit = 50, before } = {}) {
  const where = [];
  const params = [];
  if (KINDS.includes(kind)) {
    where.push("kind = ?");
    params.push(kind);
  }
  if (ok === "1" || ok === "0") {
    where.push("ok = ?");
    params.push(Number(ok));
  }
  if (/^\d+$/.test(String(before ?? ""))) {
    where.push("id < ?");
    params.push(Number(before));
  }
  const size = Math.min(MAX_LIST, Math.max(1, Number.parseInt(limit, 10) || 50));
  const rows = await query(`SELECT * FROM logbook ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...params, size + 1]);
  const page = rows.slice(0, size).map(rowJson);
  return { results: page, has_more: rows.length > size, next_before: rows.length > size ? page[page.length - 1].id : null };
}

module.exports = { KINDS, record, stopwatch, list };
