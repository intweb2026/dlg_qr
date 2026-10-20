// Everything the feedback form and admin need, loaded as one separate bundle the first time one of
// their routes is opened (see src/index.js). Visitors who only use the event pages never download it.
// import RequireAdmin from "./components/RequireAdmin";  // authentication switched off
import AdminLayout from "./components/AdminLayout";
import LuckyDraw from "./pages/LuckyDraw";

export { default as FeedbackShell } from "./FeedbackShell";
export { default as FeedbackForm } from "./pages/FeedbackForm";
// export { default as AdminLogin } from "./pages/AdminLogin";  // authentication switched off
export { default as AdminSubmissions } from "./pages/AdminSubmissions";
export { LuckyDraw };
export { default as AdminAttendees } from "./pages/AdminAttendees";
export { default as NotFound } from "./pages/NotFound";

export function AdminArea() {
  // authentication switched off, restore the RequireAdmin wrapper with it.
  // return (
  //   <RequireAdmin>
  //     <AdminLayout />
  //   </RequireAdmin>
  // );
  return <AdminLayout />;
}

// The lucky draw on its own at /lucky-draw, without the admin menu, for the screen at the venue.
// The draw API is public, so no sign in is needed here.
export function LuckyDrawStandalone() {
  return (
    <main className="container draw-standalone">
      <LuckyDraw autoFullscreen />
    </main>
  );
}
