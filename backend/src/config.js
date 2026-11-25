const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function envList(name, fallback = "") {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Admin accounts made in every new event database, from DEFAULT_ADMINS as "username:password:Full Name" entries,
 * comma separated. Without it, the four team accounts below are made. Change their passwords before the event.
 */
function defaultAdmins() {
  const raw = process.env.DEFAULT_ADMINS;
  if (!raw || !raw.trim()) {
    return [
      ["benny", "benny123", "Benny"],
      ["maxwell", "maxwell123", "Maxwell"],
      ["nolan", "nolan123", "Nolan"],
      ["ramon", "ramon123", "Ramon"],
    ];
  }
  return raw
    .split(",")
    .map((entry) => entry.split(":").map((part) => part.trim()))
    .filter(([username, password]) => username && password)
    .map(([username, password, ...name]) => [username, password, name.join(":") || username]);
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
  // The CRM's registered delegates API, read with the X-DATA-API-KEY header. Each event names its CRM event code as
  // "event_code" in events.json. Without a key the attendee list is left as it is in the database.
  crmDataApiUrl: process.env.CRM_DATA_API_URL || "https://www.app.iq-hub.com/api/data/registered_delegates/",
  crmDataApiKey: process.env.CRM_DATA_API_KEY || "",
  // Logins for every event database, keyed by database name. Each event names its database in backend/events.json.
  databasesFile: process.env.DATABASES_FILE || path.join(__dirname, "..", "databases.json"),
  // Images and videos uploaded on the admin Event Details page, one folder per event, served at /api/uploads/.
  // Keep it on a disk that survives a redeploy.
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads")),
  // The feedback submissions PDF, emailed the day after each event ends. Without SMTP_HOST it is not emailed, an
  // admin can still download it. FEEDBACK_REPORT_TO takes a comma separated list.
  feedbackReportTo: envList("FEEDBACK_REPORT_TO", "linq-web@iq-hub.com"),
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || "587"),
  smtpSecure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || "",
  defaultAdmins: defaultAdmins(),
  // Gemini writes the suggested testimonial (Polish). The model is tried first; when it is busy, the backup models
  // in views/testimonial.js are tried. Without a key the form keeps the attendee's own words.
  geminiApiKey: (process.env.GEMINI_API_KEY || "").trim(),
  geminiModel: (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim(),
  geminiApiUrl: (process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta/models").replace(/\/+$/, ""),
};
