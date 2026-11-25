const fs = require("fs");
const path = require("path");

const { query, serverConnection, withDatabase } = require("./db");
const { loadDetailsRow, moveLinksIntoMenu } = require("./eventDetails");
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

// [table, column, definition, after], kept the same as db/schema.sql.
const ADDED_COLUMNS = [
  ["feedback_submissions", "userAliesName", "varchar(255) NOT NULL DEFAULT ''", "feedback_data"],
  ["feedback_submissions", "userComapnyAliesName", "varchar(255) NOT NULL DEFAULT ''", "userAliesName"],
  ["form_settings", "crm_synced_at", "datetime(6) DEFAULT NULL", "spin_duration_seconds"],
  ["form_settings", "crm_synced_count", "int unsigned DEFAULT NULL", "crm_synced_at"],
  ["form_settings", "form_open_auto", "tinyint(1) NOT NULL DEFAULT 1", "crm_synced_count"],
  ["form_settings", "report_sent_at", "datetime(6) DEFAULT NULL", "form_open_auto"],
  ["form_settings", "report_sent_count", "int unsigned DEFAULT NULL", "report_sent_at"],
];

// [table, column] no longer used, dropped from databases made before they were removed from db/schema.sql.
const DROPPED_COLUMNS = [["event_details", "venue_name"]];

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
    // Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves older tables as they are.
    for (const [table, column, definition, after] of ADDED_COLUMNS) {
      const found = await query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        [table, column]
      );
      if (found.length) continue;
      await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition} AFTER \`${after}\``);
      log(`${event.code}: added ${table}.${column}.`);
    }
    for (const [table, column] of DROPPED_COLUMNS) {
      const found = await query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        [table, column]
      );
      if (!found.length) continue;
      await query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
      log(`${event.code}: dropped ${table}.${column}.`);
    }
    // Submissions from before the alias existed take the name and company on the attendee list.
    const filled = await query(
      `UPDATE feedback_submissions s JOIN attendees a ON a.attendee_id = s.attendee_id
       SET s.userAliesName = IF(s.userAliesName = '', a.full_name, s.userAliesName),
           s.userComapnyAliesName = IF(s.userComapnyAliesName = '', a.company_name, s.userComapnyAliesName)
       WHERE s.userAliesName = '' OR s.userComapnyAliesName = ''`
    );
    if (filled.affectedRows) log(`${event.code}: filled the alias on ${filled.affectedRows} older submissions.`);
    log(`${event.code}: tables in ${event.database} are up to date.`);

    await loadSettings();
    // The Event Details row and the default menu, copied from events.json the first time.
    await moveLinksIntoMenu({ log: (message) => log(`${event.code}: ${message}`) });
    await loadDetailsRow(event);
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
