const { feedbackOpening } = require("./eventDates");
const { loadSettings, settingsJson } = require("./models");

/**
 * Whether the feedback form takes answers now, as { open, closed, opensAt, timeZone }.
 * 1. An admin closed it (form_closed): closed, whatever the date.
 * 2. Automatic opening on (form_open_auto): open from 12:00 AM of the event's first day where it is held.
 * 3. Otherwise open, with no condition.
 * When anything cannot be worked out, the settings or the opening time, the form is open, so a failing website or
 * database never keeps it shut. Runs inside the event's database.
 */
async function formState(event, settings) {
  const OPEN = { open: true, closed: false, opensAt: null, timeZone: null };
  let s;
  try {
    s = settings || settingsJson(await loadSettings());
  } catch (err) {
    console.error(`${event.code}: form settings not read, the form is open, ${err.message}`);
    return OPEN;
  }
  if (s.form_closed) return { open: false, closed: true, opensAt: null, timeZone: null };
  if (!s.form_open_auto) return OPEN;
  try {
    const { open, opensAt, timeZone } = await feedbackOpening(event);
    return { open, closed: false, opensAt, timeZone };
  } catch (err) {
    console.error(`${event.code}: feedback opening time not known, the form is open, ${err.message}`);
    return OPEN;
  }
}

/** The 403 body when the form does not take answers: closed by an admin, or not open yet with its opening time. */
function notOpenJson(state) {
  if (state.closed) return { detail: "The feedback form is closed.", code: "closed" };
  return {
    detail: "The feedback form opens when the event starts.",
    code: "not_open",
    opens_at: state.opensAt ? state.opensAt.toISOString() : null,
    time_zone: state.timeZone,
  };
}

/** The fields the site and the admin page read. */
function stateJson(state) {
  return {
    feedback_open: state.open,
    feedback_closed: state.closed,
    feedback_opens_at: state.opensAt ? state.opensAt.toISOString() : null,
    time_zone: state.timeZone || null,
  };
}

module.exports = { formState, notOpenJson, stateJson };
