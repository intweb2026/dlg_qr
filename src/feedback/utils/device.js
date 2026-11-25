import { eventKey, getEventCode } from "../api";

// Every key includes the event code, so submitting feedback for one event leaves the others open on this device.
const submittedKey = () => eventKey("submission_status");
const cookieName = () => `submission_status_${getEventCode()}`;
const entryKey = () => eventKey("draw_entry_number");
const holderKey = () => eventKey("draw_entry_holder");

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

// The name and company on the ticket, the alias confirmed on the form, kept beside the number for the same reason.
export function saveEntryHolder(holder) {
  try {
    localStorage.setItem(holderKey(), JSON.stringify({ name: holder.name || "", company: holder.company || "" }));
  } catch (e) {
    /* ignore */
  }
}

export function readEntryHolder() {
  try {
    const holder = JSON.parse(localStorage.getItem(holderKey()) || "null");
    return holder && typeof holder === "object" ? { name: String(holder.name || ""), company: String(holder.company || "") } : null;
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
