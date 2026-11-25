// Everything the feedback form and admin need, loaded as one separate bundle the first time one of
// their routes is opened (see src/index.js). Visitors who only use the event pages never download it.
import { useState } from "react";
import { useEvent } from "../event/EventContext";
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
export { default as NotFound } from "./pages/NotFound";

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
// The admin Raffle draw link already opens the page in full screen, so it skips the welcome screen.
export function LuckyDrawStandalone() {
  const { config } = useEvent();
  const [entered, setEntered] = useState(() => !!document.fullscreenElement);
  const [entering, setEntering] = useState(false);

  const enter = () => {
    setEntering(true);
    const request = document.documentElement.requestFullscreen?.();
    // The draw still opens if the browser refuses full screen, its own Full screen button stays available.
    Promise.resolve(request).catch(() => {}).finally(() => setEntered(true));
  };

  if (!entered) {
    return (
      <main className={`dlgfb-draw-intro dlgfb-theme-${DRAW_THEME}`}>
        <div className="dlgfb-draw-intro-card">
          <p className="dlgfb-draw-intro-kicker">Raffle Draw</p>
          <h1 className="dlgfb-draw-intro-title">{config.name}</h1>
          <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-lg dlgfb-draw-intro-btn"
            onClick={enter} disabled={entering} autoFocus>
            Are We Ready?
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="dlgfb-container dlgfb-draw-standalone">
      <LuckyDraw autoFullscreen />
    </main>
  );
}
