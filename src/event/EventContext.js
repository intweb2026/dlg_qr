import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import api, { setEventCode } from "../feedback/api";

// The event comes from the first part of the address, /dle26/feedback-form is event dle26.
// Its config (name, media, links, Wi-Fi, theme) is loaded once from the API, see backend/events.json.
// media.favicon is the browser tab icon and theme.secondary the accent colour, both optional.
const EventContext = createContext(null);

export function useEvent() {
  return useContext(EventContext);
}

const THEME_VARS = ["--theme-secondary", "--theme-secondary-rgb", "--theme-secondary-dark"];

/** Sets the event's theme.secondary on the page, the defaults in index.css stay when the event has none. */
function applyTheme(theme) {
  const root = document.documentElement.style;
  THEME_VARS.forEach((name) => root.removeProperty(name));
  const hex = theme?.secondary;
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // The hover shade, about 10% darker.
  const dark = rgb.map((c) => Math.round(c * 0.88).toString(16).padStart(2, "0")).join("");
  root.setProperty("--theme-secondary", hex);
  root.setProperty("--theme-secondary-rgb", rgb.join(", "));
  root.setProperty("--theme-secondary-dark", `#${dark}`);
}

/** Uses the event's media.favicon as the browser tab icon, or removes it when the event has none. */
function applyFavicon(href) {
  let link = document.querySelector("link[rel='icon']");
  if (!href) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

/** Address inside the current event, eventPath("/feedback-form") -> "/dle26/feedback-form". */
export function useEventPath() {
  const { code } = useEvent();
  return (path = "") => `/${code}${path}`;
}

function EventMessage({ title, text }) {
  return (
    <main className="event-status">
      <h1 className="event-status__title">{title}</h1>
      {text && <p className="event-status__text">{text}</p>}
    </main>
  );
}

/** Loads the event named in the address and renders its pages, or a message when there is no such event. */
export default function EventLayout() {
  const code = useParams().eventCode.toLowerCase();
  const [state, setState] = useState({ status: "loading", config: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", config: null });
    setEventCode(code);
    api
      .get("/")
      .then(({ data }) => !cancelled && setState({ status: "ready", config: data }))
      .catch((err) => {
        // Only the API's own answer means the code is wrong, any other failure (offline, an older API) is a load error.
        const missing = err?.response?.status === 404 && err.response.data?.detail === "Event not found.";
        if (!cancelled) setState({ status: missing ? "missing" : "error", config: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (state.config) document.title = state.config.name || code;
  }, [state.config, code]);

  useEffect(() => {
    applyTheme(state.config?.theme);
    applyFavicon(state.config?.media?.favicon);
    return () => {
      applyTheme(null);
      applyFavicon(null);
    };
  }, [state.config]);

  if (state.status === "loading") return null;
  if (state.status === "missing") return <EventMessage title="Event not found" text="Check the address and try again." />;
  if (state.status === "error") {
    return <EventMessage title="Cannot load this event" text="Check your connection and refresh the page." />;
  }
  return (
    <EventContext.Provider value={{ code, config: state.config }}>
      <Outlet />
    </EventContext.Provider>
  );
}
