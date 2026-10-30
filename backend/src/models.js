const { query } = require("./db");
const { isoDate, maskEmail } = require("./utils");

// Queries and response shapes for each table, the Node side of the old models.py and serializers.py.

// ------------------------------------------------------------------ Form settings, a single row with id 1
const SETTINGS_DEFAULTS = { form_status: "active", max_spin_attempts: 0, spin_duration_seconds: 5 };

async function loadSettings() {
  let [row] = await query("SELECT * FROM form_settings WHERE id = 1");
  if (!row) {
    await query(
      "INSERT IGNORE INTO form_settings (id, form_status, max_spin_attempts, spin_duration_seconds, updated_at) " +
        "VALUES (1, ?, ?, ?, UTC_TIMESTAMP(6))",
      [SETTINGS_DEFAULTS.form_status, SETTINGS_DEFAULTS.max_spin_attempts, SETTINGS_DEFAULTS.spin_duration_seconds]
    );
    [row] = await query("SELECT * FROM form_settings WHERE id = 1");
  }
  return row;
}

function isActive(settings) {
  return settings.form_status === "active";
}

function settingsJson(row) {
  return {
    form_status: row.form_status,
    max_spin_attempts: row.max_spin_attempts,
    spin_duration_seconds: row.spin_duration_seconds,
    updated_at: isoDate(row.updated_at),
  };
}

// The name and company confirmed on the form, used for the lucky draw. Submissions saved before
// the alias columns existed have them blank and fall back to the attendee list.
const ALIAS_NAME = "COALESCE(NULLIF(s.userAliesName, ''), a.full_name)";
const ALIAS_COMPANY = "COALESCE(NULLIF(s.userComapnyAliesName, ''), a.company_name)";

// ------------------------------------------------------------------ Attendees
// The alias is null until the attendee submits.
const ATTENDEE_SELECT = `
  SELECT a.attendee_id, a.full_name, a.email, a.company_name, a.is_walk_in, a.created_at,
         s.id IS NOT NULL AS has_submitted,
         IF(s.id IS NULL, NULL, ${ALIAS_NAME}) AS alias_name,
         IF(s.id IS NULL, NULL, ${ALIAS_COMPANY}) AS company_alias_name
  FROM attendees a
  LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id`;

async function getAttendee(id) {
  const [row] = await query(`${ATTENDEE_SELECT} WHERE a.attendee_id = ?`, [id]);
  return row || null;
}

/** Email is unique on the attendee list, compared without case as MySQL does. */
async function emailTaken(email, exceptId = null) {
  const rows = await query("SELECT 1 FROM attendees WHERE email = ? AND attendee_id <> ? LIMIT 1", [email, exceptId ?? -1]);
  return rows.length > 0;
}

function attendeeJson(row) {
  return {
    attendee_id: row.attendee_id,
    full_name: row.full_name,
    email: row.email,
    company_name: row.company_name,
    is_walk_in: Boolean(row.is_walk_in),
    has_submitted: Boolean(row.has_submitted),
    alias_name: row.alias_name ?? null,
    company_alias_name: row.company_alias_name ?? null,
    created_at: isoDate(row.created_at),
  };
}

/** Public, minimal shape loaded with the feedback form for the name lookup. */
function attendeeLookupJson(row) {
  return {
    attendee_id: row.attendee_id,
    full_name: row.full_name,
    company_name: row.company_name,
    email: maskEmail(row.email),
  };
}

// ------------------------------------------------------------------ Feedback submissions
const SUBMISSION_SELECT = `
  SELECT s.id, s.attendee_id, a.full_name AS attendee_name, a.email, a.company_name, a.is_walk_in,
         ${ALIAS_NAME} AS alias_name, ${ALIAS_COMPANY} AS company_alias_name,
         s.feedback_data, s.is_suspended, s.device_fingerprint, s.created_at
  FROM feedback_submissions s
  JOIN attendees a ON a.attendee_id = s.attendee_id`;

async function getSubmission(id) {
  const [row] = await query(`${SUBMISSION_SELECT} WHERE s.id = ?`, [id]);
  return row || null;
}

async function maxSubmissionId() {
  const [row] = await query("SELECT MAX(id) AS m FROM feedback_submissions");
  return row.m || 0;
}

function submissionJson(row) {
  return {
    id: row.id,
    attendee_id: row.attendee_id,
    attendee_name: row.attendee_name,
    email: row.email,
    company_name: row.company_name,
    is_walk_in: Boolean(row.is_walk_in),
    feedback_data: typeof row.feedback_data === "string" ? JSON.parse(row.feedback_data) : row.feedback_data,
    alias_name: row.alias_name,
    company_alias_name: row.company_alias_name,
    is_suspended: Boolean(row.is_suspended),
    device_fingerprint: row.device_fingerprint,
    created_at: isoDate(row.created_at),
  };
}

// ------------------------------------------------------------------ Lucky draw
/** Active entries that have not already won a finished draw. Clearing the winner history puts winners back. */
const ELIGIBLE_WHERE = `s.is_suspended = 0
  AND NOT EXISTS (SELECT 1 FROM lucky_draw_winners w WHERE w.submission_id = s.id)`;

async function eligibleIds() {
  const rows = await query(`SELECT s.id FROM feedback_submissions s WHERE ${ELIGIBLE_WHERE} ORDER BY s.id`);
  return rows.map((r) => r.id);
}

async function isEligible(id) {
  const rows = await query(`SELECT 1 FROM feedback_submissions s WHERE s.id = ? AND ${ELIGIBLE_WHERE}`, [id]);
  return rows.length > 0;
}

// Winners are shown by the alias the attendee confirmed, the list name stays off the public draw.
const WINNER_SELECT = `
  SELECT w.id, w.submission_id, ${ALIAS_NAME} AS attendee_name, ${ALIAS_COMPANY} AS company_name, a.email,
         w.attempt_number, u.username AS drawn_by, w.drawn_at
  FROM lucky_draw_winners w
  JOIN feedback_submissions s ON s.id = w.submission_id
  JOIN attendees a ON a.attendee_id = s.attendee_id
  LEFT JOIN admin_users u ON u.id = w.drawn_by_id`;

function winnerJson(row) {
  return {
    id: row.id,
    submission_id: row.submission_id,
    attendee_name: row.attendee_name,
    company_name: row.company_name,
    email: row.email,
    attempt_number: row.attempt_number,
    drawn_by: row.drawn_by ?? null,
    drawn_at: isoDate(row.drawn_at),
  };
}

module.exports = {
  SETTINGS_DEFAULTS,
  loadSettings,
  isActive,
  settingsJson,
  ALIAS_NAME,
  ALIAS_COMPANY,
  ATTENDEE_SELECT,
  getAttendee,
  emailTaken,
  attendeeJson,
  attendeeLookupJson,
  SUBMISSION_SELECT,
  getSubmission,
  maxSubmissionId,
  submissionJson,
  eligibleIds,
  isEligible,
  WINNER_SELECT,
  winnerJson,
};
