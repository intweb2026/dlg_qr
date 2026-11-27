const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const config = require("./config");

// The Wi-Fi QR code made by the server, so it follows the network and password when the support user changes them.
// It is the same code the admin Event Details page makes, the standard Wi-Fi text phones read when the camera scans it,
//   WIFI:T:WPA;S:<network>;P:<password>;;   with \ ; , : and " escaped by a backslash.
// The server cannot know a hidden network or a WEP network, so it makes a WPA code, or an open one when there is no
// password. An admin can still make a different one on the Event Details page, which stays until the next change.

const PREFIX = "wifi-qr-";

function escape(text) {
  return String(text).replace(/([\\;,:"])/g, "\\$1");
}

function payload({ network, password }) {
  if (!password) return `WIFI:T:nopass;S:${escape(network)};;`;
  return `WIFI:T:WPA;S:${escape(network)};P:${escape(password)};;`;
}

/**
 * Writes the QR code of the network and password to the event's uploads folder and returns its site path, such as
 * /uploads/aiu26/wifi-qr-1a2b3c4d5e6f.png. The name comes from the content, so the same details give the same file and a
 * browser never shows an older picture for new details.
 */
async function writeWifiQr(eventCode, { network, password }) {
  const text = payload({ network, password });
  const name = `${PREFIX}${crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)}.png`;
  const dir = path.join(config.uploadsDir, eventCode);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const png = await QRCode.toBuffer(text, { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M" });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, png);
  await fs.promises.rename(temp, file);
  return `/uploads/${eventCode}/${name}`;
}

/** Deletes an earlier code this module made. Files an admin uploaded, whatever their name, are never touched. */
async function removeWifiQr(eventCode, sitePath) {
  const prefix = `/uploads/${eventCode}/${PREFIX}`;
  if (typeof sitePath !== "string" || !sitePath.startsWith(prefix)) return;
  const name = sitePath.slice(`/uploads/${eventCode}/`.length);
  if (!/^wifi-qr-[0-9a-f]{12}\.png$/.test(name)) return;
  await fs.promises.rm(path.join(config.uploadsDir, eventCode, name), { force: true });
}

module.exports = { payload, writeWifiQr, removeWifiQr };
