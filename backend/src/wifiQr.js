const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const config = require("./config");

// The Wi-Fi QR code made by the server, so it follows the network when the admin or the support user changes it.
// It is the standard Wi-Fi text phones read when the camera scans it,
//   WIFI:T:WPA;S:<network>;P:<password>;H:true;;   with  ; , : and " escaped by a backslash.
// T is the security the admin chose on the Event Details page, WPA (WPA, WPA2 and WPA3), WEP or nopass for an open
// network, and H:true is written only for a hidden network. A blank password is always an open network.

const PREFIX = "wifi-qr-";

function escape(text) {
  return String(text).replace(/([\\;,:"])/g, "\\$1");
}

function payload({ network, password, security = "WPA", hidden = false }) {
  const open = !password || security === "nopass";
  const parts = [`T:${open ? "nopass" : security}`, `S:${escape(network)}`];
  if (!open) parts.push(`P:${escape(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

/**
 * Writes the QR code of the network and password to the event's uploads folder and returns its site path, such as
 * /uploads/aiu26/wifi-qr-1a2b3c4d5e6f.png. The name comes from the content, so the same details give the same file and a
 * browser never shows an older picture for new details.
 */
async function writeWifiQr(eventCode, { network, password, security, hidden }) {
  const text = payload({ network, password, security, hidden });
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

/**
 * True when the event has a network name but no usable QR code, none saved or an uploaded one whose file is gone, for
 * example after a redeploy wiped the disk. A path in the site or a web address is not checked.
 */
async function isMissing(eventCode, row) {
  if (!row.wifi_network) return false;
  if (!row.wifi_qr) return true;
  const prefix = `/uploads/${eventCode}/`;
  if (!row.wifi_qr.startsWith(prefix)) return false;
  const name = row.wifi_qr.slice(prefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
  return fs.promises.access(path.join(config.uploadsDir, eventCode, name)).then(() => false, () => true);
}

module.exports = { payload, writeWifiQr, isMissing };

