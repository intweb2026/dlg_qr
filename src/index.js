import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import EventLayout from "./event/EventContext";
import EventMobileMenu from "./EventMobileMenu";
import RegisteredDelegatesMobile from "./RegisteredDelegatesMobile";
import WifiPasswordMobile from "./WifiPasswordMobile";
import ServerError from "./ServerError";

// Feedback form and admin (src/feedback). They share one bundle that is only downloaded when one of
// these routes is opened, so the event pages load exactly as before.
const loadFeedback = () => import("./feedback/entry");
const feedbackPage = (name) => lazy(() => loadFeedback().then((m) => ({ default: m[name] })));
const FeedbackShell = feedbackPage("FeedbackShell");
const FeedbackForm = feedbackPage("FeedbackForm");
const AdminLogin = feedbackPage("AdminLogin");
const AdminArea = feedbackPage("AdminArea");
const AdminSubmissions = feedbackPage("AdminSubmissions");
const LuckyDraw = feedbackPage("LuckyDraw");
const LuckyDrawStandalone = feedbackPage("LuckyDrawStandalone");
const AdminAttendees = feedbackPage("AdminAttendees");
const NotFound = feedbackPage("NotFound");

// Each lazy page gets its own boundary, so the admin menu stays on screen while a page loads.
const load = (Page) => (
  <Suspense fallback={null}>
    <Page />
  </Suspense>
);

// Every page sits under the event code, /dle26 is the event home and /dle26/feedback-form its feedback form.
// The event's content comes from backend/events/<code>.json. The bare home page / shows a 500 error page.
function App() {
  return (
    <Routes>
      <Route path="/" element={<ServerError />} />

      <Route path="/:eventCode" element={<EventLayout />}>
        <Route index element={<EventMobileMenu />} />
        <Route path="registered-attendees" element={<RegisteredDelegatesMobile />} />
        <Route path="wifipassword" element={<WifiPasswordMobile />} />

        <Route element={load(FeedbackShell)}>
          <Route path="feedback-form" element={load(FeedbackForm)} />
          <Route path="lucky-draw" element={load(LuckyDrawStandalone)} />
          <Route path="admin/login" element={load(AdminLogin)} />
          <Route path="admin" element={load(AdminArea)}>
            <Route index element={<Navigate to="feedback-submission" replace />} />
            <Route path="feedback-submission" element={load(AdminSubmissions)} />
            <Route path="lucky-draw" element={load(LuckyDraw)} />
            <Route path="attendees" element={load(AdminAttendees)} />
            <Route path="*" element={load(NotFound)} />
          </Route>
        </Route>

        <Route path="*" element={null} />
      </Route>
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
