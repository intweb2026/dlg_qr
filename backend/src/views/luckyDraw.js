const crypto = require("crypto");

const { query } = require("../db");
const m = require("../models");
const { padLengthFor, toInt, truthy } = require("../utils");

// Lucky draw, public so the /lucky-draw page works without signing in.

async function pool(req, res) {
  const ids = await m.eligibleIds();
  const maxId = await m.maxSubmissionId();
  const cfg = await m.loadSettings();
  const [past] = await query(
    `SELECT COUNT(DISTINCT s.id) AS n FROM feedback_submissions s
     JOIN lucky_draw_winners w ON w.submission_id = s.id WHERE s.is_suspended = 0`
  );
  res.json({
    ids,
    count: ids.length,
    past_winners: past.n,
    max_id: maxId,
    pad_length: padLengthFor(maxId),
    max_spin_attempts: cfg.max_spin_attempts,
    spin_duration_seconds: cfg.spin_duration_seconds,
  });
}

/**
 * Winner is chosen on the server with a cryptographically secure RNG.
 * Only the entry number is returned here, the name stays on the server until Reveal is pressed.
 */
async function spin(req, res) {
  const ids = await m.eligibleIds();
  if (!ids.length) return res.status(400).json({ detail: "No eligible submissions in the pool." });
  const maxId = await m.maxSubmissionId();
  return res.json({ submission_id: ids[crypto.randomInt(ids.length)], pad_length: padLengthFor(maxId) });
}

async function reveal(req, res) {
  const body = req.body ?? {};
  const submissionId = toInt(body.submission_id);
  if (submissionId === null || !(await m.isEligible(submissionId))) {
    return res.status(400).json({ detail: "That submission is not in the eligible pool." });
  }
  const attempt = Math.max(1, toInt(truthy(body.attempt_number) ? body.attempt_number : 1) ?? 1);
  // drawn_by is only known when a signed-in admin runs the draw.
  const result = await query(
    "INSERT INTO lucky_draw_winners (submission_id, attempt_number, drawn_by_id, drawn_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))",
    [submissionId, attempt, req.user ? req.user.id : null]
  );
  const [win] = await query(`${m.WINNER_SELECT} WHERE w.id = ?`, [result.insertId]);
  return res.status(201).json(m.winnerJson(win));
}

async function winnerList(req, res) {
  const rows = await query(`${m.WINNER_SELECT} ORDER BY w.drawn_at DESC, w.id DESC`);
  res.json(rows.map(m.winnerJson));
}

async function winnerClear(req, res) {
  await query("DELETE FROM lucky_draw_winners");
  res.status(204).end();
}

module.exports = { pool, spin, reveal, winnerList, winnerClear };
