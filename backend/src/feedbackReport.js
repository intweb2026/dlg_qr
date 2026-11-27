const fs = require("fs");
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
const logbook = require("./logbook");
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

const COLORS = { band_dark: "#0f172a", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", band: "#f3f4f6", accent: "#1d4ed8", bad: "#b91c1c" };

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

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_FETCH_TIMEOUT = 5000;
const LOGO_BOX = { width: 170, height: 52 }; // the logo is scaled down to fit this, in points
const BAND_PADDING = 22; // space above and below the logo in the header band

// The PDF library draws PNG and JPEG only, checked by the first bytes of the file, whatever its name says.
function isPngOrJpeg(buf) {
  return buf.length > 8 && ((buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) || (buf[0] === 0xff && buf[1] === 0xd8));
}

/**
 * The event's logo as an image Buffer for the report header, or null. The logo is a file uploaded on the Event Details
 * page (/uploads/<code>/<name>, read from UPLOADS_DIR), a full URL, or a path of the site such as /events/<code>/images/logo.png,
 * fetched from the first address in CORS_ALLOWED_ORIGINS. Anything else, a failed fetch, a file that is not a PNG or JPEG
 * or is too large gives null, and the report is made without a logo. It never stops the report.
 */
async function loadLogo(event) {
  try {
    const value = String(event.media?.logo || "").trim();
    if (!value) return null;
    let buf;
    const uploaded = value.match(/^\/uploads\/([A-Za-z0-9_-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (uploaded) {
      // Only the event's own folder is read.
      if (uploaded[1] !== event.code) return null;
      buf = await fs.promises.readFile(path.join(config.uploadsDir, uploaded[1], uploaded[2]));
    } else {
      const base = config.corsAllowedOrigins[0];
      const url = /^https?:\/\//i.test(value) ? value : value.startsWith("/") && base ? `${base.replace(/\/+$/, "")}${value}` : null;
      if (!url) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT) });
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    return buf.length <= LOGO_MAX_BYTES && isPngOrJpeg(buf) ? buf : null;
  } catch (err) {
    console.error(`${event.code}: report logo not used, ${err.message}`);
    return null;
  }
}

/**
 * The numbers and the raffle winners shown in the report and in the email. Runs inside the event's database.
 *   total          every attendee on the list, registered or not
 *   registered     the delegates copied from the CRM
 *   notRegistered  the walk-ins, who typed a name that was not on the list when they sent feedback
 *   submissions    feedback submissions, suspended ones included, with how many are active and suspended
 *   notSubmitted   attendees with no submission
 *   winners        the raffle draw winners in the order they were drawn, with their entry number, padded to pad digits
 */
async function reportSummary(pad) {
  const [a] = await query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(a.is_walk_in = 0), 0) AS registered, COALESCE(SUM(a.is_walk_in = 1), 0) AS not_registered,
            COALESCE(SUM(s.id IS NULL), 0) AS not_submitted
     FROM attendees a LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id`
  );
  const [f] = await query("SELECT COUNT(*) AS total, COALESCE(SUM(is_suspended = 0), 0) AS active, COALESCE(SUM(is_suspended = 1), 0) AS suspended FROM feedback_submissions");
  const winners = (await query(`${m.WINNER_SELECT} ORDER BY w.drawn_at, w.id`)).map(m.winnerJson).map((w) => ({
    name: w.attendee_name,
    company: w.company_name || "",
    entry: String(w.submission_id).padStart(pad, "0"),
    drawnAt: w.drawn_at,
    draw: w.attempt_number,
  }));
  return {
    total: Number(a.total),
    registered: Number(a.registered),
    notRegistered: Number(a.not_registered),
    submissions: Number(f.total),
    active: Number(f.active),
    suspended: Number(f.suspended),
    notSubmitted: Number(a.not_submitted),
    winners,
  };
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
  const summary = await reportSummary(pad);
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
  // The header of the first page is a dark band across the top, the event's logo on the left and the report title on
  // the right. Event logos are made for a dark site header and are often white, so the band keeps them readable. The
  // event name is written only when there is no logo, or it could not be drawn, and then the header is plain text.
  let drewLogo = false;
  const logo = await loadLogo(event);
  if (logo) {
    try {
      const image = doc.openImage(logo);
      const scale = Math.min(LOGO_BOX.height / image.height, LOGO_BOX.width / image.width, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      const bandHeight = h + 2 * BAND_PADDING;
      doc.rect(0, 0, doc.page.width, bandHeight).fill(COLORS.band_dark);
      doc.image(logo, left, BAND_PADDING, { width: w, height: h });
      doc.font("bold").fontSize(15).fillColor("#ffffff");
      doc.text("Feedback submissions report", left + w + 20, (bandHeight - doc.currentLineHeight()) / 2, {
        width: width - w - 20,
        align: "right",
        lineBreak: false,
      });
      doc.x = left;
      doc.y = bandHeight + 24;
      drewLogo = true;
    } catch (err) {
      console.error(`${event.code}: report logo not drawn, ${err.message}`);
    }
  }
  if (!drewLogo) {
    doc.font("bold").fontSize(20).fillColor(COLORS.ink).text(name, left, doc.y, { width });
    doc.font("regular").fontSize(12).fillColor(COLORS.muted).text("Feedback submissions report", left, doc.y, { width });
  }
  doc.moveDown(0.8);
  const facts = [
    ["Event dates", [schedule.start, schedule.end].filter(Boolean).map((d) => d.toISOString().slice(0, 10)).join(" to ")],
    ["Location", schedule.location || ""],
    ["Total attendees", String(summary.total)],
    ["Registered attendees", String(summary.registered)],
    ["Not registered attendees", String(summary.notRegistered)],
    ["Submissions", `${summary.submissions} in all, ${summary.active} active, ${summary.suspended} suspended`],
    ["Not submitted", String(summary.notSubmitted)],
    ["Times shown in", timeZone || "UTC"],
    ["Generated", venueTime(new Date().toISOString(), timeZone)],
  ].filter(([, value]) => value);
  for (const [label, value] of facts) {
    const y = doc.y;
    doc.font("bold").fontSize(10).fillColor(COLORS.muted).text(label, left, y, { width: 175, lineBreak: false });
    doc.font("regular").fontSize(10).fillColor(COLORS.ink).text(value, left + 180, y, { width: width - 180 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.8);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor(COLORS.ink).stroke();
  doc.moveDown(1.2);

  // The raffle draw winners, in the order they were drawn.
  doc.font("bold").fontSize(12).fillColor(COLORS.ink).text("Raffle draw winners", left, doc.y, { width });
  doc.moveDown(0.4);
  if (!summary.winners.length) {
    doc.font("regular").fontSize(10).fillColor(COLORS.muted).text("No winner has been drawn.", left, doc.y, { width });
  }
  summary.winners.forEach((w, i) => {
    ensureSpace(doc, 18);
    doc.font("bold").fontSize(10).fillColor(COLORS.ink).text(`${i + 1}. ${w.name}`, left, doc.y, { width, continued: true });
    doc.font("regular").fillColor(COLORS.muted).text(
      `${w.company ? `, ${w.company}` : ""}   Entry ${w.entry}, drawn ${venueTime(w.drawnAt, timeZone)}`,
      { width }
    );
    doc.moveDown(0.2);
  });
  doc.moveDown(1);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.7).strokeColor(COLORS.line).stroke();
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
  return { pdf: await done, count: rows.length, timeZone, summary };
}

// The time stamp in the file name, 2026-11-27_14-30, in the event's time zone like every other time in the app, or in
// UTC when the zone is not known.
function fileStamp(date, timeZone) {
  const make = (zone) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );
  let p;
  try {
    p = make(timeZone || "UTC");
  } catch {
    p = make("UTC");
  }
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}`;
}

/**
 * The PDF's file name, for the email attachment and the admin download alike,
 * <event_name>_feedback_submission_<date and time in the event's time zone>_(<submission count>).pdf
 * The event name keeps its letters and digits, spaces become underscores and anything a file name cannot hold is dropped.
 */
function reportFileName(event, count, { date = new Date(), timeZone = null } = {}) {
  const name =
    String(event.name || event.code)
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .replace(/^[._-]+|[._-]+$/g, "") || event.code;
  return `${name}_feedback_submission_${fileStamp(date, timeZone)}_(${count}).pdf`;
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

const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email's plain text and HTML, the counts and the raffle winners. The full report is the attached PDF. */
function emailBody(name, summary, timeZone) {
  const lines = [
    ["Total attendees", summary.total],
    ["Registered attendees", summary.registered],
    ["Not registered attendees", summary.notRegistered],
    ["Submissions", summary.submissions],
    ["Not submitted", summary.notSubmitted],
  ];
  const winner = (w, i) => `${i + 1}. ${w.name}${w.company ? `, ${w.company}` : ""}, entry ${w.entry}, drawn ${venueTime(w.drawnAt, timeZone)}`;
  const text =
    `${name}, feedback submissions report\n\n` +
    lines.map(([label, value]) => `${label.padEnd(26)}${value}`).join("\n") +
    "\n\nRaffle draw winners\n" +
    (summary.winners.length ? summary.winners.map(winner).join("\n") : "No winner has been drawn.") +
    "\n\nThe full report, with every submission, is attached as a PDF.\n" +
    "This report is sent by the feedback form the day after the event ends.";
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(name)}, feedback submissions report</h2>` +
    `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">` +
    lines.map(([label, value]) => `<tr><td style="border-bottom:1px solid #e5e7eb">${escapeHtml(label)}</td><td style="border-bottom:1px solid #e5e7eb;text-align:right"><strong>${value}</strong></td></tr>`).join("") +
    `</table>` +
    `<h3 style="margin:18px 0 6px">Raffle draw winners</h3>` +
    (summary.winners.length
      ? `<ol style="margin:0;padding-left:20px">${summary.winners.map((w) => `<li>${escapeHtml(w.name)}${w.company ? `, ${escapeHtml(w.company)}` : ""}, entry ${escapeHtml(w.entry)}, drawn ${escapeHtml(venueTime(w.drawnAt, timeZone))}</li>`).join("")}</ol>`
      : `<p style="margin:0">No winner has been drawn.</p>`) +
    `<p style="margin:18px 0 0;color:#6b7280">The full report, with every submission, is attached as a PDF.<br>This report is sent by the feedback form the day after the event ends.</p>` +
    `</div>`;
  return { text, html };
}

/**
 * Builds the PDF and emails it. Throws when it cannot be sent. Runs inside the event's database. by says what started it
 * for the logbook, "automatic" for the day after the event, or the admin who pressed Send now.
 */
async function emailReport(event, by = "automatic") {
  if (!mailReady()) throw new Error("Email is not set up, set SMTP_HOST and FEEDBACK_REPORT_TO on the server.");
  const elapsed = logbook.stopwatch();
  const to = config.feedbackReportTo.join(", ");
  const logged = { kind: "email", target: to, method: "SMTP", by };
  let count = 0;
  try {
    const built = await buildReportPdf(event);
    count = built.count;
    const name = event.name || event.code;
    const filename = reportFileName(event, count, { timeZone: built.timeZone });
    const info = await mailer().sendMail({
      from: config.mailFrom || config.smtpUser,
      to,
      subject: `${name}: feedback submissions report (${count})`,
      ...emailBody(name, built.summary, built.timeZone),
      attachments: [{ filename, content: built.pdf, contentType: "application/pdf" }],
    });
    await logbook.record({
      ...logged,
      ok: true,
      ms: elapsed(),
      summary: `Report with ${count} submission${count === 1 ? "" : "s"} sent, ${filename}`,
      response: info && typeof info === "object" && !Array.isArray(info) ? { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response } : null,
    });
  } catch (err) {
    await logbook.record({ ...logged, ok: false, ms: elapsed(), summary: count ? `Report with ${count} submission${count === 1 ? "" : "s"} not sent` : "Report not sent", error: err.message });
    throw err;
  }
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

module.exports = { setMailer, buildReportPdf, emailBody, checkReports, emailReport, reportFileName, reportStatus, sendIfDue, startReportTimer, mailReady, AUTO_WINDOW_MS: TIMING.autoWindow };
