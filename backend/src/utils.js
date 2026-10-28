const crypto = require("crypto");

function clientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.get("x-real-ip") || (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

/** SHA-256 hash derived from client IP and User-Agent. */
function deviceFingerprint(req) {
  const raw = `${clientIp(req)}|${req.get("user-agent") || ""}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Collapses runs of whitespace, "  Ana   Lopez " -> "Ana Lopez". */
function collapseSpaces(text) {
  return String(text || "").split(/\s+/).filter(Boolean).join(" ");
}

/** Same matching as the form's search, "  José  SMITH " -> "jose smith". */
function normalizeName(name) {
  return collapseSpaces(String(name || "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase());
}

/** Digits needed to show every ID with zero padding, minimum 2 (85 -> 2, 1200 -> 4). */
function padLengthFor(maxId) {
  return Math.max(2, String(maxId || 0).length);
}

/** p***a@example.com, so the public lookup never exposes full addresses. */
function maskEmail(email) {
  if (!email || !email.includes("@")) return null;
  const at = email.indexOf("@");
  const local = Array.from(email.slice(0, at));
  const domain = email.slice(at + 1);
  const masked = local.length <= 2 ? `${local[0]}*` : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

/** MySQL "2026-09-22 17:51:00.123000" -> "2026-09-22T17:51:00.123000Z", the format the Django API returned. */
function isoDate(value) {
  if (!value) return null;
  const [date, time] = String(value).split(" ");
  const [hms, fraction = ""] = time.split(".");
  const micro = /^0*$/.test(fraction) ? "" : `.${fraction.padEnd(6, "0")}`;
  return `${date}T${hms}${micro}Z`;
}

/** Python's truthiness, which the Django views relied on for loosely typed request fields. */
function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Python's int() for request values, null where int() would raise. */
function toInt(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && /^\s*[+-]?\d+(_\d+)*\s*$/.test(value)) return Number(value.trim().replace(/_/g, ""));
  return null;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

module.exports = {
  clientIp,
  deviceFingerprint,
  collapseSpaces,
  normalizeName,
  padLengthFor,
  maskEmail,
  isoDate,
  truthy,
  toInt,
  escapeLike,
};
