// The event's last day, used to stop the daily CRM re-sync once the event is over, see crmDelegates.js.
// It is read from the event website's agenda, the same API the feedback form's sessions come from (see
// views/speakerSessions.js): the "day" entries are headed with their date, "MONDAY, NOVEMBER 9, 2026", and the
// latest one is the end date. The website's own "event_dates" is not used, it moves on to the next edition early.
// "eventEndDate": "2026-11-10" in events.json, when set, is used instead of the agenda.
//
// The first day opens the feedback form: it takes answers from 12:00 AM of the first day where the event is held, and
// then stays open for good. "eventStartDate": "2026-11-09" in events.json, when set, is used instead of the agenda.
//
// The dates are read from the website once a day, at the same time as the registered delegates (crmDelegates.js calls
// refreshEventDates whenever it syncs, the daily sync and Sync now included), so a changed date reaches the form
// opening, the report and the sync stop by itself. A failed read keeps the dates last read and tries again in 10 minutes.
//
// The sync stops when that day ends where the event is held: at 11:59 PM in Anaheim for an event in the USA, not in
// India. The place is the website's "event_Location", "Anaheim, California, USA", read from the same page data the
// upcoming conferences come from (see views/upcomingConferences.js), and turned into a time zone by timeZones.js.
// "timeZone": "America/Los_Angeles" in events.json, when set, is used instead. With no time zone known, the sync runs
// until 36 hours after the last day starts in UTC, by then the day is over everywhere.

const config = require("./config");
const logbook = require("./logbook");
const { endOfDayIn, startOfDayIn, timeZoneForLocation } = require("./timeZones");
const { initialData } = require("./views/upcomingConferences");

// Timeouts and cache lengths are in config.js, timing.eventDates.
const TIMING = config.timing.eventDates;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Event code to { at, ttl, dates, okAt, error }, so the agenda is read at most once a day per event. at is the last try,
// okAt the last read that worked, error why the last try failed.
const cache = new Map();
// Event code to { at, ttl, location, okAt, error }, the same for the website's location.
const locationCache = new Map();

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

/** The agenda's first and last days, { start, end }, each UTC midnight or null. Read at most once a day. */
async function agendaDates(event, by = "automatic") {
  const url = agendaApiUrl(event);
  if (!url) return { start: null, end: null };

  const hit = cache.get(event.code);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.dates;
  const elapsed = logbook.stopwatch();
  const logged = { kind: "event_dates", target: url, method: "GET", by };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "event-feedback-form", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMING.requestTimeout),
    });
    if (!res.ok) throw Object.assign(new Error(`${url} answered ${res.status}`), { status: res.status });
    const dates = datesFromAgenda(await res.json());
    cache.set(event.code, { at: Date.now(), ttl: dates.end ? TIMING.cache : TIMING.failureCache, dates, okAt: Date.now(), error: null });
    await logbook.record({
      ...logged,
      ok: Boolean(dates.end),
      status: res.status,
      ms: elapsed(),
      summary: dates.end ? `Agenda dates ${isoDay(dates.start)} to ${isoDay(dates.end)}` : "",
      error: dates.end ? "" : "The agenda has no dated days.",
    });
    return dates;
  } catch (err) {
    console.error(`${event.code}: event dates not read from the agenda, ${err.message}`);
    await logbook.record({ ...logged, ok: false, status: err.status, ms: elapsed(), error: err.message });
    // Keep the last dates read, if any, and try again in 10 minutes.
    const dates = hit ? hit.dates : { start: null, end: null };
    cache.set(event.code, { at: Date.now(), ttl: TIMING.failureCache, dates, okAt: hit?.okAt ?? null, error: err.message });
    return dates;
  }
}

/** The event's last day as UTC midnight, "eventEndDate" or the agenda's last day, or null when it cannot be told. */
async function eventEndDate(event, by) {
  return configuredEndDate(event) || (await agendaDates(event, by)).end;
}

/** The event's first day as UTC midnight, "eventStartDate" or the agenda's first day, or null when it cannot be told. */
async function eventStartDate(event, by) {
  return configuredDate(event.eventStartDate) || (await agendaDates(event, by)).start;
}

/** "event_Location" from the website's page data, "Anaheim, California, USA", or "" when there is none. */
function locationFromData(data) {
  const details = Array.isArray(data?.eventDetails) ? data.eventDetails : [];
  const item = details.find((d) => String(d?.option || "").toLowerCase() === "event_location");
  return String(item?.value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Where the event is held, from its website, or "" when it cannot be read. */
async function eventLocation(event, by = "automatic") {
  const website = event.links?.website;
  if (!website) return "";
  const hit = locationCache.get(event.code);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.location;
  const elapsed = logbook.stopwatch();
  const logged = { kind: "event_dates", target: website, method: "GET", by };
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "event-feedback-form", Accept: "text/html" },
      signal: AbortSignal.timeout(TIMING.requestTimeout),
    });
    if (!res.ok) throw Object.assign(new Error(`${website} answered ${res.status}`), { status: res.status });
    const location = locationFromData(initialData(await res.text()));
    locationCache.set(event.code, { at: Date.now(), ttl: location ? TIMING.cache : TIMING.failureCache, location, okAt: Date.now(), error: null });
    await logbook.record({
      ...logged,
      ok: Boolean(location),
      status: res.status,
      ms: elapsed(),
      summary: location ? `Event location, ${location}` : "",
      error: location ? "" : "The page has no event location.",
    });
    return location;
  } catch (err) {
    console.error(`${event.code}: event location not read from the website, ${err.message}`);
    await logbook.record({ ...logged, ok: false, status: err.status, ms: elapsed(), error: err.message });
    const location = hit ? hit.location : "";
    locationCache.set(event.code, { at: Date.now(), ttl: TIMING.failureCache, location, okAt: hit?.okAt ?? null, error: err.message });
    return location;
  }
}

/**
 * The event's times where it is held, as { start, end, location, timeZone, opensAt, until }.
 * opensAt, when the feedback form opens, is 12:00 AM of the first day in the event's time zone; with no time zone
 * known, the moment that day starts anywhere (UTC+14). until, when the daily CRM sync stops, is 11:59 PM of the last
 * day there; with no time zone known, 36 hours after the last day starts in UTC. Each is null when its day is unknown.
 */
async function eventSchedule(event, by) {
  const [start, end] = [await eventStartDate(event, by), await eventEndDate(event, by)];
  const location = event.timeZone ? "" : await eventLocation(event, by);
  const timeZone = event.timeZone || timeZoneForLocation(location);
  let until = null;
  if (end) until = timeZone ? endOfDayIn(end, timeZone) : new Date(end.getTime() + TIMING.noZoneGrace);
  let opensAt = null;
  if (start) opensAt = timeZone ? startOfDayIn(start, timeZone) : new Date(start.getTime() - TIMING.earliestZoneLead);
  return { start, end, location, timeZone: timeZone || null, opensAt, until };
}

/** The event's time zone, "America/Los_Angeles", or null when it is not known. Never throws. */
async function eventTimeZone(event) {
  try {
    return (await eventSchedule(event)).timeZone || null;
  } catch {
    return null;
  }
}

/** Whether the feedback form takes answers now, and when it opens. Open when the first day is not known. */
async function feedbackOpening(event) {
  const { opensAt, timeZone } = await eventSchedule(event);
  return { open: !opensAt || Date.now() >= opensAt.getTime(), opensAt, timeZone };
}

/** "2026-11-09" for a UTC midnight date, or null. */
function isoDay(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * What the admin panel shows about the event dates, the dates and where they came from, the times that follow from them,
 * when they were last read and when they are read again. Reads them when they have not been read yet.
 */
async function eventDatesInfo(event) {
  const schedule = await eventSchedule(event);
  const dates = cache.get(event.code);
  const place = locationCache.get(event.code);
  const readAts = [dates?.okAt, place?.okAt].filter(Boolean);
  const nextAts = [dates, place].filter(Boolean).map((entry) => entry.at + entry.ttl);
  const errors = [dates?.error, place?.error].filter(Boolean);
  return {
    start: isoDay(schedule.start),
    end: isoDay(schedule.end),
    time_zone: schedule.timeZone,
    location: schedule.location || null,
    // Where each value comes from, "setting" for events.json, "website" for the event website, null when not known.
    sources: {
      start: configuredDate(event.eventStartDate) ? "setting" : schedule.start ? "website" : null,
      end: configuredEndDate(event) ? "setting" : schedule.end ? "website" : null,
      time_zone: event.timeZone ? "setting" : schedule.timeZone ? "website" : null,
    },
    // The times that depend on the dates.
    form_opens_at: schedule.opensAt ? schedule.opensAt.toISOString() : null,
    sync_until: schedule.until ? schedule.until.toISOString() : null,
    report_due_at: schedule.until ? new Date(schedule.until.getTime() + 1).toISOString() : null,
    // Whether the event has a website to read the dates from at all.
    readable: Boolean(agendaApiUrl(event)),
    read_at: readAts.length ? new Date(Math.max(...readAts)).toISOString() : null,
    next_read_at: nextAts.length ? new Date(Math.min(...nextAts)).toISOString() : null,
    error: errors[0] || null,
  };
}

/**
 * Reads the dates and the location from the website again now, whatever the cache holds. The last dates read are kept when
 * the read fails. Called by the CRM sync, so the dates and the delegates are refreshed together, and by the admin
 * panel's Refresh now. Returns what eventDatesInfo does, and never throws.
 */
async function refreshEventDates(event, by = "refresh") {
  try {
    for (const map of [cache, locationCache]) {
      const entry = map.get(event.code);
      if (entry) entry.ttl = 0; // expired, the old value stays for a failed read
    }
    await eventSchedule(event, by);
    return await eventDatesInfo(event);
  } catch (err) {
    console.error(`${event.code}: event dates not refreshed, ${err.message}`);
    return { error: err.message };
  }
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
  eventDatesInfo,
  eventSchedule,
  eventStartDate,
  eventTimeZone,
  feedbackOpening,
  locationFromData,
  refreshEventDates,
  resetEventDates,
};
