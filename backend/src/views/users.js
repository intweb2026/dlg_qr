const { query } = require("../db");
const { makePassword } = require("../passwords");
const roles = require("../roles");
const v = require("../validation");

// Admin Users page, the accounts that can sign in to this event's admin panel. Admin accounts belong to one event,
// each event has its own database. The routes are for the admin role only.

const USERNAME = /^[A-Za-z0-9._-]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const COLUMNS = "id, username, full_name, role, is_active, last_login, created_at";

function userJson(row) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    is_active: Boolean(row.is_active),
    last_login: row.last_login ? new Date(row.last_login).toISOString() : null,
  };
}

function cleanPassword(value) {
  if (typeof value !== "string") throw new v.FieldError("Not a valid string.");
  if (value.length < MIN_PASSWORD) throw new v.FieldError(`Use at least ${MIN_PASSWORD} characters.`);
  if (value.length > MAX_PASSWORD) throw new v.FieldError(`Use no more than ${MAX_PASSWORD} characters.`);
  return value;
}

const FIELDS = {
  username: {
    required: true,
    clean(value) {
      const text = v.string(value, { maxLength: 150 });
      if (text.length < 3) throw new v.FieldError("Use at least 3 characters.");
      if (!USERNAME.test(text)) throw new v.FieldError("Use letters, digits, dots, dashes and underscores only.");
      return text;
    },
  },
  full_name: { default: "", clean: (value) => v.string(value, { maxLength: 255, allowBlank: true }) },
  role: { required: true, requiredMessage: "Choose a role.", clean: (value) => v.choice(value, roles.ROLES) },
  password: { required: true, clean: cleanPassword },
  is_active: {
    default: true,
    clean(value) {
      if (typeof value !== "boolean") throw new v.FieldError("Must be a valid boolean.");
      return value;
    },
  },
};

const pick = (...names) => Object.fromEntries(names.map((n) => [n, FIELDS[n]]));

async function findUser(id) {
  const [row] = await query(`SELECT ${COLUMNS} FROM admin_users WHERE id = ?`, [id]);
  return row || null;
}

/** Whether another active admin would be left, so the last admin cannot lock everyone out. */
async function otherActiveAdmins(id) {
  const [{ n }] = await query("SELECT COUNT(*) AS n FROM admin_users WHERE role = ? AND is_active = 1 AND id <> ?", [roles.ADMIN, id]);
  return n;
}

async function list(req, res) {
  const rows = await query(`SELECT ${COLUMNS} FROM admin_users ORDER BY username`);
  res.json(rows.map(userJson));
}

async function create(req, res) {
  const { values, errors } = await v.validate(req.body || {}, pick("username", "full_name", "role", "password", "is_active"));
  if (errors) throw new v.ValidationError(errors);
  let inserted;
  try {
    inserted = await query(
      "INSERT INTO admin_users (username, password, full_name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))",
      [values.username, await makePassword(values.password), values.full_name || values.username, values.role, values.is_active ? 1 : 0]
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new v.ValidationError({ username: ["A user with this username already exists."] });
    throw err;
  }
  res.status(201).json(userJson(await findUser(inserted.insertId)));
}

async function patch(req, res) {
  const user = await findUser(req.params.pk);
  if (!user) return res.status(404).json({ detail: "Not found." });
  const { values, errors } = await v.validate(req.body || {}, pick("full_name", "role", "password", "is_active"), { partial: true });
  if (errors) throw new v.ValidationError(errors);
  if (!Object.keys(values).length) throw new v.ValidationError({ detail: ["Nothing to change."] });

  const self = user.id === req.user.id;
  const demoted = "role" in values && values.role !== user.role;
  const disabled = "is_active" in values && !values.is_active && Boolean(user.is_active);
  if (self && demoted) throw new v.ValidationError({ role: ["You cannot change your own role."] });
  if (self && disabled) throw new v.ValidationError({ is_active: ["You cannot disable your own account."] });
  const losesAdmin = user.role === roles.ADMIN && Boolean(user.is_active) && ((demoted && values.role !== roles.ADMIN) || disabled);
  if (losesAdmin && !(await otherActiveAdmins(user.id))) {
    throw new v.ValidationError({ detail: ["There must be at least one active admin."] });
  }

  const sets = [];
  const params = [];
  if ("full_name" in values) {
    sets.push("full_name = ?");
    params.push(values.full_name || user.username);
  }
  if ("role" in values) {
    sets.push("role = ?");
    params.push(values.role);
  }
  if ("is_active" in values) {
    sets.push("is_active = ?");
    params.push(values.is_active ? 1 : 0);
  }
  if ("password" in values) {
    sets.push("password = ?");
    params.push(await makePassword(values.password));
  }
  await query(`UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?`, [...params, user.id]);

  // A new role, password or a disabled account ends the user's sessions, so it takes effect at once. The admin who made
  // the change stays signed in on this device.
  if (demoted || disabled || "password" in values) {
    await query("DELETE FROM admin_tokens WHERE user_id = ? AND `key` <> ?", [user.id, self ? req.token : ""]);
  }
  return res.json(userJson(await findUser(user.id)));
}

async function remove(req, res) {
  const user = await findUser(req.params.pk);
  if (!user) return res.status(404).json({ detail: "Not found." });
  if (user.id === req.user.id) throw new v.ValidationError({ detail: ["You cannot delete your own account."] });
  if (user.role === roles.ADMIN && Boolean(user.is_active) && !(await otherActiveAdmins(user.id))) {
    throw new v.ValidationError({ detail: ["There must be at least one active admin."] });
  }
  await query("DELETE FROM admin_users WHERE id = ?", [user.id]);
  return res.status(204).end();
}

module.exports = { list, create, patch, remove };
