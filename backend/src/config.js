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
  // One bearer token for the CRM export routes, the same for every event. Empty leaves those routes switched off.
  // A comma separated list is accepted so a new value can be added before the old one is removed.
  exportAccessTokens: envList("EXPORT_ACCESS_TOKEN"),
  // The CRM webhook that receives the feedback responses when the lucky draw starts, and the key it expects.
  // The first feedback submission number after a new attendee list is imported, a whole number from 1 to 99.
  feedbackStartNumber: Number.parseInt(process.env.FEEDBACK_START_NUMBER || "1", 10),
  sendFeedbackSubmissionToCrm: (process.env.SEND_FEEDBACK_SUBMISSION_TO_CRM || "false").toLowerCase() === "true",
  crmWebhookUrl: process.env.CRM_WEBHOOK_URL || "",
  crmApiKey: process.env.CRM_API_KEY || "",
  // Logins for every event database, keyed by database name. Each event names its database in backend/events.json.
  databasesFile: process.env.DATABASES_FILE || path.join(__dirname, "..", "databases.json"),
};
