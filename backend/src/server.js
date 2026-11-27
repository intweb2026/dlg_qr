const { createApp } = require("./app");
const config = require("./config");
const { closeAll, hasLogin, loginFor, query, withDatabase } = require("./db");
const { allEvents } = require("./events");
const { startReportTimer } = require("./feedbackReport");

// Stop at once when an active event has no database login, instead of failing on its first request.
const missing = allEvents().filter((e) => e.active && !hasLogin(e.database));
if (missing.length) {
  console.error(`No login in ${config.databasesJson ? "DATABASES_JSON" : config.databasesFile} for: ${missing.map((e) => `${e.database} (${e.code})`).join(", ")}`);
  process.exit(1);
}

// A deployment signs every admin out, the sessions are kept in each event's database and would otherwise survive it.
// Switch it off with security.endAdminSessionsOnStart in config.js.
async function endAdminSessions() {
  if (!config.security.endAdminSessionsOnStart) return;
  for (const e of allEvents()) {
    if (!hasLogin(e.database)) continue;
    try {
      await withDatabase(e.database, () => query("DELETE FROM admin_tokens"));
    } catch (err) {
      console.error(`${e.code}: admin sessions were not ended, ${err.message}`);
    }
  }
}

const server = createApp().listen(config.port, () => {
  console.log(`Feedback API listening on port ${config.port}, /api/events/<code>`);
  for (const e of allEvents()) {
    const where = hasLogin(e.database) ? ` on ${loginFor(e.database).host}` : ", no login";
    console.log(`  ${e.code} -> database ${e.database}${where}${e.active ? "" : " (inactive)"}`);
  }
});

endAdminSessions();

// Emails each event's feedback submissions PDF the day after it ends, looked for every hour.
startReportTimer();

function shutdown() {
  server.close(() => closeAll().finally(() => process.exit(0)));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
