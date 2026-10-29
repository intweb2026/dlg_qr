import axios from "axios";

export const UNAUTHORIZED_EVENT = "admin:unauthorized";

// Public endpoints never carry the admin token, so a stale token cannot break the attendee form or the lucky draw.
const PUBLIC_PATHS = [
  "/",
  "/form-status/",
  "/attendees/",
  "/registered-attendees/",
  "/feedback/submit/",
  "/auth/login/",
  "/lucky-draw/pool/",
  "/lucky-draw/spin/",
  "/lucky-draw/reveal/",
  "/lucky-draw/winners/",
];

// The event whose API every call goes to, set by EventProvider from the code in the address.
let eventCode = null;

export function setEventCode(code) {
  eventCode = code;
}

export function getEventCode() {
  return eventCode;
}

/** Browser storage key for this event, so each event keeps its own sign in, submission and draw state. */
export function eventKey(name) {
  return `${name}:${eventCode}`;
}

export const tokenKey = () => eventKey("adminToken");

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:8000/api",
  withCredentials: true,
});

function readToken() {
  try {
    return localStorage.getItem(tokenKey());
  } catch (e) {
    return null;
  }
}

// Paths are written without the event, for example "/form-status/", and sent to /events/<code>/form-status/.
api.interceptors.request.use((config) => {
  config.path = config.url;
  config.url = `/events/${encodeURIComponent(eventCode)}${config.url}`;
  const token = readToken();
  if (token && !PUBLIC_PATHS.includes(config.path)) config.headers.Authorization = `Token ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !PUBLIC_PATHS.includes(err.config?.path)) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(err);
  }
);

export function errorMessage(err, fallback = "Something went wrong, try again.") {
  const data = err?.response?.data;
  if (!err?.response) return "Cannot reach the server, check that the backend is running.";
  if (typeof data === "string") return fallback;
  if (data?.detail) return data.detail;
  if (data && typeof data === "object") {
    const first = Object.values(data)[0];
    if (Array.isArray(first)) return first[0];
    if (typeof first === "string") return first;
  }
  return fallback;
}

export function padId(id, length) {
  return String(id).padStart(length || 2, "0");
}

export default api;
