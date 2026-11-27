import { useCallback } from "react";
import { useEvent } from "../../event/EventContext";

/**
 * Every time in the admin panel is shown in the event's time zone, with the zone's short name, "Nov 25, 2026, 2:08 PM PST",
 * so the times on one screen, and on every screen, can be compared. The times come from the API in UTC. When the event's
 * time zone is not known the browser's zone is used, and its short name is still shown.
 */
export function formatEventTime(iso, timeZone, { seconds = false } = {}) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const options = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    timeZoneName: "short",
  };
  try {
    return date.toLocaleString(undefined, timeZone ? { ...options, timeZone } : options);
  } catch {
    return date.toLocaleString(undefined, options);
  }
}

/** The event's time zone name, "America/Los_Angeles", or "" when it is not known. */
export function useEventTimeZone() {
  return useEvent().config.event_time_zone || "";
}

/** A function that formats an ISO time in the event's time zone, see formatEventTime. */
export function useEventTime() {
  const zone = useEventTimeZone();
  return useCallback((iso, options) => formatEventTime(iso, zone || null, options), [zone]);
}
