const crypto = require("crypto");

const config = require("../config");
const { query } = require("../db");
const loginGuard = require("../loginGuard");
const { checkPassword, makePassword } = require("../passwords");

// Hash used when the username does not exist, so the response time does not reveal valid usernames.
const dummyHash = makePassword("not-a-real-password");

async function login(req, res) {
  const body = req.body ?? {};
  const username = body.username ? String(body.username).trim() : "";
  const password = body.password ? String(body.password) : "";
  const wait = loginGuard.lockedFor(req, username);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    return res.set("Retry-After", String(Math.ceil(wait / 1000))).status(429).json({
      detail: `Too many failed sign in attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    });
  }
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
  if (!valid) {
    loginGuard.recordFailure(req, username);
    return res.status(400).json({ detail: "Incorrect username or password." });
  }
  loginGuard.recordSuccess(req, username);
  // Sessions past their lifetime can no longer be used, so they are removed.
  await query("DELETE FROM admin_tokens WHERE created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND)", [
    Math.floor(config.security.adminSessionLifetime / 1000),
  ]);

  await query("UPDATE admin_users SET last_login = UTC_TIMESTAMP(6) WHERE id = ?", [user.id]);
  const token = crypto.randomBytes(32).toString("hex");
  await query("INSERT INTO admin_tokens (`key`, user_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(6))", [token, user.id]);
  return res.json({ token, username: user.username, full_name: user.full_name, role: user.role });
}

async function me(req, res) {
  res.json({ username: req.user.username, full_name: req.user.full_name, role: req.user.role });
}

async function logout(req, res) {
  // Only this session, other devices stay signed in.
  await query("DELETE FROM admin_tokens WHERE `key` = ?", [req.token]);
  res.status(204).end();
}

module.exports = { login, me, logout };
