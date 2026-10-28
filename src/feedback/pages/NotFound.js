import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="dlgfb-notfound-page">
      <div className="dlgfb-notfound-card">
        <p className="dlgfb-notfound-code">404</p>
        <h1 className="dlgfb-h4">This page does not exist</h1>
        <p className="dlgfb-text-muted">The link may be mistyped, or the page has moved.</p>
        <div className="dlgfb-notfound-actions">
          <Link className="dlgfb-btn dlgfb-btn-primary" to="/feedback-form">Go to the feedback form</Link>
          <Link className="dlgfb-btn dlgfb-btn-light" to="/admin">Admin panel</Link>
        </div>
      </div>
    </div>
  );
}
