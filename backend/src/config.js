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
 * comma separated. Without it, the team accounts below are made. migrate.js reads this list, there is no other copy. Change their passwords before the event.
 */
function defaultAdmins() {
  const raw = process.env.DEFAULT_ADMINS;
  if (!raw || !raw.trim()) {
    return [
      ["benny", "Benny_iqHub", "Benny"],
      ["maxwell", "Maxwell_iqHub", "Maxwell"],
      ["parker", "Parker_iqHub", "Parker"],
      ["ramon", "Ramon_iqHub", "Ramon"],
    ];
  }
  return raw
    .split(",")
    .map((entry) => entry.split(":").map((part) => part.trim()))
    .filter(([username, password]) => username && password)
    .map(([username, password, ...name]) => [username, password, name.join(":") || username]);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Timings and cache lengths, in milliseconds. They are tuning values, not secrets or per-server settings, so they
 * live here in one place and are not read from the environment.
 */
// Admin sign in and session protection. The durations are in milliseconds.
const security = {
  adminSessionLifetime: 12 * HOUR, // an admin is signed out this long after signing in, however busy they are
  endAdminSessionsOnStart: true, // every admin session is ended when the server starts, so a deployment signs everyone out
  loginMaxFailures: 5, // wrong passwords for one name from one address before it is locked
  loginMaxFailuresPerIp: 20, // wrong passwords from one address, whatever the names, before it is locked
  loginWindow: 15 * MINUTE, // the failures are counted over this long
  loginLockout: 15 * MINUTE, // how long a locked sign in has to wait
};

const timing = {
  // The CRM registered delegates sync, see crmDelegates.js.
  crmSync: {
    requestTimeout: 20 * SECOND, // one request to the CRM
    firstSyncRetry: MINUTE, // until the first sync works, visitors try again at most this often
    refreshAfter: DAY, // after the first sync, the list is fetched again once the last sync is this old
    refreshRetry: HOUR, // a daily sync that failed is tried again after this long
    dueCheck: 5 * MINUTE, // visits check whether a daily sync is due at most this often
  },
  // The event website's agenda and location, see eventDates.js.
  eventDates: {
    requestTimeout: 5 * SECOND,
    cache: 6 * HOUR, // a good answer is reused this long
    failureCache: 10 * MINUTE, // a failed or empty answer is reused this long
    noZoneGrace: 36 * HOUR, // without a time zone, the last day is over everywhere this long after it starts in UTC
    earliestZoneLead: 14 * HOUR, // without a time zone, the first day starts this long before it starts in UTC (UTC+14)
  },
  // The feedback submissions PDF, see feedbackReport.js.
  feedbackReport: {
    check: HOUR, // how often the server looks for a report that is due
    firstCheck: MINUTE, // the first look, after the server starts
    autoWindow: 7 * DAY, // a report is sent by itself only within this long of its time
  },
  // Uploaded media, see uploads.js.
  uploads: {
    orphanGrace: HOUR, // a file nothing holds is deleted once it is this old, so an upload waiting to be saved is kept
  },
  // The speaker sessions read from the agenda API, see views/speakerSessions.js.
  speakerSessions: {
    requestTimeout: 5 * SECOND,
    cache: 10 * MINUTE,
    failureCache: MINUTE,
  },
};

module.exports = {
  timing,
  security,
  // How many proxies sit in front of the API, such as the one Coolify runs, so the visitor's real address is read from
  // X-Forwarded-For. 0 when the API is reached directly. Set it right, the sign in lockout and the rate limit use it.
  trustProxy: Number.parseInt(process.env.TRUST_PROXY ?? "1", 10),
  port: Number(process.env.PORT || "8000"),
  debug: (process.env.DEBUG || "True").toLowerCase() === "true",
  // No default. In production set it to the API's own host name. With DEBUG on and nothing set, localhost is allowed.
  allowedHosts: envList("ALLOWED_HOSTS"),
  // No default. The address of the site that calls this API, for example https://events.your-domain.com.
  corsAllowedOrigins: envList("CORS_ALLOWED_ORIGINS"),
  // One bearer token for the CRM export routes, the same for every event. Empty leaves those routes switched off.
  // A comma separated list is accepted so a new value can be added before the old one is removed.
  exportAccessTokens: envList("EXPORT_ACCESS_TOKEN"),
  // The CRM webhook that receives the feedback responses when the lucky draw starts, and the key it expects.
  sendFeedbackSubmissionToCrm: (process.env.SEND_FEEDBACK_SUBMISSION_TO_CRM || "false").toLowerCase() === "true",
  crmWebhookUrl: process.env.CRM_WEBHOOK_URL || "",
  crmApiKey: process.env.CRM_API_KEY || "",
  // The CRM's registered delegates API, read with the X-DATA-API-KEY header. Each event names its CRM event code as
  // "event_code" in events.json. Without a key the attendee list is left as it is in the database.
  crmDataApiUrl: process.env.CRM_DATA_API_URL || "https://www.app.iq-hub.com/api/data/registered_delegates/",
  crmDataApiKey: process.env.CRM_DATA_API_KEY || "",
  // Logins for every event database, keyed by database name. Each event names its database in backend/events.json.
  // DATABASES_JSON holds the same logins as the file, as one line of JSON, for a host where only the environment can be set.
  // It wins over the file when both exist.
  databasesJson: process.env.DATABASES_JSON || "",
  databasesFile: process.env.DATABASES_FILE || path.join(__dirname, "..", "databases.json"),
  // Images and videos uploaded on the admin Event Details page, one folder per event, served at /api/uploads/.
  // Keep it on a disk that survives a redeploy.
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads")),
  // The feedback submissions PDF, emailed the day after each event ends. Without SMTP_HOST it is not emailed, an
  // admin can still download it. FEEDBACK_REPORT_TO takes a comma separated list and has no default, set it in the
  // environment. Left empty, the report is not emailed.
  feedbackReportTo: envList("FEEDBACK_REPORT_TO"),
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
