const crypto = require("crypto");
const { promisify } = require("util");

const pbkdf2 = promisify(crypto.pbkdf2);

// Same format as Django's PBKDF2 hasher, "pbkdf2_sha256$<iterations>$<salt>$<base64 hash>",
// so passwords set by the old Django backend keep working.
const ITERATIONS = 600000;
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DIGESTS = { pbkdf2_sha256: ["sha256", 32], pbkdf2_sha1: ["sha1", 20] };

function randomSalt(length = 22) {
  return Array.from({ length }, () => SALT_CHARS[crypto.randomInt(SALT_CHARS.length)]).join("");
}

async function makePassword(raw) {
  const salt = randomSalt();
  const hash = await pbkdf2(String(raw), salt, ITERATIONS, 32, "sha256");
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${hash.toString("base64")}`;
}

async function checkPassword(raw, encoded) {
  const [algorithm, iterations, salt, expected] = String(encoded || "").split("$");
  const digest = DIGESTS[algorithm];
  if (!digest || !salt || !expected || !/^\d+$/.test(iterations)) return false;
  const actual = await pbkdf2(String(raw), salt, Number(iterations), digest[1], digest[0]);
  const wanted = Buffer.from(expected, "base64");
  return wanted.length === actual.length && crypto.timingSafeEqual(wanted, actual);
}

module.exports = { makePassword, checkPassword };
