const fs = require("fs");
const path = require("path");

const config = require("./config");
const { query } = require("./db");
const { DETAIL_FIELDS } = require("./eventDetails");

// Files uploaded on the admin Event Details page, or made by the server like the Wi-Fi QR code, are saved in
// UPLOADS_DIR/<event code>/ under a new name every time. Nothing else refers to a file but a media field of the event
// details and the icon of a menu item, so a file that none of them holds any more is not used and is deleted.
//   Replacing a file, removing it or deleting the menu item that held it deletes the old file when the change is saved.
//   A file that was uploaded but never saved is deleted once it is older than config.timing.uploads.orphanGrace, so an
//   upload that is still waiting for the admin to press Save is left alone.
// Only plain file names inside the event's own folder are ever deleted.

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const mediaColumns = () => DETAIL_FIELDS.filter((f) => f.kind === "media").map((f) => f.column);

/** The names of the event's uploaded files that a media field or a menu icon holds right now. */
async function referenced(eventCode) {
  const prefix = `/uploads/${eventCode}/`;
  const names = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.startsWith(prefix)) names.add(value.slice(prefix.length));
  };
  const [row] = await query("SELECT * FROM event_details WHERE id = 1");
  if (row) for (const column of mediaColumns()) add(row[column]);
  for (const item of await query("SELECT icon FROM menu_items")) add(item.icon);
  return names;
}

async function removeFile(eventCode, name) {
  if (!SAFE_NAME.test(name)) return false;
  const dir = path.resolve(config.uploadsDir, eventCode);
  const file = path.resolve(dir, name);
  if (path.dirname(file) !== dir) return false;
  await fs.promises.rm(file, { force: true });
  return true;
}

/** Deletes files in the event's folder that nothing holds and that are older than the grace period. */
async function sweep(eventCode, inUse) {
  const dir = path.join(config.uploadsDir, eventCode);
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  const oldest = Date.now() - config.timing.uploads.orphanGrace;
  for (const name of names) {
    if (inUse.has(name) || !SAFE_NAME.test(name)) continue;
    const stat = await fs.promises.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < oldest) await removeFile(eventCode, name);
  }
}

/**
 * Runs change, then deletes the uploaded files it stopped using and any old file nothing holds. A failure while
 * deleting is logged and never fails the request, the change itself is already saved.
 */
async function tracking(eventCode, change) {
  const before = await referenced(eventCode);
  const result = await change();
  try {
    const after = await referenced(eventCode);
    for (const name of before) if (!after.has(name)) await removeFile(eventCode, name);
    await sweep(eventCode, after);
  } catch (err) {
    console.error(`${eventCode}: old uploaded files were not deleted, ${err.message}`);
  }
  return result;
}

module.exports = { tracking, referenced };
