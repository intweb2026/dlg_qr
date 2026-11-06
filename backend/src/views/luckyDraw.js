const crypto = require("crypto");

const config = require("../config");
const { query } = require("../db");
const { feedbackResponsesPayload } = require("./admin");
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
  // The draw has started, so the feedback form moves to the ended status. The admin can set another status on the Submissions page.
  await m.loadSettings();
  await query("UPDATE form_settings SET form_status = 'ended', updated_at = UTC_TIMESTAMP(6) WHERE id = 1");
  return res.json({ submission_id: ids[crypto.randomInt(ids.length)], pad_length: padLengthFor(maxId) });
}

/**
 * Posts the feedback responses to the CRM and returns what the CRM answered. The raffle page calls this right after a spin, so the call shows in the
 * browser's Network tab, but the request to the CRM is made here and the key never leaves the server. Only answers
 * once the form has ended, which a spin does, so it cannot be used to push responses from an open form.
 */
async function sendToCrm(req, res) {
  if (!config.sendFeedbackSubmissionToCrm || !config.crmWebhookUrl || !config.crmApiKey) return res.json({ sent: false, reason: "disabled" });
  const cfg = await m.loadSettings();
  if (cfg.form_status !== "ended") return res.status(409).json({ detail: "The feedback form has not ended yet." });
  const payload = await feedbackResponsesPayload(req.event);
  try {
    const crm = await postToCrm(payload);
    if (!crm.ok) console.error(`CRM webhook answered ${crm.status}`);
    // The CRM's own status and reply, and the payload that was sent, so they can be read in the Network tab.
    return res.json({ sent: crm.ok, crm_status: crm.status, crm_response: crm.body, payload });
  } catch (err) {
    console.error(`CRM webhook failed: ${err.message}`);
    return res.status(502).json({ sent: false, crm_status: null, detail: `The CRM could not be reached, ${err.message}`, payload });
  }
}

/** Posts the payload and returns the CRM's status and reply, a reply that is not JSON comes back as text. */
async function postToCrm(payload) {
  const res = await fetch(config.crmWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CRM-API-KEY": config.crmApiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON, keep the text */
  }
  return { ok: res.ok, status: res.status, body };
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

module.exports = { pool, spin, sendToCrm, reveal, winnerList, winnerClear };
