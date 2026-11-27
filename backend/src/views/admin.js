const crm = require("../crmDelegates");
const report = require("../feedbackReport");
const { query } = require("../db");
const { formState, stateJson } = require("../formOpening");
const { feedbackList } = require("../feedbackQuestions");
const m = require("../models");
const { escapeLike, padLengthFor, truthy } = require("../utils");
const v = require("../validation");

// ==================================================================
// Settings and submissions
// ==================================================================
/** 1 or 0 from true/false, 1/0 or "true"/"false". */
function cleanBoolean(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if ([1, "1", "true"].includes(value)) return 1;
  if ([0, "0", "false"].includes(value)) return 0;
  throw new v.FieldError("Must be a valid boolean.");
}

const SETTINGS_FIELDS = {
  // 0 means unlimited spins
  max_spin_attempts: { clean: (value) => v.integer(value, { min: 0, max: 4294967295 }) },
  // How long the lucky draw reels spin before stopping on the winning number
  spin_duration_seconds: { clean: (value) => v.integer(value, { min: 1, max: 60 }) },
  // On: the feedback form opens by itself when the event starts. Off: the form is open now, unless closed.
  form_open_auto: { clean: cleanBoolean },
  // On: an admin closed the form, it takes no answers whatever the date. Off: it follows form_open_auto.
  form_closed: { clean: cleanBoolean },
};

/** The settings, with when the feedback form opens and whether it is open now, for the admin page. */
async function settingsWithOpening(event) {
  const settings = m.settingsJson(await m.loadSettings());
  return { ...settings, ...stateJson(await formState(event, settings)) };
}

async function getSettings(req, res) {
  res.json(await settingsWithOpening(req.event));
}

async function patchSettings(req, res) {
  await m.loadSettings();
  const { values, errors } = await v.validate(bodyObject(req), SETTINGS_FIELDS, { partial: true });
  if (errors) throw new v.ValidationError(errors);
  const columns = Object.keys(values);
  await query(
    `UPDATE form_settings SET ${columns.map((c) => `${c} = ?, `).join("")}updated_at = UTC_TIMESTAMP(6) WHERE id = 1`,
    columns.map((c) => values[c])
  );
  res.json(await settingsWithOpening(req.event));
}

async function submissionList(req, res) {
  const where = [];
  const params = [];
  const q = String(req.query.q || "").trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    let filter =
      "a.full_name LIKE ? OR a.email LIKE ? OR a.company_name LIKE ? OR s.userAliesName LIKE ? OR s.userComapnyAliesName LIKE ?";
    params.push(like, like, like, like, like);
    if (/^\d+$/.test(q)) {
      filter += " OR s.id = ?";
      params.push(Number(q));
    }
    where.push(`(${filter})`);
  }
  const state = req.query.status;
  if (state === "active") where.push("s.is_suspended = 0");
  else if (state === "suspended") where.push("s.is_suspended = 1");
  const walkIn = req.query.walk_in;
  if (walkIn === "true" || walkIn === "false") where.push(`a.is_walk_in = ${walkIn === "true" ? 1 : 0}`);

  const rows = await query(
    `${m.SUBMISSION_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.id`,
    params
  );
  const [stats] = await query(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_suspended = 0), 0) AS active, COALESCE(SUM(is_suspended = 1), 0) AS suspended, " +
      "MAX(id) AS max_id FROM feedback_submissions"
  );
  res.json({
    results: rows.map(m.submissionJson),
    stats: { total: Number(stats.total), active: Number(stats.active), suspended: Number(stats.suspended) },
    pad_length: padLengthFor(stats.max_id),
  });
}

async function submissionSuspend(req, res) {
  const sub = await m.getSubmission(req.params.pk);
  if (!sub) return res.status(404).json({ detail: "Submission not found." });
  const body = bodyObject(req);
  const suspended = "is_suspended" in body ? truthy(body.is_suspended) : !sub.is_suspended;
  await query("UPDATE feedback_submissions SET is_suspended = ? WHERE id = ?", [suspended ? 1 : 0, sub.id]);
  res.json(m.submissionJson({ ...sub, is_suspended: suspended }));
}

/**
 * Who is interested in which upcoming conference, from the "Which of our upcoming conferences interest you?"
 * answers. One entry per conference, in the order first chosen, each with the attendees who ticked it. The name and
 * company are the ones the attendee gave on the form. Suspended submissions are left out.
 */
async function interestedAttendees(req, res) {
  const rows = await query(
    `${m.SUBMISSION_SELECT} WHERE s.is_suspended = 0 AND JSON_LENGTH(s.feedback_data, '$.upcoming_interest') > 0 ORDER BY s.id`
  );
  const events = new Map();
  for (const row of rows) {
    const { feedback_data: data, alias_name, company_alias_name, email } = m.submissionJson(row);
    const picked = Array.isArray(data?.upcoming_interest) ? data.upcoming_interest : [];
    for (const name of new Set(picked.filter((n) => typeof n === "string" && n.trim()))) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push({ attendeename: alias_name, companyname: company_alias_name, emailaddress: email });
    }
  }
  res.json({
    events: [...events].map(([event_name, attendees]) => ({ event_name, count: attendees.length, attendees })),
  });
}

/**
 * The submitted feedback answers, one entry per submission with who gave them. Suspended submissions are left out
 * unless ?include_suspended=true. A single submission can be fetched with ?id=<submission id>.
 */
async function feedbackResponsesPayload(event, { includeSuspended = false, id } = {}) {
  const where = [];
  const params = [];
  if (!includeSuspended) where.push("s.is_suspended = 0");
  if (id !== undefined) {
    where.push("s.id = ?");
    params.push(Number(id));
  }
  const rows = await query(
    `${m.SUBMISSION_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.id`,
    params
  );
  const results = rows.map((row) => {
    const s = m.submissionJson(row);
    return {
      submission_id: s.id,
      attendeename: s.alias_name,
      companyname: s.company_alias_name,
      emailaddress: s.email,
      is_suspended: s.is_suspended,
      submitted_at: s.created_at,
      feedback: feedbackList(s.feedback_data),
    };
  });
  // site is the website of the event the form belongs to, from "links.website" in events.json.
  return { site: event?.links?.website ?? null, count: results.length, results };
}

async function feedbackResponses(req, res) {
  if (req.query.id !== undefined && !/^\d+$/.test(String(req.query.id))) {
    return res.status(400).json({ detail: "id must be a number." });
  }
  res.json(
    await feedbackResponsesPayload(req.event, {
      includeSuspended: truthy(req.query.include_suspended),
      id: req.query.id,
    })
  );
}

// ==================================================================
// Attendees
// ==================================================================
function attendeeFields(exceptId = null) {
  return {
    full_name: { required: true, clean: (value) => v.string(value) },
    email: {
      async clean(value) {
        const email = v.email(value, { allowBlank: true, allowNull: true });
        if (email && (await m.emailTaken(email, exceptId))) {
          throw new v.FieldError("attendee with this email already exists.");
        }
        return email ? email.toLowerCase() : null;
      },
    },
    company_name: { default: "", clean: (value) => v.string(value, { allowBlank: true }) },
  };
}

async function attendeeList(req, res) {
  const where = [];
  const params = [];
  const q = String(req.query.q || "").trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      "(a.full_name LIKE ? OR a.email LIKE ? OR a.company_name LIKE ? OR s.userAliesName LIKE ? OR s.userComapnyAliesName LIKE ?)"
    );
    params.push(like, like, like, like, like);
  }
  const walkIn = req.query.walk_in; // true = added on the feedback form, false = from the list
  if (walkIn === "true" || walkIn === "false") where.push(`a.is_walk_in = ${walkIn === "true" ? 1 : 0}`);
  const rows = await query(
    `${m.ATTENDEE_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.full_name`,
    params
  );
  res.json(rows.map(m.attendeeJson));
}

async function attendeeCreate(req, res) {
  const { values, errors } = await v.validate(bodyObject(req), attendeeFields());
  if (errors) throw new v.ValidationError(errors);
  const result = await saveAttendee(() =>
    query(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
      [values.full_name, values.email ?? null, values.company_name]
    )
  );
  res.status(201).json(m.attendeeJson(await m.getAttendee(result.insertId)));
}

async function attendeePatch(req, res) {
  const attendee = await m.getAttendee(req.params.pk);
  if (!attendee) return res.status(404).json({ detail: "Attendee not found." });
  const { values, errors } = await v.validate(bodyObject(req), attendeeFields(attendee.attendee_id), { partial: true });
  if (errors) throw new v.ValidationError(errors);
  const columns = Object.keys(values);
  if (columns.length) {
    await saveAttendee(() =>
      query(`UPDATE attendees SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE attendee_id = ?`, [
        ...columns.map((c) => values[c]),
        attendee.attendee_id,
      ])
    );
  }
  res.json(m.attendeeJson(await m.getAttendee(attendee.attendee_id)));
}

async function attendeeDelete(req, res) {
  const attendee = await m.getAttendee(req.params.pk);
  if (!attendee) return res.status(404).json({ detail: "Attendee not found." });
  if (attendee.has_submitted) {
    return res.status(400).json({ detail: "This attendee has a feedback submission, suspend it instead of deleting." });
  }
  await query("DELETE FROM attendees WHERE attendee_id = ?", [attendee.attendee_id]);
  res.status(204).end();
}

/** Runs an insert or update, a duplicate email from a request that raced this one is reported like the field check. */
async function saveAttendee(write) {
  try {
    return await write();
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new v.ValidationError({ email: ["attendee with this email already exists."] });
    throw err;
  }
}

/** The CRM sync's state, shown on the admin Attendees page. */
async function attendeeSyncStatus(req, res) {
  res.json(await crm.syncStatus(req.event));
}

// ==================================================================
// Feedback submissions report, the PDF emailed the day after the event ends
// ==================================================================
async function feedbackReportStatus(req, res) {
  res.json(await report.reportStatus(req.event));
}

/** The PDF itself, so an admin can check it or keep a copy. */
async function feedbackReportPdf(req, res) {
  const { pdf } = await report.buildReportPdf(req.event);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${report.reportFileName(req.event)}"`,
    "Content-Length": pdf.length,
  });
  res.end(pdf);
}

/** Send now, the backup when the automatic email did not go out, or to send it again. */
async function feedbackReportSend(req, res) {
  try {
    const count = await report.emailReport(req.event);
    return res.json({ ...(await report.reportStatus(req.event)), sent: count });
  } catch (err) {
    console.error(`${req.event.code}: feedback report not sent, ${err.message}`);
    return res.status(502).json({ ...(await report.reportStatus(req.event)), detail: `The report was not sent, ${err.message}` });
  }
}

/** Fetches the registered delegates from the CRM now, the admin page's Sync now button. */
async function attendeeSync(req, res) {
  try {
    const result = await crm.syncDelegates(req.event);
    return res.json({ ...(await crm.syncStatus(req.event)), result });
  } catch (err) {
    if (!(err instanceof crm.CrmSyncError)) throw err;
    return res.status(502).json({ ...(await crm.syncStatus(req.event)), detail: err.message });
  }
}

function bodyObject(req) {
  return v.isPlainObject(req.body) ? req.body : {};
}

module.exports = {
  getSettings,
  patchSettings,
  submissionList,
  submissionSuspend,
  interestedAttendees,
  feedbackResponses,
  feedbackResponsesPayload,
  attendeeList,
  attendeeCreate,
  attendeePatch,
  attendeeDelete,
  attendeeSync,
  attendeeSyncStatus,
  feedbackReportStatus,
  feedbackReportPdf,
  feedbackReportSend,
};
