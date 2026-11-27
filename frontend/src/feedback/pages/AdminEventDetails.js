import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEvent, useEventPath } from "../../event/EventContext";
import api, { errorMessage, mediaUrl } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { useToast } from "../context/ToastContext";

// The event's content shown on the site, and the buttons of its home page menu. Saved in the event's database,
// the first load copies them from backend/events.json.

const SECTIONS = [
  {
    title: "Event",
    help: "The name is the browser tab title and the admin header. The tagline sits under the logo on the home page.",
    fields: [
      { key: "name", label: "Event name", required: true },
      { key: "website", label: "Event Website's Domain", type: "domain" },
      { key: "tagline", label: "Tagline", type: "textarea", help: "Press Enter to start a new line." },
      { key: "secondary", label: "Theme Colour", type: "color" },
    ],
  },
  {
    title: "Images and videos",
    help: "Upload a file, or enter a site path such as /events/aiu26/images/logo.png or a full URL.",
    media: true,
    fields: [
      // Images first, then the videos. A video field takes one format only, extension and mime are what its file picker
      // and the API accept.
      { key: "logo", label: "Logo", accept: "image", help: "Home page and admin sign in." },
      { key: "favicon", label: "Favicon", accept: "image", help: "Browser tab icon, a square PNG or ICO." },
      { key: "heroPoster", label: "Hero poster", accept: "image", help: "Shown while the hero video loads." },
      { key: "background", label: "Background", accept: "image", help: "Background of the Attendees and Wi-Fi pages." },
      { key: "venueLogo", label: "Venue logo", accept: "image", help: "Wi-Fi page." },
      { key: "heroVideoMp4", label: "Hero video, MP4", accept: "video", extension: ".mp4", mime: "video/mp4", help: "Home page background video. MP4 files only." },
      { key: "heroVideoWebm", label: "Hero video, WebM", accept: "video", extension: ".webm", mime: "video/webm", help: "Smaller copy of the hero video, used first where it plays. WebM files only." },
    ],
  },
  {
    title: "Wi-Fi",
    help: "Shown on the Wi-Fi Password page.",
    wifiQr: true,
    fields: [
      { key: "network", label: "Network name" },
      { key: "password", label: "Password" },
      {
        key: "security",
        label: "Security",
        type: "select",
        options: [
          ["WPA", "WPA, WPA2 or WPA3 (most networks)"],
          ["WEP", "WEP (old networks)"],
          ["nopass", "None, an open network"],
        ],
      },
      { key: "hidden", label: "Hidden network", type: "checkbox" },
    ],
  },
];

// wifiQr has no input and is never sent, the server makes the Wi-Fi QR code again when the network or password is saved.
const FIELD_KEYS = [...SECTIONS.flatMap((s) => s.fields.map((f) => f.key)), "wifiQr"];
const DEFAULT_ACCENT = "#278dff";
const ACCEPT = { image: "image/*,.ico,.svg", video: "video/mp4,video/webm,.mp4,.webm" };

// A menu item opens a page of this event (a path such as /feedback-form) or a web address. The default menu's website
// item uses "website", which follows the Website link below until the admin changes its address.
const LINK_KEYS = ["website"];
const CUSTOM = "__custom__";
const CUSTOM_PAGE = "__page__";
// The same rule the API checks, /speakers or /speakers/day-1.
const PAGE_PATH = /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

/** What the admin typed as a page of the event, with the leading / added and a trailing / dropped. */
function cleanPagePath(text) {
  const path = text.trim().replace(/\/+$/, "");
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

/** The path or web address an item opens, an event link shown by its current address. */
function targetAddress(target, links) {
  if (LINK_KEYS.includes(target)) return links[target] || "";
  return target;
}

/** A 400 body, { field: ["message"] }, as { field: "message" }. Empty for any other error. */
function fieldErrors(err) {
  const data = err?.response?.data;
  if (err?.response?.status !== 400 || !data || typeof data !== "object" || data.detail) return {};
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
}

/** The website is typed as a domain, www.example.com, and saved as https://www.example.com/. */
function toDomain(url) {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function toWebsiteUrl(domain) {
  const d = toDomain(domain);
  return d ? `https://${d}/` : "";
}

/** The form's values from the API, with the website as its domain. */
function pick(data) {
  const values = Object.fromEntries(FIELD_KEYS.map((k) => [k, data?.[k] ?? ""]));
  // The two Wi-Fi settings are not text, a choice that defaults to WPA and a yes or no.
  values.security = data?.security || "WPA";
  values.hidden = Boolean(data?.hidden);
  values.website = toDomain(values.website);
  return values;
}

// ------------------------------------------------------------------ Fields
function TextField({ id, field, value, error, onChange }) {
  const invalid = error ? " dlgfb-is-invalid" : "";
  if (field.type === "color") {
    return (
      <>
        <div className="dlgfb-ed-color">
          <input
            type="color"
            className="dlgfb-ed-color-swatch"
            aria-label={`${field.label} picker`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_ACCENT}
            onChange={(e) => onChange(e.target.value)}
          />
          <input id={id} className={`dlgfb-form-control${invalid}`} value={value} placeholder={DEFAULT_ACCENT} maxLength={7}
            onChange={(e) => onChange(e.target.value)} />
        </div>
        {error && <div className="dlgfb-invalid-feedback dlgfb-d-block">{error}</div>}
      </>
    );
  }
  if (field.type === "select") {
    return (
      <>
        <select id={id} className={`dlgfb-custom-select${invalid}`} value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          ))}
        </select>
        {error && <div className="dlgfb-invalid-feedback dlgfb-d-block">{error}</div>}
      </>
    );
  }
  if (field.type === "checkbox") {
    return (
      <>
        <label className="dlgfb-ed-check" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        </label>
        {error && <div className="dlgfb-invalid-feedback dlgfb-d-block">{error}</div>}
      </>
    );
  }
  if (field.type === "domain") {
    return (
      <>
        <div className={`dlgfb-ed-prefixed${invalid}`}>
          <span className="dlgfb-ed-prefix" aria-hidden="true">https://</span>
          <input id={id} type="text" inputMode="url" className={`dlgfb-form-control${invalid}`} value={value} maxLength={490}
            placeholder="www.your-event.com" autoComplete="off" spellCheck={false}
            onChange={(e) => onChange(e.target.value.replace(/^\s*https?:\/\//i, ""))} />
        </div>
        {error && <div className="dlgfb-invalid-feedback dlgfb-d-block">{error}</div>}
      </>
    );
  }
  const props = {
    id,
    className: `dlgfb-form-control${invalid}`,
    value,
    required: field.required,
    onChange: (e) => onChange(e.target.value),
  };
  return (
    <>
      {field.type === "textarea" ? (
        <textarea rows={3} maxLength={1000} {...props} />
      ) : (
        <input type={field.type === "url" ? "url" : "text"} placeholder={field.type === "url" ? "https://" : undefined}
          maxLength={field.type === "url" ? 500 : 255} {...props} />
      )}
      {error && <div className="dlgfb-invalid-feedback">{error}</div>}
    </>
  );
}

/** A path or URL with a preview, an Upload button that fills it in, and Remove. */
function MediaField({ id, field, value, error, onChange, dark = false }) {
  const notify = useToast();
  const fileRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const src = mediaUrl(value);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // The file picker already filters by type, but "All files" can be chosen in it, so the extension is checked here too.
    if (field.extension && !file.name.toLowerCase().endsWith(field.extension)) {
      notify(`Choose a ${field.extension} file. ${file.name} is not one.`, "warning", { title: "Wrong file type" });
      return;
    }
    const body = new FormData();
    body.append("kind", field.accept);
    if (field.extension) body.append("ext", field.extension);
    body.append("file", file);
    setProgress(0);
    try {
      const { data } = await api.post("/admin/uploads/", body, {
        onUploadProgress: (p) => p.total && setProgress(Math.round((p.loaded * 100) / p.total)),
      });
      onChange(data.url);
      notify(`${file.name} is uploaded. Save to use it on the site.`, "success", { title: "File uploaded" });
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Upload failed" });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="dlgfb-ed-media">
      <div className={`dlgfb-ed-preview${dark ? " dlgfb-ed-preview-dark" : ""}`}>
        {!src && <span>No {field.accept}</span>}
        {src && field.accept === "video" && <video key={src} src={src} muted playsInline controls preload="metadata" />}
        {src && field.accept !== "video" && <img key={src} src={src} alt={`${field.label} preview`} />}
      </div>
      <div className="dlgfb-ed-media-body">
        <label className="dlgfb-ed-label" htmlFor={id}>{field.label}</label>
        <input id={id} className={`dlgfb-form-control${error ? " dlgfb-is-invalid" : ""}`} value={value} maxLength={500}
          placeholder="Upload, or /events/... or https://..." onChange={(e) => onChange(e.target.value)} />
        {error && <div className="dlgfb-invalid-feedback">{error}</div>}
        {field.help && <small className="dlgfb-form-text dlgfb-text-muted">{field.help}</small>}
        <div className="dlgfb-ed-media-actions">
          <button type="button" className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-primary" disabled={progress !== null}
            onClick={() => fileRef.current?.click()}>
            {progress !== null && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            {progress !== null ? `Uploading ${progress}%` : value ? "Replace" : "Upload"}
          </button>
          {value && progress === null && (
            <button type="button" className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-light" onClick={() => onChange("")}>Remove</button>
          )}
          <input ref={fileRef} type="file" hidden accept={field.extension ? `${field.mime},${field.extension}` : ACCEPT[field.accept]} onChange={upload} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Menu items
const ICON_FIELD = { key: "icon", label: "Icon", accept: "image", help: "A square image. White on a transparent background suits the home page buttons." };

function MenuItemModal({ item, links, nextSort, onClose, onSaved }) {
  const notify = useToast();
  const eventPath = useEventPath();
  const isNew = !item;
  const target = item?.target ?? "";
  const isPage = isNew || target.startsWith("/");
  // An item opening an event link shows that link's current address.
  const linkKey = LINK_KEYS.includes(target) ? target : null;
  const linkUrl = linkKey ? links[linkKey] || "" : "";
  const [form, setForm] = useState({
    label: item?.label ?? "",
    icon: item?.icon ?? "",
    choice: isPage ? CUSTOM_PAGE : CUSTOM,
    url: isPage ? "" : linkKey ? linkUrl : target,
    page: isPage ? target : "",
    sort_order: String(item?.sort_order ?? nextSort),
    is_visible: item?.is_visible ?? true,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    let target;
    if (form.choice === CUSTOM) {
      target = form.url.trim();
      // Unchanged, the item keeps following the event link, so editing the Links section still updates it.
      if (linkKey && linkUrl && target === linkUrl) target = linkKey;
    } else {
      target = cleanPagePath(form.page);
      if (!PAGE_PATH.test(target)) {
        setErrors({ target: "Enter the page path, for example /speakers. Use letters, numbers, - and _ only." });
        return;
      }
    }
    const body = {
      label: form.label,
      icon: form.icon,
      target,
      sort_order: form.sort_order === "" ? 0 : form.sort_order,
      is_visible: form.is_visible,
    };
    setBusy(true);
    setErrors({});
    try {
      if (isNew) await api.post("/admin/menu-items/", body);
      else await api.patch(`/admin/menu-items/${item.id}/`, body);
      notify(`${body.label.trim()} is ${isNew ? "added to" : "updated on"} the home page menu.`, "success", {
        title: isNew ? "Menu item added" : "Menu item saved",
      });
      onSaved();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) notify(errorMessage(err), "danger", { title: "Not saved" });
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? "Add menu item" : "Edit menu item"}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="dlgfb-btn dlgfb-btn-light" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" form="menu-item-form" className="dlgfb-btn dlgfb-btn-primary" disabled={busy}>
            {busy && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            {isNew ? "Add item" : "Save item"}
          </button>
        </>
      }
    >
      <form id="menu-item-form" onSubmit={submit} noValidate>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="menu-label">Label</label>
          <input id="menu-label" className={`dlgfb-form-control${errors.label ? " dlgfb-is-invalid" : ""}`} maxLength={100}
            value={form.label} onChange={(e) => set("label")(e.target.value)} autoFocus />
          {errors.label && <div className="dlgfb-invalid-feedback">{errors.label}</div>}
        </div>
        <div className="dlgfb-form-group">
          <MediaField id="menu-icon" field={ICON_FIELD} value={form.icon} error={errors.icon} onChange={set("icon")} dark />
        </div>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="menu-target">Opens</label>
          <select id="menu-target" className="dlgfb-custom-select" value={form.choice} onChange={(e) => set("choice")(e.target.value)}>
            <option value={CUSTOM_PAGE}>Page of this event</option>
            <option value={CUSTOM}>Web address</option>
          </select>
          {form.choice === CUSTOM_PAGE && (
            <>
              <input className={`dlgfb-form-control dlgfb-mt-2${errors.target ? " dlgfb-is-invalid" : ""}`} placeholder="/speakers"
                aria-label="Page path" maxLength={200} value={form.page} onChange={(e) => set("page")(e.target.value)} />
              <small className="dlgfb-form-text dlgfb-text-muted">
                Opens {eventPath(cleanPagePath(form.page) || "/...")}. The page has to exist on the site, check it after saving.
              </small>
            </>
          )}
          {form.choice === CUSTOM && (
            <input type="url" className={`dlgfb-form-control dlgfb-mt-2${errors.target ? " dlgfb-is-invalid" : ""}`} placeholder="https://"
              aria-label="Web address" maxLength={500} value={form.url} onChange={(e) => set("url")(e.target.value)} />
          )}
          {errors.target && <div className="dlgfb-invalid-feedback dlgfb-d-block">{errors.target}</div>}
        </div>
        <div className="dlgfb-ed-modal-row">
          <div className="dlgfb-form-group dlgfb-mb-0">
            <label className="dlgfb-ed-label" htmlFor="menu-sort">Sort no.</label>
            <input id="menu-sort" type="number" min={0} max={9999} step={1}
              className={`dlgfb-form-control dlgfb-ed-sort-input${errors.sort_order ? " dlgfb-is-invalid" : ""}`}
              value={form.sort_order} onChange={(e) => set("sort_order")(e.target.value)} />
            {errors.sort_order && <div className="dlgfb-invalid-feedback">{errors.sort_order}</div>}
          </div>
          <label className="dlgfb-ed-check">
            <input type="checkbox" checked={form.is_visible} onChange={(e) => set("is_visible")(e.target.checked)} />
            <span>Show on the home page</span>
          </label>
        </div>
        <small className="dlgfb-form-text dlgfb-text-muted">Items are shown from the lowest sort no. to the highest.</small>
      </form>
    </Modal>
  );
}

function MenuItems({ items, links, onChanged }) {
  const notify = useToast();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sorts, setSorts] = useState({});

  useEffect(() => setSorts(Object.fromEntries(items.map((i) => [i.id, String(i.sort_order)]))), [items]);

  const patch = async (item, body, done) => {
    try {
      await api.patch(`/admin/menu-items/${item.id}/`, body);
      if (done) notify(done, "success");
      onChanged();
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Not saved" });
      setSorts((s) => ({ ...s, [item.id]: String(item.sort_order) }));
    }
  };

  const saveSort = (item) => {
    const text = (sorts[item.id] ?? "").trim();
    if (text === String(item.sort_order)) return;
    if (!/^\d{1,4}$/.test(text)) {
      notify("Enter a whole number from 0 to 9999.", "warning", { title: "Sort no. not saved" });
      setSorts((s) => ({ ...s, [item.id]: String(item.sort_order) }));
      return;
    }
    patch(item, { sort_order: Number(text) });
  };

  const remove = async () => {
    setDeleteBusy(true);
    try {
      await api.delete(`/admin/menu-items/${deleting.id}/`);
      notify(`${deleting.label} is removed from the home page menu.`, "success", { title: "Menu item deleted" });
      setDeleting(null);
      onChanged();
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Not deleted" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const nextSort = items.reduce((max, i) => Math.max(max, i.sort_order), 0) + 10;

  return (
    <section className="dlgfb-panel dlgfb-mb-3">
      <div className="dlgfb-section-head">
        <div>
          <h2 className="dlgfb-h5 dlgfb-mb-1">Home page menu</h2>
          <p className="dlgfb-panel-help dlgfb-mb-0">The buttons on the event home page, shown from the lowest sort no. to the highest.</p>
        </div>
        <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" onClick={() => setEditing("new")}>Add item</button>
      </div>

      <div className="dlgfb-table-card">
        <table className="dlgfb-table dlgfb-table-hover dlgfb-table-stack dlgfb-mb-0">
          <thead>
            <tr>
              <th>Sort no.</th>
              <th>Icon</th>
              <th>Label</th>
              <th>Opens</th>
              <th>Visible</th>
              <th className="dlgfb-text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr className="dlgfb-empty-row">
                <td colSpan={6} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">No menu items. Add one to show it on the home page.</td>
              </tr>
            )}
            {items.map((item) => {
              const missingLink = LINK_KEYS.includes(item.target) && !links[item.target];
              const icon = mediaUrl(item.icon);
              return (
                <tr key={item.id} className={item.is_visible ? undefined : "dlgfb-ed-row-hidden"}>
                  <td data-label="Sort no.">
                    <input type="number" min={0} max={9999} className="dlgfb-form-control dlgfb-ed-sort-input" aria-label={`Sort no. of ${item.label}`}
                      value={sorts[item.id] ?? ""} onChange={(e) => setSorts((s) => ({ ...s, [item.id]: e.target.value }))}
                      onBlur={() => saveSort(item)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
                  </td>
                  <td data-label="Icon">
                    <span className="dlgfb-ed-icon">{icon && <img src={icon} alt="" />}</span>
                  </td>
                  <td data-label="Label" className="dlgfb-font-weight-bold">{item.label}</td>
                  <td data-label="Opens" className="dlgfb-text-break">
                    {targetAddress(item.target, links)}
                    {missingLink && (
                      <span className="dlgfb-badge dlgfb-badge-pending dlgfb-ml-2" title="Fill in the link above to show this item">Link not set</span>
                    )}
                  </td>
                  <td data-label="Visible">
                    <label className="dlgfb-ed-check">
                      <input type="checkbox" checked={item.is_visible} aria-label={`Show ${item.label}`}
                        onChange={(e) => patch(item, { is_visible: e.target.checked })} />
                      <span>{item.is_visible ? "Shown" : "Hidden"}</span>
                    </label>
                  </td>
                  <td className="dlgfb-text-right dlgfb-text-nowrap dlgfb-actions-cell">
                    <button type="button" className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-light dlgfb-mr-2" onClick={() => setEditing(item)}>Edit</button>
                    <button type="button" className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-danger" onClick={() => setDeleting(item)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <MenuItemModal
          item={editing === "new" ? null : editing}
          links={links}
          nextSort={nextSort}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete menu item" confirmLabel="Delete" busy={deleteBusy} onConfirm={remove} onCancel={() => setDeleting(null)}>
          Delete <strong>{deleting.label}</strong> from the home page menu. To keep it for later, untick Visible instead.
        </ConfirmDialog>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Page
export default function AdminEventDetails() {
  const notify = useToast();
  const { reload } = useEvent();
  const eventPath = useEventPath();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [menu, setMenu] = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/event-details/");
      setSaved(pick(data));
      setForm(pick(data));
      setMenu(data.menu || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMenu = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/menu-items/");
      setMenu(data);
    } catch (err) {
      notify(errorMessage(err), "danger");
    }
    reload();
  }, [notify, reload]);

  const dirty = useMemo(() => Boolean(form && saved && FIELD_KEYS.some((k) => form[k] !== saved[k])), [form, saved]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const save = async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(FIELD_KEYS.filter((k) => form[k] !== saved[k]).map((k) => [k, form[k]]));
    if ("website" in changes) changes.website = toWebsiteUrl(changes.website);
    setSaving(true);
    try {
      const { data } = await api.patch("/admin/event-details/", changes);
      setSaved(pick(data));
      setForm(pick(data));
      setErrors({});
      notify(
        data.qr_updated ? "The event pages now show the new details, and the Wi-Fi QR code was made again." : "The event pages now show the new details.",
        "success",
        { title: "Event details saved" }
      );
      if (data.qr_updated === false) notify("The Wi-Fi QR code could not be made. Save again to retry.", "warning", { title: "QR code not updated" });
      reload();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      const count = Object.keys(fields).length;
      notify(count ? `Check the ${count === 1 ? "highlighted field" : `${count} highlighted fields`}.` : errorMessage(err), "danger", {
        title: "Not saved",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="dlgfb-panel">
        <p className="dlgfb-mb-2">{loadError}</p>
        <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="dlgfb-panel dlgfb-skeleton-panel">
        <div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-50" />
        <div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-75" />
      </div>
    );
  }

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Event Details</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">What attendees see on the event pages. Saved changes show on the site straight away.</p>
        </div>
        <a className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-primary" href={eventPath("")} target="_blank" rel="noopener noreferrer">
          View home page
        </a>
      </div>

      <form onSubmit={save} noValidate>
        {SECTIONS.map((section) => (
          <section key={section.title} className="dlgfb-panel dlgfb-mb-3">
            <h2 className="dlgfb-h5 dlgfb-mb-1">{section.title}</h2>
            <p className="dlgfb-panel-help">{section.help}</p>
            <div className={section.media ? "dlgfb-ed-media-grid" : "dlgfb-ed-grid"}>
              {section.fields.map((field) => {
                const id = `event-${field.key}`;
                if (section.media) {
                  return (
                    <MediaField key={field.key} id={id} field={field} value={form[field.key]} error={errors[field.key]} onChange={set(field.key)} />
                  );
                }
                return (
                  <div key={field.key} className={`dlgfb-form-group dlgfb-mb-0${field.type === "textarea" ? " dlgfb-ed-wide" : ""}`}>
                    <label className="dlgfb-ed-label" htmlFor={id}>
                      {field.label}
                      {field.required && <span className="dlgfb-text-danger" aria-hidden="true"> *</span>}
                    </label>
                    <TextField id={id} field={field} value={form[field.key]} error={errors[field.key]} onChange={set(field.key)} />
                    {field.help && <small className="dlgfb-form-text dlgfb-text-muted">{field.help}</small>}
                  </div>
                );
              })}
            </div>
            {section.wifiQr && (
              <div className="dlgfb-ed-qr-row">
                <div className="dlgfb-ed-preview dlgfb-ed-qr-current">
                  {saved.wifiQr ? <img key={saved.wifiQr} src={mediaUrl(saved.wifiQr)} alt="Current Wi-Fi QR code" /> : <span>No QR code</span>}
                </div>
                <div className="dlgfb-ed-qr-actions">
                  <span className="dlgfb-ed-label dlgfb-mb-0">Wi-Fi QR code</span>
                  <small className="dlgfb-text-muted">
                    Made again by itself from the network name, password, security and hidden setting whenever you save a change to any of them.
                  </small>
                </div>
              </div>
            )}
          </section>
        ))}

        <div className={`dlgfb-ed-savebar${dirty ? " dlgfb-ed-savebar-dirty" : ""}`}>
          <span className="dlgfb-ed-savebar-text">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
          <button type="button" className="dlgfb-btn dlgfb-btn-light" disabled={!dirty || saving}
            onClick={() => {
              setForm(saved);
              setErrors({});
            }}>
            Discard
          </button>
          <button type="submit" className="dlgfb-btn dlgfb-btn-primary" disabled={!dirty || saving}>
            {saving && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            Save changes
          </button>
        </div>
      </form>

      <MenuItems items={menu} links={{ website: toWebsiteUrl(saved.website) }} onChanged={loadMenu} />
    </>
  );
}
