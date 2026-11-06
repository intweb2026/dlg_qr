const crypto = require("crypto");

const config = require("./config");
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

const MIN_ACCESS_TOKEN_LENGTH = 32;

/** Constant time comparison, hashing first so the two sides have the same length. */
function sameSecret(a, b) {
  const digest = (s) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * Guards the CRM export routes with "Authorization: Bearer <token>", the token is EXPORT_ACCESS_TOKEN and is the same
 * for every event. An admin login does not open these routes. With no usable token configured they answer 503.
 */
function requireAccessToken(req, res, next) {
  const tokens = config.exportAccessTokens.filter((t) => t.length >= MIN_ACCESS_TOKEN_LENGTH);
  if (!tokens.length) return res.status(503).json({ detail: "The access token is not configured on the server." });
  const parts = (req.get("authorization") || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return res.set("WWW-Authenticate", "Bearer").status(401).json({ detail: "Access token was not provided." });
  }
  // Every configured value is compared, so the time taken does not reveal which one matched.
  const ok = tokens.map((t) => sameSecret(parts[1], t)).some(Boolean);
  if (!ok) return res.set("WWW-Authenticate", "Bearer").status(401).json({ detail: "Invalid access token." });
  return next();
}

module.exports = { authenticate, requireAdmin, requireAccessToken };
