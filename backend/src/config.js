const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function envList(name, fallback = "") {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || "8000"),
  debug: (process.env.DEBUG || "True").toLowerCase() === "true",
  allowedHosts: envList("ALLOWED_HOSTS", "localhost,127.0.0.1"),
  corsAllowedOrigins: envList(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
  ),
  // Logins for every event database, keyed by database name. Each event names its database in backend/events/<code>.json.
  databasesFile: process.env.DATABASES_FILE || path.join(__dirname, "..", "databases.json"),
};
