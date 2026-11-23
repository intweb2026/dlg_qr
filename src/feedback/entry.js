// Everything the feedback form and admin need, loaded as one separate bundle the first time one of
// their routes is opened (see src/index.js). Visitors who only use the event pages never download it.
import { useState } from "react";
import { useEvent } from "../event/EventContext";
import RequireAdmin from "./components/RequireAdmin";
import AdminLayout from "./components/AdminLayout";
import LuckyDraw, { THEMES, readTheme, saveTheme } from "./pages/LuckyDraw";

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
// It opens on a welcome screen with the event logo, name and an Enter button. Browsers only allow full screen
// after a click, so the button click switches to full screen and then shows the draw.
// The admin Raffle draw link already opens the page in full screen, so it skips the welcome screen.
export function LuckyDrawStandalone() {
  const { config } = useEvent();
  const [entered, setEntered] = useState(() => !!document.fullscreenElement);
  const [entering, setEntering] = useState(false);
  // Saved the same way as the draw's Theme button, so the draw opens in the theme picked here.
  const [theme, setTheme] = useState(readTheme);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    saveTheme(next);
  };

  const enter = () => {
    setEntering(true);
    const request = document.documentElement.requestFullscreen?.();
    // The draw still opens if the browser refuses full screen, its own Full screen button stays available.
    Promise.resolve(request).catch(() => {}).finally(() => setEntered(true));
  };

  if (!entered) {
    const logo = config.media?.logo;
    return (
      <main className={`dlgfb-draw-intro dlgfb-theme-${theme}`}>
        <div className="dlgfb-draw-intro-actions">
          <button
            type="button"
            className="dlgfb-btn-fullscreen dlgfb-btn-theme"
            onClick={cycleTheme}
            aria-label={`Change theme, current theme ${theme}`}
            title={`Theme: ${theme}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 000 18z" fill="currentColor" />
            </svg>
            <span>Theme</span>
          </button>
        </div>
        <div className="dlgfb-draw-intro-card">
          {logo && (
            <div className="dlgfb-draw-intro-logo-plate">
              <img src={logo} alt="" className="dlgfb-draw-intro-logo" />
            </div>
          )}
          <h1 className="dlgfb-draw-intro-title">{config.name}</h1>
          <button type="button" className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-lg dlgfb-draw-intro-btn"
            onClick={enter} disabled={entering} autoFocus>
            Enter in Raffle Draw
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
