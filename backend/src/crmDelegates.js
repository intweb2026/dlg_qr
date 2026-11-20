// The registered delegates come from the iQ Hub CRM, GET CRM_DATA_API_URL?event_code=<event_code> with the
// X-DATA-API-KEY header. They are copied into the event's attendees table, since the feedback form, the submissions and
// the lucky draw all point at an attendee row. The CRM decides who is on the list; walk-ins added on the feedback form
// and anyone who has submitted are never removed by a sync.
//
// The CRM publishes the list once, so it is fetched once. The first visitor to the site after the event's code and key
// are set starts the sync, and form_settings.crm_synced_at records that it was done, so a restart does not fetch it
// again. After that the list changes only when an admin presses Sync now on the Attendees page.
const config = require("./config");
const { query, transaction } = require("./db");
const { loadSettings } = require("./models");
const { collapseSpaces, isoDate } = require("./utils");

const TIMEOUT_MS = 20000;
// A reply split into pages ("next" links) is followed up to this many pages.
const MAX_PAGES = 50;
// While the first sync has not worked, because the CRM failed or has not published the list yet, visitors try again
// at most this often.
const RETRY_MS = 60 * 1000;

// Per event code, { at, ok, error, result } of the last finished attempt, the sync running now, if any, and done once
// the first sync is known to be saved.
const state = new Map();

class CrmSyncError extends Error {}

function eventState(code) {
  if (!state.has(code)) state.set(code, { at: null, ok: null, error: null, result: null, running: null, done: false });
  return state.get(code);
}

/** Why the event cannot sync, or null when it can. */
function syncDisabledReason(event) {
  if (!event.event_code) return `No "event_code" is set for ${event.code} in events.json.`;
  if (!config.crmDataApiKey) return "CRM_DATA_API_KEY is not set in the backend .env.";
  return null;
}

const pick = (item, keys) => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return collapseSpaces(value);
  }
  return "";
};

/** One delegate from the CRM reply as { full_name, company_name, email }, or null when it has no name. */
function delegateFrom(item) {
  if (!item || typeof item !== "object") return null;
  let name = pick(item, ["full_name", "fullName", "name", "delegate_name", "attendee_name"]);
  if (!name) name = collapseSpaces(`${pick(item, ["first_name", "firstName"])} ${pick(item, ["last_name", "lastName"])}`);
  if (!name) return null;
  const email = pick(item, ["email", "email_address", "emailAddress"]).toLowerCase();
  return {
    full_name: name.slice(0, 255),
    company_name: pick(item, ["company_name", "companyName", "company", "organisation", "organization"]).slice(0, 255),
    email: email && email.length <= 255 && email.includes("@") ? email : null,
  };
}

/** The list in a reply, which is either the list itself or an object holding it. */
function listFrom(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const key of ["results", "data", "delegates", "registered_delegates", "items"]) {
      if (Array.isArray(body[key])) return body[key];
      if (body[key] && typeof body[key] === "object" && Array.isArray(body[key].results)) return body[key].results;
    }
  }
  return null;
}

async function getPage(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "X-DATA-API-KEY": config.crmDataApiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CrmSyncError(`The CRM could not be reached, ${err.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new CrmSyncError(`The CRM answered ${res.status} with a reply that is not JSON.`);
  }
  if (!res.ok) {
    const detail = body && typeof body.detail === "string" ? `, ${body.detail}` : "";
    throw new CrmSyncError(`The CRM answered ${res.status}${detail}`);
  }
  return body;
}

/** Every delegate the CRM has for the event, without duplicates. */
async function fetchDelegates(event) {
  const first = new URL(config.crmDataApiUrl);
  first.searchParams.set("event_code", event.event_code);
  const items = [];
  let url = first.href;
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const body = await getPage(url);
    const list = listFrom(body);
    if (!list) throw new CrmSyncError("The CRM reply has no list of delegates.");
    items.push(...list);
    // Only follow a next page on the same host, so the key is never sent anywhere else.
    const next = body && !Array.isArray(body) && typeof body.next === "string" ? new URL(body.next, url) : null;
    url = next && next.host === first.host ? next.href : null;
  }

  const delegates = [];
  const seen = new Set();
  let unnamed = 0;
  for (const item of items) {
    const delegate = delegateFrom(item);
    if (!delegate) {
      unnamed += 1;
      continue;
    }
    const key = delegate.email || `${delegate.full_name}\n${delegate.company_name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    delegates.push(delegate);
  }
  if (items.length && !delegates.length) {
    const fields = Object.keys(items[0] || {}).join(", ");
    throw new CrmSyncError(`The CRM delegates have no name field the site knows, the fields are ${fields || "none"}.`);
  }
  return { delegates, unnamed };
}

/**
 * Brings the attendees table in line with the CRM. A delegate is matched by email, or by name and company when the
 * CRM has no email. Matched rows take the CRM's name and company; a walk-in the CRM now lists becomes a registered
 * attendee. Registered attendees no longer in the CRM are removed, unless they have submitted. An empty CRM list
 * removes nobody, it is more likely a wrong event code than an event with no delegates.
 */
async function applyDelegates(delegates) {
  await loadSettings(); // the form_settings row the sync is recorded on
  return transaction(async (q) => {
    const rows = await q(
      `SELECT a.attendee_id, a.full_name, a.email, a.company_name, a.is_walk_in, s.id IS NOT NULL AS has_submitted
       FROM attendees a LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id`
    );
    const byEmail = new Map();
    const byName = new Map();
    for (const row of rows) {
      if (row.email) byEmail.set(row.email.toLowerCase(), row);
      else byName.set(`${row.full_name}\n${row.company_name}`.toLowerCase(), row);
    }

    const keep = new Set();
    let created = 0;
    let updated = 0;
    for (const d of delegates) {
      const row = d.email ? byEmail.get(d.email) : byName.get(`${d.full_name}\n${d.company_name}`.toLowerCase());
      if (row) {
        keep.add(row.attendee_id);
        if (row.full_name !== d.full_name || row.company_name !== d.company_name || row.is_walk_in) {
          await q("UPDATE attendees SET full_name = ?, company_name = ?, is_walk_in = 0 WHERE attendee_id = ?", [
            d.full_name,
            d.company_name,
            row.attendee_id,
          ]);
          updated += 1;
        }
        continue;
      }
      await q(
        "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
        [d.full_name, d.email, d.company_name]
      );
      created += 1;
    }

    let removed = 0;
    let kept = 0;
    if (delegates.length) {
      for (const row of rows) {
        if (row.is_walk_in || keep.has(row.attendee_id)) continue;
        if (row.has_submitted) {
          kept += 1;
          continue;
        }
        await q("DELETE FROM attendees WHERE attendee_id = ?", [row.attendee_id]);
        removed += 1;
      }
    }
    // An empty list is not recorded, so the first sync is tried again once the CRM publishes the list.
    if (delegates.length) {
      await q("UPDATE form_settings SET crm_synced_at = UTC_TIMESTAMP(6), crm_synced_count = ? WHERE id = 1", [delegates.length]);
    }
    return { created, updated, removed, kept };
  });
}

/**
 * Fetches the event's delegates and saves them. Calls made while a sync is running share it. Throws CrmSyncError
 * when the event cannot sync or the CRM fails, the attendee list is then left as it was.
 */
function syncDelegates(event) {
  const s = eventState(event.code);
  if (s.running) return s.running;
  s.running = (async () => {
    try {
      const reason = syncDisabledReason(event);
      if (reason) throw new CrmSyncError(reason);
      const { delegates, unnamed } = await fetchDelegates(event);
      const result = { fetched: delegates.length, skipped: unnamed, ...(await applyDelegates(delegates)) };
      Object.assign(s, { at: new Date(), ok: true, error: null, result, done: s.done || delegates.length > 0 });
      return result;
    } catch (err) {
      Object.assign(s, { at: new Date(), ok: false, error: err instanceof CrmSyncError ? err.message : "The sync failed." });
      throw err;
    } finally {
      s.running = null;
    }
  })();
  return s.running;
}

/**
 * Runs the first sync for the event, for the public pages. Once the list is saved this does nothing, so the CRM is
 * called once in the event's life, not on every visit. Calls made while it runs wait for the same sync. A failure, or
 * a CRM with no delegates yet, is tried again by a visit at least a minute later; the page carries on with the saved list.
 */
async function syncOnFirstVisit(event) {
  if (syncDisabledReason(event)) return;
  const s = eventState(event.code);
  if (s.done) return;
  if (!s.running) {
    const [row] = await query("SELECT crm_synced_at FROM form_settings WHERE id = 1");
    if (row?.crm_synced_at) {
      s.done = true;
      return;
    }
    if (s.at && Date.now() - s.at.getTime() < RETRY_MS) return;
  }
  await syncDelegates(event).catch((err) => {
    console.error(`${event.code}: CRM delegates sync failed, ${err.message}`);
  });
}

/** What the admin page shows, the saved sync and the last attempt since the API started. */
async function syncStatus(event) {
  const s = eventState(event.code);
  const settings = await loadSettings();
  return {
    enabled: !syncDisabledReason(event),
    reason: syncDisabledReason(event),
    event_code: event.event_code || null,
    running: Boolean(s.running),
    synced_at: isoDate(settings.crm_synced_at), // stored in UTC
    synced_count: settings.crm_synced_count ?? null,
    last_attempt_at: s.at ? s.at.toISOString() : null,
    ok: s.ok,
    error: s.error,
    result: s.result,
  };
}

/** Forgets every sync, for the tests. */
function resetSyncState() {
  state.clear();
}

module.exports = { CrmSyncError, delegateFrom, fetchDelegates, resetSyncState, syncDelegates, syncOnFirstVisit, syncStatus };
