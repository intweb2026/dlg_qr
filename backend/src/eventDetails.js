const { query, transaction } = require("./db");
const { isoDate } = require("./utils");
const v = require("./validation");

// The event's name, tagline, colour, media, links and Wi-Fi, edited on the admin Event Details page and kept in the
// event_details table of the event's own database. The first read copies them from the event's entry in events.json,
// together with the default home page menu, so an event looks the same before and after an admin edits it.
// The site receives them in the same shape as events.json, { name, tagline, theme, media, links, wifi }.

// key is the name used by the admin page, group the object it sits in on the site config, column the table column.
const DETAIL_FIELDS = [
  { key: "name", column: "name", kind: "text", max: 255, required: true },
  { key: "tagline", column: "tagline", kind: "text", max: 1000 },
  { key: "secondary", column: "secondary_color", group: "theme", kind: "color" },
  { key: "logo", column: "logo", group: "media", kind: "media" },
  { key: "favicon", column: "favicon", group: "media", kind: "media" },
  { key: "heroVideoMp4", column: "hero_video_mp4", group: "media", kind: "media" },
  { key: "heroVideoWebm", column: "hero_video_webm", group: "media", kind: "media" },
  { key: "heroPoster", column: "hero_poster", group: "media", kind: "media" },
  { key: "background", column: "background", group: "media", kind: "media" },
  { key: "venueLogo", column: "venue_logo", group: "media", kind: "media" },
  { key: "wifiQr", column: "wifi_qr", group: "media", kind: "media" },
  { key: "website", column: "website_url", group: "links", kind: "url" },
  { key: "network", column: "wifi_network", group: "wifi", kind: "text", max: 255 },
  { key: "password", column: "wifi_password", group: "wifi", kind: "text", max: 255 },
  // How the Wi-Fi QR code joins the network, see wifiQr.js. WPA covers WPA, WPA2 and WPA3, nopass is an open network.
  { key: "security", column: "wifi_security", group: "wifi", kind: "choice", choices: ["WPA", "WEP", "nopass"], fallback: "WPA" },
  { key: "hidden", column: "wifi_hidden", group: "wifi", kind: "bool" },
];

// The menu every event starts with. A target starting with / is a page of the event, "website" opens the event's
// website link, anything else is a full URL. fromLinks items take their address from that key of the event's "links"
// in events.json, and are left out when it has none.
const DEFAULT_MENU = [
  { label: "Explore the Agenda", icon: "/common/images/menu/agenda.svg", fromLinks: "agenda" },
  { label: "Registered Attendees", icon: "/common/images/menu/attendees.svg", target: "/registered-attendees" },
  { label: "Feedback Form", icon: "/common/images/menu/feedback.svg", target: "/feedback-form" },
  { label: "Wi-Fi Password", icon: "/common/images/menu/wifi.svg", target: "/wifipassword" },
  { label: "Connect on LinkedIn", icon: "/common/images/menu/linkedin.svg", fromLinks: "linkedin" },
  { label: "Visit the Event Website", icon: "/common/images/menu/website.svg", target: "website" },
];

/** The default menu for an event, with the agenda and LinkedIn addresses from events.json. */
function defaultMenu(event) {
  return DEFAULT_MENU.map(({ fromLinks, ...item }) => {
    if (!fromLinks) return item;
    const url = String(event?.links?.[fromLinks] || "").trim();
    return isHttpUrl(url) ? { ...item, target: url } : null;
  }).filter(Boolean);
}

const LINK_KEYS = ["website"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SITE_PATH = /^\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*$/;
const MENU_PAGE = /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

function isHttpUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** A blank value, a full http(s) URL, or with allowPath a path on the site such as /events/aiu26/images/logo.png. */
function cleanLink(value, { allowPath = false } = {}) {
  const text = v.string(value, { maxLength: 500, allowBlank: true });
  if (!text) return "";
  if (allowPath && SITE_PATH.test(text) && !text.startsWith("//")) return text;
  if (isHttpUrl(text)) return text;
  throw new v.FieldError(allowPath ? "Enter a path starting with / or a full URL starting with https://." : "Enter a full URL starting with https://.");
}

function cleanDetail(field, value) {
  if (field.kind === "choice") return v.choice(value, field.choices);
  if (field.kind === "bool") {
    if (typeof value !== "boolean") throw new v.FieldError("Must be a valid boolean.");
    return value;
  }
  if (field.kind === "media") return cleanLink(value, { allowPath: true });
  if (field.kind === "url") return cleanLink(value);
  if (field.kind === "color") {
    const text = v.string(value, { maxLength: 7, allowBlank: true });
    if (text && !HEX_COLOR.test(text)) throw new v.FieldError("Enter a colour like #278dff.");
    return text.toLowerCase();
  }
  return v.string(value, { maxLength: field.max, allowBlank: !field.required, blankMessage: "Enter the event name." });
}

const DETAIL_INPUT = Object.fromEntries(
  DETAIL_FIELDS.map((f) => [f.key, { required: f.required, clean: (value) => cleanDetail(f, value) }])
);

/** The values events.json gives an event, used once to fill its event_details row. */
function seedValues(event) {
  const values = {};
  for (const f of DETAIL_FIELDS) {
    const raw = f.group ? event?.[f.group]?.[f.key] : event?.[f.key];
    if (f.kind === "bool") values[f.column] = raw === true ? 1 : 0;
    else if (f.kind === "choice") values[f.column] = f.choices.includes(raw) ? raw : f.fallback;
    else values[f.column] = typeof raw === "string" ? raw.trim() : "";
  }
  if (!values.name) values.name = event?.code || "";
  return values;
}

/** The event_details row, created from events.json together with the default menu when the event has none yet. */
async function loadDetailsRow(event) {
  const [row] = await query("SELECT * FROM event_details WHERE id = 1");
  if (row) return row;
  await transaction(async (q) => {
    const values = seedValues(event);
    const columns = Object.keys(values);
    const inserted = await q(
      `INSERT IGNORE INTO event_details (id, ${columns.map((c) => `\`${c}\``).join(", ")}, updated_at)
       VALUES (1, ${columns.map(() => "?").join(", ")}, UTC_TIMESTAMP(6))`,
      Object.values(values)
    );
    // Another request created the row first, it added the menu too.
    if (!inserted.affectedRows) return;
    const [{ n }] = await q("SELECT COUNT(*) AS n FROM menu_items");
    if (n) return;
    for (const [i, item] of defaultMenu(event).entries()) {
      await q(
        "INSERT INTO menu_items (label, icon, target, sort_order, is_visible, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [item.label, item.icon, item.target, (i + 1) * 10]
      );
    }
  });
  const [created] = await query("SELECT * FROM event_details WHERE id = 1");
  return created;
}

/** The admin page's flat shape, { name, tagline, secondary, logo, ..., password, updated_at }. */
function detailsJson(row) {
  const json = Object.fromEntries(
    DETAIL_FIELDS.map((f) => [
      f.key,
      f.kind === "bool" ? Boolean(row[f.column]) : f.kind === "choice" ? row[f.column] || f.fallback : row[f.column] ?? "",
    ])
  );
  json.updated_at = isoDate(row.updated_at);
  return json;
}

/**
 * The event with its saved details in place of the ones from events.json. Keys events.json has that the admin page
 * does not manage, such as media.successIcon or links.agendaApi, are kept. Blank values are left out.
 */
function mergeDetails(event, row) {
  const merged = { ...event };
  const groups = {};
  for (const f of DETAIL_FIELDS) {
    if (f.group && !groups[f.group]) {
      groups[f.group] = { ...(event[f.group] || {}) };
      for (const g of DETAIL_FIELDS) if (g.group === f.group) delete groups[f.group][g.key];
    }
    const value = row[f.column];
    if (f.group) {
      if (value) groups[f.group][f.key] = value;
    } else if (value) merged[f.key] = value;
    else delete merged[f.key];
  }
  for (const [group, values] of Object.entries(groups)) {
    if (Object.keys(values).length) merged[group] = values;
    else delete merged[group];
  }
  return merged;
}

async function withEventDetails(event) {
  return mergeDetails(event, await loadDetailsRow(event));
}

async function saveDetails(event, data) {
  await loadDetailsRow(event);
  const { values, errors } = await v.validate(data, DETAIL_INPUT, { partial: true });
  if (errors) throw new v.ValidationError(errors);
  const fields = DETAIL_FIELDS.filter((f) => f.key in values);
  if (fields.length) {
    await query(
      `UPDATE event_details SET ${fields.map((f) => `\`${f.column}\` = ?`).join(", ")}, updated_at = UTC_TIMESTAMP(6) WHERE id = 1`,
      fields.map((f) => (typeof values[f.key] === "boolean" ? Number(values[f.key]) : values[f.key]))
    );
  }
  const [row] = await query("SELECT * FROM event_details WHERE id = 1");
  return row;
}

/**
 * Databases made before the agenda and LinkedIn links left the Links section have agenda_url and linkedin_url columns,
 * and menu items whose target is "agenda" or "linkedin". The items get the address itself, or are deleted when it is
 * blank since they had nothing to open, then the columns are dropped. Run by migrate, does nothing the second time.
 */
async function moveLinksIntoMenu({ log = () => {} } = {}) {
  for (const [key, column] of [["agenda", "agenda_url"], ["linkedin", "linkedin_url"]]) {
    const found = await query(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_details' AND COLUMN_NAME = ?",
      [column]
    );
    if (!found.length) continue;
    const [row] = await query(`SELECT \`${column}\` AS url FROM event_details WHERE id = 1`);
    const url = row?.url || "";
    if (url) {
      const r = await query("UPDATE menu_items SET target = ?, updated_at = UTC_TIMESTAMP(6) WHERE target = ?", [url, key]);
      if (r.affectedRows) log(`menu items opening ${key} now open ${url}.`);
    } else {
      const r = await query("DELETE FROM menu_items WHERE target = ?", [key]);
      if (r.affectedRows) log(`deleted ${r.affectedRows} menu item(s) opening ${key}, it had no address.`);
    }
    await query(`ALTER TABLE event_details DROP COLUMN \`${column}\``);
    log(`dropped event_details.${column}.`);
  }
}

// Media moved to frontend/public/events/<code>/{images,videos}/ and frontend/public/common/images/, with the event name dropped from the
// file names. Databases made before still hold the old paths. A path starting with "from" now starts with "to".
// Remove this list and movePublicMedia once every database has run npm run migrate.
const MOVED_MEDIA = [
  ["/images/common/", "/common/images/"],
  ["/images/aiu26/aiu_logo_fig.png", "/events/aiu26/images/logo_fig.png"],
  ["/images/aiu26/aiu_logo.png", "/events/aiu26/images/logo.png"],
  ["/images/aiu26/aiu_hero_poster.jpeg", "/events/aiu26/images/hero_poster.jpeg"],
  ["/images/aiu26/aiu_pattern.png", "/events/aiu26/images/pattern.png"],
  ["/images/aiu26/dlg_hotel.png", "/events/aiu26/images/venue_logo.png"],
  ["/images/aiu26/dlg_wifi_qr.jpeg", "/events/aiu26/images/wifi_qr.jpeg"],
  ["/images/aiu26/favicon_aiu26.png", "/events/aiu26/images/favicon.png"],
  ["/videos/aiu26/aiu_video.mp4", "/events/aiu26/videos/video.mp4"],
  ["/videos/aiu26/aiu_video.webm", "/events/aiu26/videos/video.webm"],
];

/** Rewrites the old media paths saved in the event details and the menu icons. Run by migrate, safe to run again. */
async function movePublicMedia({ log = () => {} } = {}) {
  const places = [
    ...DETAIL_FIELDS.filter((f) => f.kind === "media").map((f) => ["event_details", f.column]),
    ["menu_items", "icon"],
  ];
  let changed = 0;
  for (const [from, to] of MOVED_MEDIA) {
    for (const [table, column] of places) {
      const r = await query(
        `UPDATE \`${table}\` SET \`${column}\` = CONCAT(?, SUBSTRING(\`${column}\`, ?)) WHERE LEFT(\`${column}\`, ?) = ?`,
        [to, from.length + 1, from.length, from]
      );
      changed += r.affectedRows;
    }
  }
  if (changed) log(`moved ${changed} media path(s) to frontend/public/events and frontend/public/common.`);
}

// ------------------------------------------------------------------ Menu items
function cleanTarget(value) {
  const text = v.string(value, { maxLength: 500, blankMessage: "Choose what the button opens." });
  if (LINK_KEYS.includes(text) || MENU_PAGE.test(text) || isHttpUrl(text)) return text;
  throw new v.FieldError("Enter a page path such as /feedback-form, or a full URL starting with https://.");
}

const MENU_INPUT = {
  label: { required: true, requiredMessage: "Enter the button label.", clean: (value) => v.string(value, { maxLength: 100, blankMessage: "Enter the button label." }) },
  icon: { default: "", clean: (value) => cleanLink(value, { allowPath: true }) },
  target: { required: true, requiredMessage: "Choose what the button opens.", clean: cleanTarget },
  sort_order: { default: 0, clean: (value) => v.integer(value, { min: 0, max: 9999 }) },
  is_visible: {
    default: true,
    clean(value) {
      if (typeof value !== "boolean") throw new v.FieldError("Must be a valid boolean.");
      return value;
    },
  },
};

function menuItemJson(row) {
  return {
    id: row.id,
    label: row.label,
    icon: row.icon,
    target: row.target,
    sort_order: row.sort_order,
    is_visible: Boolean(row.is_visible),
  };
}

async function menuItems({ visibleOnly = false } = {}) {
  const rows = await query(
    `SELECT * FROM menu_items ${visibleOnly ? "WHERE is_visible = 1" : ""} ORDER BY sort_order, id`
  );
  return rows.map(menuItemJson);
}

async function getMenuItem(id) {
  const [row] = await query("SELECT * FROM menu_items WHERE id = ?", [id]);
  return row || null;
}

async function createMenuItem(data) {
  const { values, errors } = await v.validate(data, MENU_INPUT);
  if (errors) throw new v.ValidationError(errors);
  const r = await query(
    "INSERT INTO menu_items (label, icon, target, sort_order, is_visible, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
    [values.label, values.icon, values.target, values.sort_order, values.is_visible ? 1 : 0]
  );
  return menuItemJson(await getMenuItem(r.insertId));
}

async function updateMenuItem(id, data) {
  const { values, errors } = await v.validate(data, MENU_INPUT, { partial: true });
  if (errors) throw new v.ValidationError(errors);
  const keys = Object.keys(values);
  if (keys.length) {
    await query(
      `UPDATE menu_items SET ${keys.map((k) => `\`${k}\` = ?`).join(", ")}, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [...keys.map((k) => (k === "is_visible" ? (values[k] ? 1 : 0) : values[k])), id]
    );
  }
  return menuItemJson(await getMenuItem(id));
}

module.exports = {
  DETAIL_FIELDS,
  DEFAULT_MENU,
  loadDetailsRow,
  moveLinksIntoMenu,
  movePublicMedia,
  detailsJson,
  mergeDetails,
  withEventDetails,
  saveDetails,
  menuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
};
