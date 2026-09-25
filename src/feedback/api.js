import axios from "axios";

export const TOKEN_KEY = "adminToken";
export const UNAUTHORIZED_EVENT = "admin:unauthorized";

// Public endpoints never carry the admin token, so a stale token cannot break the attendee form.
const PUBLIC_PATHS = ["/form-status/", "/attendees/", "/feedback/submit/", "/auth/login/"];

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:8000/api",
  withCredentials: true, // lets the backend set the submission_status cookie
});

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token && !PUBLIC_PATHS.includes(config.url)) config.headers.Authorization = `Token ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !PUBLIC_PATHS.includes(err.config?.url)) {
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
