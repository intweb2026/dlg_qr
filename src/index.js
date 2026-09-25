import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import EventMobileMenu from "./EventMobileMenu";
import RegisteredDelegatesMobile from "./RegisteredDelegatesMobile";
import AskAQuestionMobile from "./AskAQuestionMobile";
import ThankYouMobile from "./ThankYouMobile";
import WifiPasswordMobile from "./WifiPasswordMobile";

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
const AdminAttendees = feedbackPage("AdminAttendees");
const NotFound = feedbackPage("NotFound");

// Each lazy page gets its own boundary, so the admin menu stays on screen while a page loads.
const load = (Page) => (
  <Suspense fallback={null}>
    <Page />
  </Suspense>
);

function App() {
  return (
    <Routes>
      <Route path="/" element={<EventMobileMenu />} />
      <Route path="/registered-attendees" element={<RegisteredDelegatesMobile />} />
      <Route path="/ask-a-question" element={<AskAQuestionMobile />} />
      <Route path="/thank-you" element={<ThankYouMobile />} />
      <Route path="/wifipassword" element={<WifiPasswordMobile />} />

      <Route element={load(FeedbackShell)}>
        <Route path="/feedback-form" element={load(FeedbackForm)} />
        <Route path="/admin/login" element={load(AdminLogin)} />
        <Route path="/admin" element={load(AdminArea)}>
          <Route index element={<Navigate to="feedback-submission" replace />} />
          <Route path="feedback-submission" element={load(AdminSubmissions)} />
          <Route path="lucky-draw" element={load(LuckyDraw)} />
          <Route path="attendees" element={load(AdminAttendees)} />
          <Route path="*" element={load(NotFound)} />
        </Route>
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
