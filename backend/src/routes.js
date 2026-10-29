const express = require("express");
const multer = require("multer");

const { requireAdmin } = require("./auth");
const admin = require("./views/admin");
const auth = require("./views/auth");
const luckyDraw = require("./views/luckyDraw");
const pub = require("./views/public");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });

/** Registers handlers by method for one path, other methods get a 405 as they did from the Django API. */
function route(path, handlers) {
  const r = router.route(path);
  for (const [method, chain] of Object.entries(handlers)) r[method](...[].concat(chain));
  const allowed = Object.keys(handlers).map((m) => m.toUpperCase());
  if (allowed.includes("GET")) allowed.push("HEAD");
  r.all((req, res) =>
    res.set("Allow", [...allowed, "OPTIONS"].join(", ")).status(405).json({ detail: `Method "${req.method}" not allowed.` })
  );
}

// Numeric ids only, anything else is a 404 like Django's <int:pk>.
router.param("pk", (req, res, next, pk) => (/^\d+$/.test(pk) ? next() : res.status(404).json({ detail: "Not found." })));

// Every path below sits under /api/events/<code>, see app.js.
// Public
route("/", { get: pub.eventConfig });
route("/form-status/", { get: pub.formStatus });
route("/attendees/", { get: pub.attendeeList });
route("/registered-attendees/", { get: pub.registeredAttendees });
route("/feedback/submit/", { post: pub.feedbackSubmit });
// Admin auth
route("/auth/login/", { post: auth.login });
route("/auth/me/", { get: [requireAdmin, auth.me] });
route("/auth/logout/", { post: [requireAdmin, auth.logout] });
// Admin panel
route("/admin/settings/", { get: [requireAdmin, admin.getSettings], patch: [requireAdmin, admin.patchSettings] });
route("/admin/submissions/", { get: [requireAdmin, admin.submissionList] });
route("/admin/submissions/:pk/suspend/", { patch: [requireAdmin, admin.submissionSuspend] });
route("/admin/attendees/", { get: [requireAdmin, admin.attendeeList], post: [requireAdmin, admin.attendeeCreate] });
route("/admin/attendees/import/", { post: [requireAdmin, upload.any(), admin.attendeeImport] });
route("/admin/attendees/:pk/", { patch: [requireAdmin, admin.attendeePatch], delete: [requireAdmin, admin.attendeeDelete] });
// Lucky draw
route("/lucky-draw/pool/", { get: luckyDraw.pool });
route("/lucky-draw/spin/", { post: luckyDraw.spin });
route("/lucky-draw/reveal/", { post: luckyDraw.reveal });
route("/lucky-draw/winners/", { get: luckyDraw.winnerList, delete: luckyDraw.winnerClear });

module.exports = router;
