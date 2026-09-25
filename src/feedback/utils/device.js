const KEY = "submission_status";

export function hasSubmittedOnDevice() {
  try {
    if (localStorage.getItem(KEY) === "true") return true;
  } catch (e) {
    /* storage blocked, fall back to cookie */
  }
  return document.cookie.split(";").some((c) => c.trim() === `${KEY}=true`);
}

const ENTRY_KEY = "draw_entry_number";

// The draw number is kept on the device, so it can be shown again after a refresh.
export function saveEntryNumber(id) {
  try {
    localStorage.setItem(ENTRY_KEY, String(id));
  } catch (e) {
    /* ignore */
  }
}

export function readEntryNumber() {
  try {
    const value = localStorage.getItem(ENTRY_KEY);
    return value && /^\d+$/.test(value) ? Number(value) : null;
  } catch (e) {
    return null;
  }
}

export function markSubmittedOnDevice() {
  try {
    localStorage.setItem(KEY, "true");
  } catch (e) {
    /* ignore */
  }
  document.cookie = `${KEY}=true; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
}
