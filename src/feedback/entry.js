// Everything the feedback form and admin need, loaded as one separate bundle the first time one of
// their routes is opened (see src/index.js). Visitors who only use the event pages never download it.
import RequireAdmin from "./components/RequireAdmin";
import AdminLayout from "./components/AdminLayout";

export { default as FeedbackShell } from "./FeedbackShell";
export { default as FeedbackForm } from "./pages/FeedbackForm";
export { default as AdminLogin } from "./pages/AdminLogin";
export { default as AdminSubmissions } from "./pages/AdminSubmissions";
export { default as LuckyDraw } from "./pages/LuckyDraw";
export { default as AdminAttendees } from "./pages/AdminAttendees";
export { default as NotFound } from "./pages/NotFound";

export function AdminArea() {
  return (
    <RequireAdmin>
      <AdminLayout />
    </RequireAdmin>
  );
}
