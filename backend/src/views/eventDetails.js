const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("../config");
const { query } = require("../db");
const details = require("../eventDetails");

// Admin Event Details page: the event's name, tagline, colour, media, links and Wi-Fi, and the home page menu.

async function getDetails(req, res) {
  const row = await details.loadDetailsRow(req.event);
  res.json({ ...details.detailsJson(row), menu: await details.menuItems() });
}

async function patchDetails(req, res) {
  const row = await details.saveDetails(req.event, req.body || {});
  res.json(details.detailsJson(row));
}

async function menuList(req, res) {
  res.json(await details.menuItems());
}

async function menuCreate(req, res) {
  await details.loadDetailsRow(req.event);
  res.status(201).json(await details.createMenuItem(req.body || {}));
}

async function menuPatch(req, res) {
  if (!(await details.getMenuItem(req.params.pk))) return res.status(404).json({ detail: "Not found." });
  return res.json(await details.updateMenuItem(req.params.pk, req.body || {}));
}

async function menuDelete(req, res) {
  const r = await query("DELETE FROM menu_items WHERE id = ?", [req.params.pk]);
  if (!r.affectedRows) return res.status(404).json({ detail: "Not found." });
  return res.status(204).end();
}

// ------------------------------------------------------------------ Uploads
// Files chosen on the Event Details page are saved in UPLOADS_DIR/<event code>/ under a random name and served by
// the API at /api/uploads/<event code>/<name>. The page stores /uploads/<event code>/<name> in the field.
const UPLOAD_TYPES = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".avif": "image",
  ".svg": "image",
  ".ico": "image",
  ".mp4": "video",
  ".webm": "video",
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_VIDEO_BYTES);

/** Checks the file type and size, then moves the file from multer's temporary folder into the event's folder. */
async function upload(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ detail: "Choose a file to upload." });
  const discard = () => fs.promises.rm(file.path, { force: true });
  const ext = path.extname(file.originalname || "").toLowerCase();
  const kind = UPLOAD_TYPES[ext];
  const wanted = req.body?.kind;
  if (!kind || (wanted && wanted !== kind)) {
    await discard();
    const allowed = Object.keys(UPLOAD_TYPES).filter((e) => !wanted || UPLOAD_TYPES[e] === wanted);
    return res.status(400).json({ detail: `Upload a ${allowed.join(", ")} file.` });
  }
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) {
    await discard();
    return res.status(400).json({ detail: `The ${kind} must be ${limit / 1024 / 1024} MB or smaller.` });
  }
  const dir = path.join(config.uploadsDir, req.event.code);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  try {
    await fs.promises.rename(file.path, path.join(dir, name));
  } catch (err) {
    // A temporary folder on another drive cannot be renamed across, copy it instead.
    if (err.code !== "EXDEV") throw err;
    await fs.promises.copyFile(file.path, path.join(dir, name));
    await discard();
  }
  return res.status(201).json({ url: `/uploads/${req.event.code}/${name}`, kind });
}

module.exports = { getDetails, patchDetails, menuList, menuCreate, menuPatch, menuDelete, upload, MAX_UPLOAD_BYTES };
