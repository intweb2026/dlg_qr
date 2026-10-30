const { query, transaction } = require("../db");
const { publicConfig } = require("../events");
const { ALIAS_COMPANY, ALIAS_NAME, attendeeLookupJson, getAttendee, isActive, loadSettings } = require("../models");
const { collapseSpaces, deviceFingerprint, normalizeName } = require("../utils");
const v = require("../validation");

const CLOSED = { detail: "Event feedback is closed." };
const ALREADY_SUBMITTED = { detail: "Feedback has already been submitted for this attendee.", code: "already_submitted" };

/** The event's settings for the site, its name, media, links and Wi-Fi. */
function eventConfig(req, res) {
  res.json(publicConfig(req.event));
}

async function formStatus(req, res) {
  const cfg = await loadSettings();
  res.json({ form_status: cfg.form_status, is_active: isActive(cfg) });
}

/** Full lookup list, loaded once with the feedback form. The browser filters it after 3 typed characters. */
async function attendeeList(req, res) {
  if (!isActive(await loadSettings())) return res.status(403).json(CLOSED);
  // Hide people who already submitted.
  const rows = await query(
    `SELECT a.attendee_id, a.full_name, a.company_name, a.email
     FROM attendees a LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id
     WHERE s.id IS NULL ORDER BY a.full_name`
  );
  return res.json(rows.map(attendeeLookupJson));
}

/**
 * The Registered Attendees page. Name and company only, walk-ins added on the feedback form are left out.
 * Attendees who submitted are shown by the alias they confirmed, the others by the name on the list.
 */
async function registeredAttendees(req, res) {
  const rows = await query(
    `SELECT IF(s.id IS NULL, a.full_name, ${ALIAS_NAME}) AS name, IF(s.id IS NULL, a.company_name, ${ALIAS_COMPANY}) AS company
     FROM attendees a LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id
     WHERE a.is_walk_in = 0 ORDER BY company, name`
  );
  return res.json(rows.map((a) => ({ name: a.name, company: a.company })));
}

// A name typed on the form that is not on the attendee list. Company is required, it tells apart people with the same name.
const NEW_ATTENDEE_FIELDS = {
  full_name: {
    required: true,
    clean(value) {
      const name = collapseSpaces(v.string(value));
      if (Array.from(name).length < 3) throw new v.FieldError("Enter your full name.");
      return name;
    },
  },
  company_name: {
    required: true,
    requiredMessage: "Enter your company name.",
    clean(value) {
      const company = collapseSpaces(v.string(value, { blankMessage: "Enter your company name." }));
      if (Array.from(company).length < 2) throw new v.FieldError("Enter your company name.");
      return company;
    },
  },
  email: {
    default: null,
    clean: (value) => v.email(value, { allowBlank: true, allowNull: true })?.toLowerCase() || null,
  },
};

// Send attendee_id for a listed attendee, or new_attendee for a name that is not on the list.
const SUBMIT_FIELDS = {
  attendee_id: {
    async clean(value) {
      const attendee = await getAttendee(v.integer(value));
      if (!attendee) throw new v.FieldError("Select your name from the attendee list.");
      return attendee;
    },
  },
  new_attendee: { clean: (value) => v.nested(value, NEW_ATTENDEE_FIELDS) },
  // Name and company from the Your Display Name popup, saved as given even when not edited.
  alias_name: { clean: (value) => collapseSpaces(v.string(value, { allowBlank: true })) },
  company_alias_name: { clean: (value) => collapseSpaces(v.string(value, { allowBlank: true })) },
  feedback_data: {
    required: true,
    clean(value) {
      v.dict(value, { allowEmpty: false });
      if (JSON.stringify(value).length > 20000) throw new v.FieldError("Feedback is too long.");
      return value;
    },
  },
};

async function feedbackSubmit(req, res) {
  // 1. Status check
  if (!isActive(await loadSettings())) return res.status(403).json(CLOSED);

  // 2. The one entry per device check is done by the form, with a cookie and localStorage on its own site.
  // A cookie set here would live on the API domain, which clearing the form site's cookies does not remove.

  const data = req.body ?? {};
  if (!v.isPlainObject(data)) {
    throw new v.ValidationError({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${v.pyTypeName(data)}.`] });
  }
  const { values, errors } = await v.validate(data, SUBMIT_FIELDS);
  if (errors) throw new v.ValidationError(errors);
  if (("attendee_id" in values) === ("new_attendee" in values)) {
    throw new v.ValidationError({ attendee_id: ["Select your name from the list, or add it as a new attendee."] });
  }
  let attendee = values.attendee_id;
  const newAttendee = values.new_attendee;

  // 3. A new name and company pair must not already be on the list, compared without case, accents or extra
  //    spaces. The same name from another company is a different person and is allowed.
  if (newAttendee) {
    const wanted = `${normalizeName(newAttendee.full_name)}|${normalizeName(newAttendee.company_name)}`;
    const rows = await query(
      `SELECT a.full_name, a.company_name, s.id IS NOT NULL AS has_submitted
       FROM attendees a LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id`
    );
    const existing = rows.find((a) => `${normalizeName(a.full_name)}|${normalizeName(a.company_name)}` === wanted);
    if (existing && existing.has_submitted) {
      return res.status(400).json({
        detail: "Feedback has already been submitted for this name and company. If that was not you, ask the registration desk.",
        code: "already_submitted",
      });
    }
    if (existing) {
      return res.status(400).json({
        detail: "This name and company are already on the attendee list, select your name from the list.",
        code: "attendee_exists",
      });
    }
    // Email is optional, but unique on the attendee list.
    if (newAttendee.email && (await query("SELECT 1 FROM attendees WHERE email = ? LIMIT 1", [newAttendee.email])).length) {
      return res.status(400).json({
        detail: "This email is already on the attendee list. Select your name from the list, or use another email.",
        code: "email_exists",
      });
    }
  }

  // 4. Duplicate check + save
  if (attendee && attendee.has_submitted) return res.status(400).json(ALREADY_SUBMITTED);
  // An older page that sends no alias keeps the name and company as they are on the list.
  const who = attendee || newAttendee;
  const aliasName = values.alias_name || who.full_name;
  const companyAliasName = values.company_alias_name || who.company_name;
  let submissionId;
  try {
    submissionId = await transaction(async (q) => {
      // A name not on the list is added as an attendee, rolled back if the submission fails.
      if (newAttendee) {
        const created = await q(
          "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(6))",
          [newAttendee.full_name, newAttendee.email, newAttendee.company_name]
        );
        attendee = { attendee_id: created.insertId };
      }
      const result = await q(
        "INSERT INTO feedback_submissions (attendee_id, device_fingerprint, feedback_data, userAliesName, userComapnyAliesName, is_suspended, created_at) " +
          "VALUES (?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(6))",
        [attendee.attendee_id, deviceFingerprint(req), JSON.stringify(values.feedback_data), aliasName, companyAliasName]
      );
      return result.insertId;
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(400).json(ALREADY_SUBMITTED);
    throw err;
  }

  return res.status(201).json({ id: submissionId, submission_status: true, detail: "Thank you, your feedback has been submitted." });
}

module.exports = { eventConfig, formStatus, attendeeList, registeredAttendees, feedbackSubmit };
