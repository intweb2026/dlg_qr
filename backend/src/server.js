const { createApp } = require("./app");
const config = require("./config");
const { pool } = require("./db");

const server = createApp().listen(config.port, () => {
  console.log(`Feedback API listening on http://localhost:${config.port}/api`);
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
