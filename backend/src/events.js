const fs = require("fs");
const path = require("path");

// Every event is one entry in backend/events.json, keyed by the event code, { "dle26": { ... }, "afs26": { ... } }.
// The code is the first part of every address, /dle26/feedback-form on the site and /api/events/dle26/... on the API.
// "database" is the event's own MySQL database. Everything else in the entry is sent to the site as the event config.
// The name, tagline, colour, media, links and Wi-Fi only fill the event's Event Details the first time, after that the
// admin page's values are used, see eventDetails.js.
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(__dirname, "..", "events.json");
const CODE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;
// "theme": { "secondary": "#278dff" } is optional, the site uses #278dff without it.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// "speakerReviews" is optional; each key left out takes its default. maxPerDay is how many sessions an attendee can
// review on each day of the agenda, titleMaxWords the most words in a session's AI shortened title.
const SPEAKER_REVIEW_DEFAULTS = { maxPerDay: 3, titleMaxWords: 7 };
const SPEAKER_REVIEW_RANGES = { maxPerDay: [1, 50], titleMaxWords: [3, 20] };

/** The event's speaker review settings with the defaults filled in. */
function speakerReviewSettings(event) {
  return { ...SPEAKER_REVIEW_DEFAULTS, ...(event?.speakerReviews || {}) };
}

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
    if (event.theme !== undefined) {
      if (!event.theme || typeof event.theme !== "object" || Array.isArray(event.theme)) fail('"theme" must be an object');
      if (event.theme.secondary !== undefined && !HEX_COLOR.test(event.theme.secondary)) {
        fail('"theme.secondary" must be a colour like #278dff');
      }
    }
    if (event.event_code !== undefined && (typeof event.event_code !== "string" || !event.event_code.trim())) {
      fail('"event_code" must be the event code in the CRM, such as "AIU - AD"');
    }
    if (event.speakerReviews !== undefined) {
      const sr = event.speakerReviews;
      if (!sr || typeof sr !== "object" || Array.isArray(sr)) fail('"speakerReviews" must be an object');
      for (const key of Object.keys(sr)) {
        const range = SPEAKER_REVIEW_RANGES[key];
        if (!range) fail(`"speakerReviews.${key}" is not a setting, use ${Object.keys(SPEAKER_REVIEW_RANGES).join(" or ")}`);
        if (!Number.isInteger(sr[key]) || sr[key] < range[0] || sr[key] > range[1]) {
          fail(`"speakerReviews.${key}" must be a whole number from ${range[0]} to ${range[1]}`);
        }
      }
    }
    events.set(code, { ...event, code, active: event.active !== false, speakerReviews: speakerReviewSettings(event) });
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

/** What the site receives, the entry with its code and without the database name or the CRM event code. */
function publicConfig(event) {
  const { database, event_code, ...rest } = event;
  return rest;
}

module.exports = { EVENTS_FILE, loadEvents, getEvent, allEvents, publicConfig, speakerReviewSettings, SPEAKER_REVIEW_DEFAULTS };
