const path = require("path");

const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const config = require("./config");
const { hasLogin, query, withDatabase } = require("./db");
const { eventSchedule } = require("./eventDates");
const { withEventDetails } = require("./eventDetails");
const { allEvents } = require("./events");
const { feedbackList, questionLabel } = require("./feedbackQuestions");
const m = require("./models");
const { isoDate, padLengthFor } = require("./utils");

// The feedback submissions report. The day after the event's last day, at 12:00 AM where the event is held, every
// submission is put in one PDF, each attendee's details with their answers to every question, and emailed to
// FEEDBACK_REPORT_TO. It is sent once per event, form_settings.report_sent_at records it, so a restart or a second
// server does not send it again. An admin can download the PDF or send it again from the Feedback submissions page.

// How often the server looks for a report, and the window below, are in config.js, timing.feedbackReport.
const TIMING = config.timing.feedbackReport;
// A report is sent by itself only within this long of its time, so deploying long after an event does not email
// old events out of the blue. Older ones are sent with the admin's Send now button.

const FONT_DIR = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
const FONTS = { regular: path.join(FONT_DIR, "DejaVuSans.ttf"), bold: path.join(FONT_DIR, "DejaVuSans-Bold.ttf") };

const COLORS = { ink: "#111827", muted: "#6b7280", line: "#e5e7eb", band: "#f3f4f6", accent: "#1d4ed8", bad: "#b91c1c" };

const EXTRA_LABELS = new Set(
  ["conference_thoughts_original", "conference_thoughts_version", "conference_thoughts_consent"].map(questionLabel)
);

const HIDDEN_LABELS = new Set(
  ["conference_thoughts_original", "conference_thoughts_version", "conference_thoughts_consent"].map(questionLabel)
);

// Per event code, the error of the last failed send, shown on the admin page until a send works.
const lastErrors = new Map();

function mailReady() {
  return Boolean(config.smtpHost && config.feedbackReportTo.length);
}

// ------------------------------------------------------------------ PDF

/** "Nov 9, 2026, 10:15 AM" where the event is held, or in UTC when its time zone is not known. */
function venueTime(iso, timeZone) {
  if (!iso) return "";
  const options = { dateStyle: "medium", timeStyle: "short", timeZone: timeZone || "UTC" };
  try {
    return new Date(iso).toLocaleString("en-US", options) + (timeZone ? "" : " UTC");
  } catch {
    return new Date(iso).toISOString();
  }
}

/** One session review as lines, its title and then speakers, rating and comment. */
function reviewLines(review) {
  const title = review.title || review.short_title || `Session ${review.session_id ?? ""}`.trim();
  const lines = [];
  if (review.speakers) lines.push(`Speakers: ${review.speakers}`);
  if (review.day || review.start_time) lines.push([review.day, [review.start_time, review.end_time].filter(Boolean).join(" to ")].filter(Boolean).join(", "));
  if (review.rating) lines.push(`Rating: ${review.rating} of 5${review.rating_label ? `, ${review.rating_label}` : ""}`);
  if (review.comment) lines.push(`Comment: ${review.comment}`);
  return { title, lines };
}

/** An answer as plain text, lists one item per line. Session reviews are drawn on their own, see drawAnswer. */
function answerText(response) {
  if (response === null || response === undefined || response === "") return "No answer";
  if (Array.isArray(response)) {
    const items = response.map((item) => (typeof item === "object" && item !== null ? JSON.stringify(item) : String(item))).filter((t) => t.trim());
    return items.length ? items.map((t) => `•  ${t}`).join("\n") : "No answer";
  }
  if (typeof response === "object") return JSON.stringify(response);
  return String(response);
}

function isReviewList(response) {
  return Array.isArray(response) && response.length > 0 && response.every((r) => r && typeof r === "object" && ("title" in r || "session_id" in r));
}

/** Starts a new page when less than `needed` points are left above the bottom margin. */
function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawAnswer(doc, response, width) {
  const x = doc.page.margins.left + 12;
  if (isReviewList(response)) {
    response.forEach((review, i) => {
      const { title, lines } = reviewLines(review);
      ensureSpace(doc, 40);
      doc.font("bold").fontSize(9.5).fillColor(COLORS.ink).text(`${i + 1}. ${title}`, x, doc.y, { width: width - 12 });
      doc.font("regular").fontSize(9).fillColor(COLORS.muted);
      for (const line of lines) doc.text(line, x + 12, doc.y, { width: width - 24 });
      doc.moveDown(0.3);
    });
    return;
  }
  doc.font("regular").fontSize(9.5).fillColor(COLORS.ink).text(answerText(response), x, doc.y, { width: width - 12 });
}

/** One submission, a heading band with the entry number and name, the attendee's details, then every answer. */
function drawSubmission(doc, s, { pad, timeZone, width }) {
  const left = doc.page.margins.left;
  ensureSpace(doc, 150);
  const top = doc.y;
  doc.rect(left, top, width, 24).fill(COLORS.band);
  doc.font("bold").fontSize(11).fillColor(COLORS.accent).text(`Entry ${String(s.id).padStart(pad, "0")}`, left + 10, top + 6, { continued: true });
  doc.fillColor(COLORS.ink).text(`   ${s.alias_name || s.attendee_name || ""}`);
  if (s.is_suspended) {
    doc.font("bold").fontSize(9).fillColor(COLORS.bad).text("SUSPENDED", left, top + 8, { width: width - 10, align: "right" });
  }
  doc.y = top + 32;

  const details = [
    ["Display name", s.alias_name],
    ["Display company", s.company_alias_name],
    ["Name on the attendee list", s.attendee_name !== s.alias_name ? s.attendee_name : ""],
    ["Company on the attendee list", s.company_name !== s.company_alias_name ? s.company_name : ""],
    ["Email", s.email],
    ["Registered", s.is_walk_in ? "No, added on the form (walk-in)" : "Yes, on the attendee list"],
    ["Status", s.is_suspended ? "Suspended, left out of the raffle draw" : "Active"],
    ["Submitted", venueTime(s.created_at, timeZone)],
  ].filter(([, value]) => value);
  for (const [label, value] of details) {
    const y = doc.y;
    doc.font("bold").fontSize(9).fillColor(COLORS.muted).text(label, left, y, { width: 150 });
    const labelBottom = doc.y;
    doc.font("regular").fontSize(9.5).fillColor(COLORS.ink).text(String(value), left + 155, y, { width: width - 155 });
    doc.y = Math.max(doc.y, labelBottom) + 2;
  }

  doc.moveDown(0.6);
  const answers = feedbackList(s.feedback_data);
  if (!answers.length) {
    doc.font("regular").fontSize(9.5).fillColor(COLORS.muted).text("No answers saved.", left, doc.y);
  }
  // The testimonial's extra answers, the words before Polish, whether it was polished and the marketing consent, are
  // shown under it, so every question keeps its number.
  let number = 0;
  for (const a of answers) {
    // The testimonial answer is the final text, polished or the attendee's own. The words before Polish, which of
    // the two it is and the marketing consent are left out of the report.
    if (HIDDEN_LABELS.has(a.question)) continue;
    if (EXTRA_LABELS.has(a.question)) {
      ensureSpace(doc, 25);
      const x = left + 12;
      const label = /[?:]$/.test(a.question) ? `${a.question} ` : `${a.question}: `;
      doc.font("bold").fontSize(9).fillColor(COLORS.muted).text(label, x, doc.y, { width: width - 12, continued: true });
      doc.font("regular").fillColor(COLORS.ink).text(answerText(a.response));
      doc.moveDown(0.35);
      continue;
    }
    number += 1;
    ensureSpace(doc, 45);
    doc.font("bold").fontSize(9.5).fillColor(COLORS.ink).text(`${String(number).padStart(2, "0")}. ${a.question}`, left, doc.y, { width });
    doc.moveDown(0.15);
    drawAnswer(doc, a.response, width);
    doc.moveDown(0.55);
  }

  doc.moveDown(0.4);
  ensureSpace(doc, 20);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.7).strokeColor(COLORS.line).stroke();
  doc.moveDown(1);
}

/** Every submission of the event, suspended ones included, as a PDF Buffer. Runs inside the event's database. */
async function buildReportPdf(event) {
  const rows = (await query(`${m.SUBMISSION_SELECT} ORDER BY s.id`)).map(m.submissionJson);
  let schedule = {};
  try {
    schedule = await eventSchedule(event);
  } catch {
    /* dates and place not known, times are shown in UTC */
  }
  const timeZone = schedule.timeZone || null;
  const pad = padLengthFor(Math.max(0, ...rows.map((r) => r.id)));
  const suspended = rows.filter((r) => r.is_suspended).length;
  const name = event.name || event.code;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 55, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: `${name}, feedback submissions`, Author: name },
  });
  doc.registerFont("regular", FONTS.regular);
  doc.registerFont("bold", FONTS.bold);
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font("bold").fontSize(20).fillColor(COLORS.ink).text(name, left, doc.y, { width });
  doc.font("regular").fontSize(12).fillColor(COLORS.muted).text("Feedback submissions report", { width });
  doc.moveDown(0.8);
  const facts = [
    ["Event dates", [schedule.start, schedule.end].filter(Boolean).map((d) => d.toISOString().slice(0, 10)).join(" to ")],
    ["Location", schedule.location || ""],
    ["Submissions", `${rows.length} in all, ${rows.length - suspended} active, ${suspended} suspended`],
    ["Times shown in", timeZone || "UTC"],
    ["Generated", venueTime(new Date().toISOString(), timeZone)],
  ].filter(([, value]) => value);
  for (const [label, value] of facts) {
    const y = doc.y;
    doc.font("bold").fontSize(10).fillColor(COLORS.muted).text(label, left, y, { width: 110 });
    doc.font("regular").fontSize(10).fillColor(COLORS.ink).text(value, left + 115, y, { width: width - 115 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.8);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor(COLORS.ink).stroke();
  doc.moveDown(1.2);

  if (!rows.length) doc.font("regular").fontSize(11).fillColor(COLORS.muted).text("No feedback was submitted for this event.", left, doc.y);
  for (const s of rows) drawSubmission(doc, s, { pad, timeZone, width });

  // Page numbers, drawn in the bottom margin, which is cleared first so the text does not start a new page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("regular").fontSize(8).fillColor(COLORS.muted)
      .text(`${name}, feedback submissions   ·   Page ${i + 1} of ${range.count}`, left, doc.page.height - 35, { width, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return { pdf: await done, count: rows.length };
}

function reportFileName(event) {
  return `${event.code}-feedback-submissions-${new Date().toISOString().slice(0, 10)}.pdf`;
}

// ------------------------------------------------------------------ Email

let transport = null;
function mailer() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    });
  }
  return transport;
}

/** Builds the PDF and emails it. Throws when it cannot be sent. Runs inside the event's database. */
async function emailReport(event) {
  if (!mailReady()) throw new Error("Email is not set up, set SMTP_HOST and FEEDBACK_REPORT_TO on the server.");
  const { pdf, count } = await buildReportPdf(event);
  const name = event.name || event.code;
  await mailer().sendMail({
    from: config.mailFrom || config.smtpUser,
    to: config.feedbackReportTo.join(", "),
    subject: `${name}: feedback submissions report (${count})`,
    text:
      `Attached are all ${count} feedback submission${count === 1 ? "" : "s"} for ${name}, ` +
      "each with the attendee's details and their answers to every question.\n\n" +
      "This report is sent by the feedback form the day after the event ends.",
    attachments: [{ filename: reportFileName(event), content: pdf, contentType: "application/pdf" }],
  });
  await query("UPDATE form_settings SET report_sent_at = UTC_TIMESTAMP(6), report_sent_count = ? WHERE id = 1", [count]);
  lastErrors.delete(event.code);
  return count;
}

/** When the report is due, 12:00 AM of the day after the event's last day where it is held, or null when not known. */
async function reportDueAt(event) {
  const { until } = await eventSchedule(event);
  return until ? new Date(until.getTime() + 1) : null;
}

/**
 * Sends the report when it is due and has not been sent. The report_sent_at row is claimed first, so only one
 * server sends it, and is let go again when the send fails, so the next check tries again.
 */
async function sendIfDue(event) {
  if (!mailReady()) return false;
  const dueAt = await reportDueAt(event);
  const now = Date.now();
  if (!dueAt || now < dueAt.getTime() || now - dueAt.getTime() > TIMING.autoWindow) return false;
  const settings = await m.loadSettings();
  if (settings.report_sent_at) return false;
  const claim = await query("UPDATE form_settings SET report_sent_at = UTC_TIMESTAMP(6) WHERE id = 1 AND report_sent_at IS NULL");
  if (!claim.affectedRows) return false;
  try {
    const count = await emailReport(event);
    console.log(`${event.code}: feedback report with ${count} submissions sent to ${config.feedbackReportTo.join(", ")}`);
    return true;
  } catch (err) {
    await query("UPDATE form_settings SET report_sent_at = NULL WHERE id = 1");
    lastErrors.set(event.code, { at: new Date().toISOString(), message: err.message });
    console.error(`${event.code}: feedback report not sent, tried again in an hour, ${err.message}`);
    return false;
  }
}

/** Looks at every active event once. */
async function checkReports() {
  for (const e of allEvents()) {
    if (!e.active || !hasLogin(e.database)) continue;
    try {
      await withDatabase(e.database, async () => sendIfDue(await withEventDetails(e)));
    } catch (err) {
      console.error(`${e.code}: feedback report check failed, ${err.message}`);
    }
  }
}

/** Starts the hourly check, from server.js. The timers do not keep the process alive. */
function startReportTimer() {
  setTimeout(checkReports, TIMING.firstCheck).unref();
  setInterval(checkReports, TIMING.check).unref();
}

/** What the admin page shows. Runs inside the event's database. */
async function reportStatus(event) {
  const settings = await m.loadSettings();
  let dueAt = null;
  let timeZone = null;
  try {
    const schedule = await eventSchedule(event);
    timeZone = schedule.timeZone || null;
    dueAt = schedule.until ? new Date(schedule.until.getTime() + 1) : null;
  } catch {
    /* not known */
  }
  const late = dueAt && Date.now() - dueAt.getTime() > TIMING.autoWindow;
  return {
    mail_ready: mailReady(),
    recipients: config.feedbackReportTo,
    sends_at: dueAt ? dueAt.toISOString() : null,
    time_zone: timeZone,
    auto: Boolean(dueAt) && !late,
    sent_at: isoDate(settings.report_sent_at) || null,
    sent_count: settings.report_sent_count ?? null,
    last_error: lastErrors.get(event.code) || null,
  };
}

/** For the tests, a transport that does not send. */
function setMailer(t) {
  transport = t;
}

module.exports = { setMailer, buildReportPdf, checkReports, emailReport, reportFileName, reportStatus, sendIfDue, startReportTimer, mailReady, AUTO_WINDOW_MS: TIMING.autoWindow };
