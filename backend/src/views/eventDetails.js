const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("../config");
const { query } = require("../db");
const details = require("../eventDetails");
const { refreshEventDates } = require("../eventDates");
const uploads = require("../uploads");
const v = require("../validation");
const wifiQr = require("../wifiQr");

// Admin Event Details page: the event's name, tagline, colour, media, links and Wi-Fi, and the home page menu.

async function getDetails(req, res) {
  const row = await details.loadDetailsRow(req.event);
  res.json({ ...details.detailsJson(row), menu: await details.menuItems() });
}

// The Wi-Fi QR code is made by the server, never sent by a page, so a page that was opened earlier cannot put back an old
// one. It is made again whenever the network name, password, security or hidden setting changes, when there is none
// yet, and when its file is gone, see wifiQr.js. No network name leaves nothing to scan, so the code is cleared.
// Returns the saved row and qrUpdated, true when the code was made, false when it could not be, null when it was left.
async function saveDetailsAndQr(event, data) {
  const { wifiQr: ignored, ...fields } = data;
  const before = await details.loadDetailsRow(event);
  let row = await details.saveDetails(event, fields);
  // The event dates are read from the website, so a changed website link reads them from the new site at once.
  if (row.website_url !== before.website_url) await refreshEventDates(await details.withEventDetails(event), "website link changed");
  // Anything the code is made from, the network name, password, security or hidden setting.
  const changed = ["wifi_network", "wifi_password", "wifi_security", "wifi_hidden"].some((column) => row[column] !== before[column]);
  if (!changed && !(await wifiQr.isMissing(event.code, row))) return { row, qrUpdated: null };
  try {
    const qr = row.wifi_network
      ? await wifiQr.writeWifiQr(event.code, { network: row.wifi_network, password: row.wifi_password, security: row.wifi_security, hidden: Boolean(row.wifi_hidden) })
      : "";
    row = await details.saveDetails(event, { wifiQr: qr });
    return { row, qrUpdated: true };
  } catch (err) {
    // The new details are saved, only the picture could not be made.
    console.error(`${event.code}: Wi-Fi QR code not made, ${err.message}`);
    return { row, qrUpdated: false };
  }
}

async function patchDetails(req, res) {
  // A replaced or removed media file, the earlier QR code included, is deleted once the change is saved, see uploads.js.
  const { row, qrUpdated } = await uploads.tracking(req.event.code, () => saveDetailsAndQr(req.event, req.body || {}));
  res.json({ ...details.detailsJson(row), qr_updated: qrUpdated });
}

// The Wi-Fi network and password on their own, for the support user on the floor who may change nothing else. Only these
// two keys are read from the request, so the rest of the event details cannot be changed through this route.
function wifiJson(row) {
  const { network, password, wifiQr: qr, updated_at } = details.detailsJson(row);
  return { network, password, qr, updated_at };
}

async function getWifi(req, res) {
  res.json(wifiJson(await details.loadDetailsRow(req.event)));
}

async function patchWifi(req, res) {
  const body = req.body || {};
  const data = {};
  for (const key of ["network", "password"]) if (body[key] !== undefined) data[key] = body[key];
  if (!Object.keys(data).length) throw new v.ValidationError({ detail: ["Send the network name or the password."] });
  const { row, qrUpdated } = await uploads.tracking(req.event.code, () => saveDetailsAndQr(req.event, data));
  res.json({ ...wifiJson(row), qr_updated: qrUpdated });
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
  return res.json(await uploads.tracking(req.event.code, () => details.updateMenuItem(req.params.pk, req.body || {})));
}

async function menuDelete(req, res) {
  const r = await uploads.tracking(req.event.code, () => query("DELETE FROM menu_items WHERE id = ?", [req.params.pk]));
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
  // A field that takes one format, such as the MP4 or the WebM hero video, sends it as ext, for example ".mp4".
  const only = req.body?.ext ? String(req.body.ext).toLowerCase() : "";
  if (only && ext !== only) {
    await discard();
    return res.status(400).json({ detail: `Upload a ${only} file.` });
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

module.exports = { getDetails, patchDetails, getWifi, patchWifi, menuList, menuCreate, menuPatch, menuDelete, upload, MAX_UPLOAD_BYTES };
