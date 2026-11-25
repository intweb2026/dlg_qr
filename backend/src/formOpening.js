const { feedbackOpening } = require("./eventDates");
const { loadSettings, settingsJson } = require("./models");

/**
 * When the feedback form opens, or null when it is open with no condition. That is when the admin turned the
 * automatic opening off (form_open_auto), and also when the opening time cannot be worked out for any reason,
 * so a failing website or database never keeps the form shut. Runs inside the event's database.
 */
async function openingFor(event, settings) {
  try {
    const { form_open_auto: auto } = settings || settingsJson(await loadSettings());
    if (!auto) return null;
    return await feedbackOpening(event);
  } catch (err) {
    console.error(`${event.code}: feedback opening time not known, the form is open, ${err.message}`);
    return null;
  }
}

module.exports = { openingFor };
