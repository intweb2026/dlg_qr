const crypto = require("crypto");

const { query } = require("../db");
const { checkPassword, makePassword } = require("../passwords");

// Hash used when the username does not exist, so the response time does not reveal valid usernames.
const dummyHash = makePassword("not-a-real-password");

async function login(req, res) {
  const body = req.body ?? {};
  const username = body.username ? String(body.username).trim() : "";
  const password = body.password ? String(body.password) : "";
  const [user] = username
    ? await query("SELECT * FROM admin_users WHERE username = ? ORDER BY username LIMIT 1", [username])
    : [];
  let valid;
  if (!user) {
    await checkPassword(password, await dummyHash);
    valid = false;
  } else {
    valid = (await checkPassword(password, user.password)) && Boolean(user.is_active);
  }
  if (!valid) return res.status(400).json({ detail: "Incorrect username or password." });

  await query("UPDATE admin_users SET last_login = UTC_TIMESTAMP(6) WHERE id = ?", [user.id]);
  const token = crypto.randomBytes(32).toString("hex");
  await query("INSERT INTO admin_tokens (`key`, user_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(6))", [token, user.id]);
  return res.json({ token, username: user.username, full_name: user.full_name });
}

async function me(req, res) {
  res.json({ username: req.user.username, full_name: req.user.full_name });
}

async function logout(req, res) {
  // Only this session, other devices stay signed in.
  await query("DELETE FROM admin_tokens WHERE `key` = ?", [req.token]);
  res.status(204).end();
}

module.exports = { login, me, logout };
