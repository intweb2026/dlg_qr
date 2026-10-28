const { query } = require("./db");

const KEYWORD = "token";

function authFailed(res, detail) {
  return res.set("WWW-Authenticate", "Token").status(401).json({ detail });
}

/**
 * Reads "Authorization: Token <key>" and sets req.user to the admin_users row.
 * No header leaves req.user null. A bad or expired token is rejected on every route, as the Django API did.
 */
async function authenticate(req, res, next) {
  req.user = null;
  req.token = null;
  const parts = (req.get("authorization") || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== KEYWORD) return next();
  if (parts.length !== 2) return authFailed(res, "Invalid token header.");

  const [row] = await query(
    `SELECT t.key AS token, u.id, u.username, u.full_name, u.is_active
     FROM admin_tokens t JOIN admin_users u ON u.id = t.user_id
     WHERE t.key = ?`,
    [parts[1]]
  );
  if (!row) return authFailed(res, "Your session has expired, sign in again.");
  if (!row.is_active) return authFailed(res, "This admin account is disabled.");
  req.user = { id: row.id, username: row.username, full_name: row.full_name };
  req.token = row.token;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return authFailed(res, "Authentication credentials were not provided.");
  return next();
}

module.exports = { authenticate, requireAdmin };
