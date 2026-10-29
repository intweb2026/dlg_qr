const fs = require("fs");
const path = require("path");

// One JSON file per event in backend/events, named after the event code, for example events/dle26.json.
// The code is the first part of every address, /dle26/feedback-form on the site and /api/events/dle26/... on the API.
// "database" is the event's own MySQL database. Everything else in the file is sent to the site as the event config.
const EVENTS_DIR = process.env.EVENTS_DIR || path.join(__dirname, "..", "events");
const CODE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;

function loadEvents(dir = EVENTS_DIR) {
  const events = new Map();
  const databases = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const code = path.basename(file, ".json");
    const fail = (message) => {
      throw new Error(`events/${file}: ${message}`);
    };
    let event;
    try {
      event = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      fail(`not valid JSON, ${err.message}`);
    }
    if (!CODE.test(code)) fail("the file name must be the event code, lower case letters, digits and dashes");
    if (event.code !== code) fail(`"code" must be "${code}", the same as the file name`);
    if (!DATABASE.test(event.database || "")) fail('"database" must be a MySQL database name, letters, digits and _');
    if (databases.has(event.database)) fail(`"database" is already used by events/${databases.get(event.database)}.json`);
    databases.set(event.database, file);
    events.set(code, { ...event, active: event.active !== false });
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

/** What the site receives, the file without the database name. */
function publicConfig(event) {
  const { database, ...rest } = event;
  return rest;
}

module.exports = { EVENTS_DIR, loadEvents, getEvent, allEvents, publicConfig };
