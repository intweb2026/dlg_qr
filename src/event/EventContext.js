import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import api, { setEventCode } from "../feedback/api";

// The event comes from the first part of the address, /dle26/feedback-form is event dle26.
// Its config (name, media, links, Wi-Fi) is loaded once from the API, see backend/events.json.
const EventContext = createContext(null);

export function useEvent() {
  return useContext(EventContext);
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
