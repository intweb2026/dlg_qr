const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// The old Django names (DJANGO_DEBUG, DJANGO_ALLOWED_HOSTS) are still read, so an existing .env keeps working.
function env(names, fallback = "") {
  for (const name of [].concat(names)) {
    if (process.env[name] !== undefined) return process.env[name];
  }
  return fallback;
}

function envList(names, fallback = "") {
  return env(names, fallback)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const debug = env(["DEBUG", "DJANGO_DEBUG"], "True").toLowerCase() === "true";

module.exports = {
  port: Number(env("PORT", "8000")),
  debug,
  allowedHosts: envList(["ALLOWED_HOSTS", "DJANGO_ALLOWED_HOSTS"], "localhost,127.0.0.1"),
  corsAllowedOrigins: envList(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
  ),
  db: {
    database: env("DB_NAME", "feedback_db"),
    user: env("DB_USER", "root"),
    password: env("DB_PASSWORD", ""),
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", "3306")),
  },
};
