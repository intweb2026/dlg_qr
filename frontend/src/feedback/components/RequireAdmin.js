import { Navigate, useLocation } from "react-router-dom";
import { useEventPath } from "../../event/EventContext";
import { useAuth } from "../context/AuthContext";

export default function RequireAdmin({ children }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  const eventPath = useEventPath();
  if (checking) {
    return (
      <div className="dlgfb-page-loader">
        <div className="dlgfb-spinner-border" role="status">
          <span className="dlgfb-sr-only">Loading</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to={eventPath("/admin/login")} replace state={{ from: location.pathname }} />;
  return children;
}
