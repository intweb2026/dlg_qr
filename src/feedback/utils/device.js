import { eventKey, getEventCode } from "../api";

// Every key includes the event code, so submitting feedback for one event leaves the others open on this device.
const submittedKey = () => eventKey("submission_status");
const cookieName = () => `submission_status_${getEventCode()}`;
const entryKey = () => eventKey("draw_entry_number");

export function hasSubmittedOnDevice() {
  try {
    if (localStorage.getItem(submittedKey()) === "true") return true;
  } catch (e) {
    /* storage blocked, fall back to cookie */
  }
  return document.cookie.split(";").some((c) => c.trim() === `${cookieName()}=true`);
}

// The draw number is kept on the device, so it can be shown again after a refresh.
export function saveEntryNumber(id) {
  try {
    localStorage.setItem(entryKey(), String(id));
  } catch (e) {
    /* ignore */
  }
}

export function readEntryNumber() {
  try {
    const value = localStorage.getItem(entryKey());
    return value && /^\d+$/.test(value) ? Number(value) : null;
  } catch (e) {
    return null;
  }
}

export function markSubmittedOnDevice() {
  try {
    localStorage.setItem(submittedKey(), "true");
  } catch (e) {
    /* ignore */
  }
  document.cookie = `${cookieName()}=true; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
}
