// Everything the feedback form and admin need, loaded as one separate bundle the first time one of
// their routes is opened (see src/index.js). Visitors who only use the event pages never download it.
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEventPath } from "../event/EventContext";
import { useAuth } from "./context/AuthContext";
import { homePage } from "./utils/roles";
import RequireAdmin from "./components/RequireAdmin";
import AdminLayout from "./components/AdminLayout";
import LuckyDraw, { DRAW_THEME } from "./pages/LuckyDraw";

export { default as FeedbackShell } from "./FeedbackShell";
export { default as FeedbackForm } from "./pages/FeedbackForm";
export { default as AdminLogin } from "./pages/AdminLogin";
export { default as AdminSubmissions } from "./pages/AdminSubmissions";
export { LuckyDraw };
export { default as AdminAttendees } from "./pages/AdminAttendees";
export { default as AdminEventDetails } from "./pages/AdminEventDetails";
export { default as AdminLogbook } from "./pages/AdminLogbook";
export { default as AdminUsers } from "./pages/AdminUsers";
export { default as AdminWifi } from "./pages/AdminWifi";
export { default as NotFound } from "./pages/NotFound";

// /admin on its own opens the account's own first screen, Submissions for an admin and Wi-Fi for a support user.
export function AdminHome() {
  const { user } = useAuth();
  const eventPath = useEventPath();
  return <Navigate to={eventPath(homePage(user?.role))} replace />;
}

export function AdminArea() {
  return (
    <RequireAdmin>
      <AdminLayout />
    </RequireAdmin>
  );
}

// The lucky draw on its own at /raffle-draw, without the admin menu, for the screen at the venue.
// The draw API is public, so no sign in is needed here.
// It opens on a black welcome screen with a RAFFLE DRAW heading, the event name and a start button. Browsers only
// allow full screen after a click, so the button click switches to full screen and then shows the draw.
// How long the banner's exit runs after Are We Ready?, kept the same as dlgfbIntroOut in styles.css.
const INTRO_EXIT_MS = 650;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `length` random letters and digits. */
function randomText(length) {
  const bytes = new Uint8Array(length);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * A long random look-alike query string, 5 to 8 keys such as ?x4f=q8w3...&m2k=7ab1..., each with a random name and a value
 * of 20 to 32 characters. It carries no meaning and nothing reads it.
 */
function randomQuery() {
  const count = 5 + Math.floor(Math.random() * 4); // 5 to 8
  const params = new URLSearchParams();
  while (params.size < count) params.set(randomText(2 + Math.floor(Math.random() * 3)), randomText(20 + Math.floor(Math.random() * 13)));
  return `?${params.toString()}`;
}

export function LuckyDrawStandalone() {
  // Opening /raffle-draw lands on /raffle-draw?x4f=...&m2k=...&..., 5 to 8 long random keys that only make the address harder to read or
  // pass on by hand. It is not a security measure, the draw API is public. A refresh keeps the same query, and replace
  // keeps the plain address out of the Back button.
  const { search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!search) navigate({ search: randomQuery() }, { replace: true });
  }, [search, navigate]);

  const [entered, setEntered] = useState(() => !!document.fullscreenElement);
  const [entering, setEntering] = useState(false);

  const enter = () => {
    setEntering(true);
    // Full screen is asked for at once, it needs the click. The banner then plays its exit before the draw shows.
    const request = document.documentElement.requestFullscreen?.();
    const exit = new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : INTRO_EXIT_MS));
    // The draw still opens if the browser refuses full screen, its own Full screen button stays available.
    Promise.all([Promise.resolve(request).catch(() => {}), exit]).finally(() => setEntered(true));
  };

  if (!entered) {
    return (
      <main className={`dlgfb-draw-intro dlgfb-theme-${DRAW_THEME}${entering ? " is-leaving" : ""}`}>
        <div className="dlgfb-draw-intro-card">
          <h1 className="dlgfb-draw-intro-kicker">Raffle Draw</h1>
          <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-lg dlgfb-draw-intro-btn"
            onClick={enter} disabled={entering} autoFocus>
            Are We Ready?
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="dlgfb-container dlgfb-draw-standalone dlgfb-draw-fade-in">
      <LuckyDraw autoFullscreen />
    </main>
  );
}
