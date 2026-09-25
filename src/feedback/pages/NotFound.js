import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="notfound-page">
      <div className="notfound-card">
        <p className="notfound-code">404</p>
        <h1 className="h4">This page does not exist</h1>
        <p className="text-muted">The link may be mistyped, or the page has moved.</p>
        <div className="notfound-actions">
          <Link className="btn btn-primary" to="/feedback-form">Go to the feedback form</Link>
          <Link className="btn btn-light" to="/admin">Admin panel</Link>
        </div>
      </div>
    </div>
  );
}
