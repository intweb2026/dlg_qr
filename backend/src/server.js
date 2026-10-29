const { createApp } = require("./app");
const config = require("./config");
const { closeAll, hasLogin, loginFor } = require("./db");
const { allEvents } = require("./events");

// Stop at once when an active event has no database login, instead of failing on its first request.
const missing = allEvents().filter((e) => e.active && !hasLogin(e.database));
if (missing.length) {
  console.error(`No login in ${config.databasesFile} for: ${missing.map((e) => `${e.database} (${e.code})`).join(", ")}`);
  process.exit(1);
}

const server = createApp().listen(config.port, () => {
  console.log(`Feedback API listening on http://localhost:${config.port}/api/events/<code>`);
  for (const e of allEvents()) {
    const where = hasLogin(e.database) ? ` on ${loginFor(e.database).host}` : ", no login";
    console.log(`  ${e.code} -> database ${e.database}${where}${e.active ? "" : " (inactive)"}`);
  }
});

function shutdown() {
  server.close(() => closeAll().finally(() => process.exit(0)));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
