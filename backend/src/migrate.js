const fs = require("fs");
const path = require("path");

const { query, serverConnection, withDatabase } = require("./db");
const { loadSettings } = require("./models");
const { makePassword } = require("./passwords");

const SCHEMA = path.join(__dirname, "..", "db", "schema.sql");

// Created in every new event database, the same accounts the Django migration added. Change the passwords before the event.
const DEFAULT_ADMINS = [
  ["benny", "benny123", "Benny"],
  ["maxwell", "maxwell123", "Maxwell"],
  ["nolan", "nolan123", "Nolan"],
  ["ramon", "ramon123", "Ramon"],
];

/**
 * Creates the event's database when it does not exist, then any missing tables, the form settings row
 * and the default admin accounts. Safe to run again.
 */
async function migrate(event, { log = () => {} } = {}) {
  const conn = await serverConnection(event.database);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${event.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await conn.end();
  }

  await withDatabase(event.database, async () => {
    const sql = fs.readFileSync(SCHEMA, "utf8").replace(/^\s*--.*$/gm, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await query(statement);
    }
    log(`${event.code}: tables in ${event.database} are up to date.`);

    await loadSettings();
    for (const [username, password, fullName] of DEFAULT_ADMINS) {
      const exists = await query("SELECT 1 FROM admin_users WHERE username = ?", [username]);
      if (exists.length) continue;
      await query(
        "INSERT INTO admin_users (username, password, full_name, is_active, created_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(6))",
        [username, await makePassword(password), fullName]
      );
      log(`${event.code}: created admin user ${username}.`);
    }
  });
}

module.exports = { migrate, DEFAULT_ADMINS };
