// Slows down password guessing on the admin sign in. Failed attempts are counted in memory, so a restart clears them
// and each server instance counts for itself, which is enough while one instance runs. The limits are in config.js,
// security.
//
// Two counters are kept per event. One for the sign in name from one address, which locks that name out for that
// address, so a real admin on another network can still sign in. One for the address alone, which stops a script that
// tries many different names.
const config = require("./config");
const { clientIp } = require("./utils");

const failures = new Map(); // key -> { times: [ms], lockedUntil: ms }
const MAX_KEYS = 10000;

const keysFor = (req, username) => {
  const ip = clientIp(req);
  const event = req.event?.code || "";
  return [
    { key: `${event}|${ip}|${String(username || "").toLowerCase()}`, max: config.security.loginMaxFailures },
    { key: `${event}|${ip}`, max: config.security.loginMaxFailuresPerIp },
  ];
};

/** Milliseconds left on a lockout for this sign in, 0 when it may try. */
function lockedFor(req, username) {
  const now = Date.now();
  let wait = 0;
  for (const { key } of keysFor(req, username)) {
    const entry = failures.get(key);
    if (entry && entry.lockedUntil > now) wait = Math.max(wait, entry.lockedUntil - now);
  }
  return wait;
}

/** Records a failed sign in, and locks the counter that has reached its limit. */
function recordFailure(req, username) {
  const now = Date.now();
  const { loginWindow, loginLockout } = config.security;
  if (failures.size > MAX_KEYS) {
    for (const [k, e] of failures) if (e.lockedUntil < now && !e.times.some((t) => now - t < loginWindow)) failures.delete(k);
  }
  for (const { key, max } of keysFor(req, username)) {
    const entry = failures.get(key) || { times: [], lockedUntil: 0 };
    entry.times = entry.times.filter((t) => now - t < loginWindow);
    entry.times.push(now);
    if (entry.times.length >= max) {
      entry.lockedUntil = now + loginLockout;
      entry.times = [];
    }
    failures.set(key, entry);
  }
}

/** A good sign in clears the counter for that name and address. */
function recordSuccess(req, username) {
  failures.delete(keysFor(req, username)[0].key);
}

/** For the tests. */
function reset() {
  failures.clear();
}

module.exports = { lockedFor, recordFailure, recordSuccess, reset };
