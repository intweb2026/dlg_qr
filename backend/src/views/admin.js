const { parse } = require("csv-parse/sync");

const { query } = require("../db");
const m = require("../models");
const { escapeLike, padLengthFor, truthy } = require("../utils");
const v = require("../validation");

// ==================================================================
// Settings and submissions
// ==================================================================
const SETTINGS_FIELDS = {
  form_status: { clean: (value) => v.choice(value, ["active", "inactive"]) },
  // 0 means unlimited spins
  max_spin_attempts: { clean: (value) => v.integer(value, { min: 0, max: 4294967295 }) },
  // How long the lucky draw reels spin before stopping on the winning number
  spin_duration_seconds: { clean: (value) => v.integer(value, { min: 1, max: 60 }) },
};

async function getSettings(req, res) {
  res.json(m.settingsJson(await m.loadSettings()));
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
  res.json(m.settingsJson(await m.loadSettings()));
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

/** CSV upload. Header row: full_name, company_name, email (email optional). */
async function attendeeImport(req, res) {
  const upload = (req.files || []).find((f) => f.fieldname === "file");
  if (!upload) return res.status(400).json({ detail: "Choose a CSV file to import." });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(upload.buffer); // also drops a UTF-8 BOM
  } catch (err) {
    return res.status(400).json({ detail: "The file must be UTF-8 encoded CSV." });
  }
  let records;
  try {
    records = parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
  } catch (err) {
    return res.status(400).json({ detail: `The CSV file could not be read, ${err.message}` });
  }

  const headers = (records.shift() || []).map((h) => h.trim().toLowerCase());
  const nameKey = ["full_name", "attendee_name", "name"].find((k) => headers.includes(k));
  if (!nameKey) {
    return res.status(400).json({ detail: "CSV needs a full_name column (also accepted, attendee_name or name)." });
  }

  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const [index, cells] of records.entries()) {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] || "").trim();
    });
    const name = row[nameKey] || "";
    if (!name) {
      skipped += 1;
      continue;
    }
    const email = (row.email || "").toLowerCase() || null;
    const company = row.company_name || row.company || "";
    if (email && (await m.emailTaken(email))) {
      skipped += 1;
      continue;
    }
    try {
      await query(
        "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
        [name, email, company]
      );
      created += 1;
    } catch (err) {
      if (!err.sqlMessage) throw err;
      errors.push(`Line ${index + 2}, ${err.sqlMessage}`);
    }
  }
  res.json({ created, skipped, errors: errors.slice(0, 20) });
}

function bodyObject(req) {
  return v.isPlainObject(req.body) ? req.body : {};
}

module.exports = {
  getSettings,
  patchSettings,
  submissionList,
  submissionSuspend,
  attendeeList,
  attendeeCreate,
  attendeePatch,
  attendeeDelete,
  attendeeImport,
};
