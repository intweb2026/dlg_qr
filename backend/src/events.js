const fs = require("fs");
const path = require("path");

// Every event is one entry in backend/events.json, keyed by the event code, { "dle26": { ... }, "afs26": { ... } }.
// The code is the first part of every address, /dle26/feedback-form on the site and /api/events/dle26/... on the API.
// "database" is the event's own MySQL database. Everything else in the entry is sent to the site as the event config.
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(__dirname, "..", "events.json");
const CODE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;

function loadEvents(file = EVENTS_FILE) {
  const name = path.basename(file);
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${name}: cannot read it, ${err.message}`);
  }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`${name}: must be an object keyed by event code`);
  }

  const events = new Map();
  const databases = new Map();
  for (const code of Object.keys(entries).sort()) {
    const event = entries[code];
    const fail = (message) => {
      throw new Error(`${name}, event "${code}": ${message}`);
    };
    if (!CODE.test(code)) fail("the code must be lower case letters, digits and dashes");
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("must be an object");
    if (!DATABASE.test(event.database || "")) fail('"database" must be a MySQL database name, letters, digits and _');
    if (databases.has(event.database)) fail(`"database" is already used by event "${databases.get(event.database)}"`);
    databases.set(event.database, code);
    events.set(code, { ...event, code, active: event.active !== false });
  }
  return events;
}

const events = loadEvents();

/** The event for an address code, or null when there is none or it is switched off. Codes are matched without case. */
function getEvent(code) {
  const event = events.get(String(code || "").toLowerCase());
  return event && event.active ? event : null;
}

/** Every event, including inactive ones, for the command line scripts. */
function allEvents() {
  return [...events.values()];
}

/** What the site receives, the entry with its code and without the database name. */
function publicConfig(event) {
  const { database, ...rest } = event;
  return rest;
}

module.exports = { EVENTS_FILE, loadEvents, getEvent, allEvents, publicConfig };
