// The event's last day, used to stop the daily CRM re-sync once the event is over, see crmDelegates.js.
// It is read from the event website's agenda, the same API the feedback form's sessions come from (see
// views/speakerSessions.js): the "day" entries are headed with their date, "MONDAY, NOVEMBER 9, 2026", and the
// latest one is the end date. The website's own "event_dates" is not used, it moves on to the next edition early.
// "eventEndDate": "2026-11-10" in events.json, when set, is used instead of the agenda.
//
// The first day opens the feedback form: it takes answers from 12:00 AM of the first day where the event is held, and
// then stays open for good. "eventStartDate": "2026-11-09" in events.json, when set, is used instead of the agenda.
//
// The sync stops when that day ends where the event is held: at 11:59 PM in Anaheim for an event in the USA, not in
// India. The place is the website's "event_Location", "Anaheim, California, USA", read from the same page data the
// upcoming conferences come from (see views/upcomingConferences.js), and turned into a time zone by timeZones.js.
// "timeZone": "America/Los_Angeles" in events.json, when set, is used instead. With no time zone known, the sync runs
// until 36 hours after the last day starts in UTC, by then the day is over everywhere.

const { endOfDayIn, startOfDayIn, timeZoneForLocation } = require("./timeZones");
const { initialData } = require("./views/upcomingConferences");

const TIMEOUT_MS = 5000;
const CACHE_MS = 6 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 10 * 60 * 1000;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Event code to { at, ttl, end }, so the agenda is read at most every 6 hours per event.
const cache = new Map();
// Event code to { at, ttl, location }, the same for the website's location.
const locationCache = new Map();
// Without a time zone, the last day is over everywhere this long after it starts in UTC.
const NO_ZONE_GRACE_MS = 36 * 60 * 60 * 1000;
// Without a time zone, the first day starts this long before it starts in UTC, in the earliest zone (UTC+14).
const EARLIEST_ZONE_MS = 14 * 60 * 60 * 1000;

/** The agenda API, "links.agendaApi", or <website>/api/agenda; null when the event has neither. */
function agendaApiUrl(event) {
  if (event.links?.agendaApi) return event.links.agendaApi;
  if (!event.links?.website) return null;
  return new URL("/api/agenda", event.links.website).toString();
}

function utcDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  // Rejects dates such as February 31, which Date.UTC rolls into March.
  return date.getUTCMonth() === monthIndex && date.getUTCDate() === day ? date : null;
}

/** The date in a day heading, "MONDAY, NOVEMBER 9, 2026" or "9 November 2026", as UTC midnight, or null. */
function dateFromHeading(text) {
  const plain = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const monthIndex = (name) => MONTHS.findIndex((m) => m === name || (name.length >= 3 && m.startsWith(name)));
  let m = plain.match(/([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && monthIndex(m[1]) !== -1) return utcDate(Number(m[3]), monthIndex(m[1]), Number(m[2]));
  m = plain.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})/);
  if (m && monthIndex(m[2]) !== -1) return utcDate(Number(m[3]), monthIndex(m[2]), Number(m[1]));
  return null;
}

/** The first and last dates among the agenda's "day" entries, as { start, end }, null when none has a date. */
function datesFromAgenda(agenda) {
  const dates = (Array.isArray(agenda) ? agenda : [])
    .filter((e) => e?.status === "day")
    .map((e) => dateFromHeading(e.heading))
    .filter(Boolean)
    .map(Number);
  return dates.length ? { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) } : { start: null, end: null };
}

/** The latest date among the agenda's "day" entries, or null when none has a date. */
function endDateFromAgenda(agenda) {
  return datesFromAgenda(agenda).end;
}

/** A "YYYY-MM-DD" setting from events.json as UTC midnight, or null when it is not set. */
function configuredDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return m ? utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "eventEndDate" from events.json as UTC midnight, or null when it is not set. */
function configuredEndDate(event) {
  return configuredDate(event.eventEndDate);
}

/** The agenda's first and last days, { start, end }, each UTC midnight or null. Read at most every 6 hours. */
async function agendaDates(event) {
  const url = agendaApiUrl(event);
  if (!url) return { start: null, end: null };

  const hit = cache.get(event.code);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.dates;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "event-feedback-form", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const dates = datesFromAgenda(await res.json());
    cache.set(event.code, { at: Date.now(), ttl: dates.end ? CACHE_MS : FAILURE_CACHE_MS, dates });
    return dates;
  } catch (err) {
    console.error(`${event.code}: event dates not read from the agenda, ${err.message}`);
    // Keep the last dates read, if any, and try again in 10 minutes.
    const dates = hit ? hit.dates : { start: null, end: null };
    cache.set(event.code, { at: Date.now(), ttl: FAILURE_CACHE_MS, dates });
    return dates;
  }
}

/** The event's last day as UTC midnight, "eventEndDate" or the agenda's last day, or null when it cannot be told. */
async function eventEndDate(event) {
  return configuredEndDate(event) || (await agendaDates(event)).end;
}

/** The event's first day as UTC midnight, "eventStartDate" or the agenda's first day, or null when it cannot be told. */
async function eventStartDate(event) {
  return configuredDate(event.eventStartDate) || (await agendaDates(event)).start;
}

/** "event_Location" from the website's page data, "Anaheim, California, USA", or "" when there is none. */
function locationFromData(data) {
  const details = Array.isArray(data?.eventDetails) ? data.eventDetails : [];
  const item = details.find((d) => String(d?.option || "").toLowerCase() === "event_location");
  return String(item?.value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Where the event is held, from its website, or "" when it cannot be read. */
async function eventLocation(event) {
  const website = event.links?.website;
  if (!website) return "";
  const hit = locationCache.get(event.code);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.location;
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "event-feedback-form", Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${website} answered ${res.status}`);
    const location = locationFromData(initialData(await res.text()));
    locationCache.set(event.code, { at: Date.now(), ttl: location ? CACHE_MS : FAILURE_CACHE_MS, location });
    return location;
  } catch (err) {
    console.error(`${event.code}: event location not read from the website, ${err.message}`);
    const location = hit ? hit.location : "";
    locationCache.set(event.code, { at: Date.now(), ttl: FAILURE_CACHE_MS, location });
    return location;
  }
}

/**
 * The event's times where it is held, as { start, end, location, timeZone, opensAt, until }.
 * opensAt, when the feedback form opens, is 12:00 AM of the first day in the event's time zone; with no time zone
 * known, the moment that day starts anywhere (UTC+14). until, when the daily CRM sync stops, is 11:59 PM of the last
 * day there; with no time zone known, 36 hours after the last day starts in UTC. Each is null when its day is unknown.
 */
async function eventSchedule(event) {
  const [start, end] = [await eventStartDate(event), await eventEndDate(event)];
  const location = event.timeZone ? "" : await eventLocation(event);
  const timeZone = event.timeZone || timeZoneForLocation(location);
  let until = null;
  if (end) until = timeZone ? endOfDayIn(end, timeZone) : new Date(end.getTime() + NO_ZONE_GRACE_MS);
  let opensAt = null;
  if (start) opensAt = timeZone ? startOfDayIn(start, timeZone) : new Date(start.getTime() - EARLIEST_ZONE_MS);
  return { start, end, location, timeZone: timeZone || null, opensAt, until };
}

/** Whether the feedback form takes answers now, and when it opens. Open when the first day is not known. */
async function feedbackOpening(event) {
  const { opensAt, timeZone } = await eventSchedule(event);
  return { open: !opensAt || Date.now() >= opensAt.getTime(), opensAt, timeZone };
}

/** Forgets the dates and places read, for the tests. */
function resetEventDates() {
  cache.clear();
  locationCache.clear();
}

module.exports = {
  agendaApiUrl,
  configuredEndDate,
  dateFromHeading,
  datesFromAgenda,
  endDateFromAgenda,
  eventEndDate,
  eventSchedule,
  eventStartDate,
  feedbackOpening,
  locationFromData,
  resetEventDates,
};
