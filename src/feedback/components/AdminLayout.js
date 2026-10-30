import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEvent, useEventPath } from "../../event/EventContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const EVENT_NAME = useEvent().config.name;
  const eventPath = useEventPath();

  useEffect(() => setOpen(false), [location.pathname]);

  const handleLogout = async () => {
    await logout();
    notify("You have signed out of the admin panel.", "info", { title: "Signed out" });
    navigate(eventPath("/admin/login"));
  };

  const link = ({ isActive }) => `dlgfb-admin-link${isActive ? " dlgfb-active" : ""}`;
  const name = user?.full_name || user?.username || "";

  return (
    <div className="dlgfb-admin-shell">
      <header className="dlgfb-admin-nav">
        <div className="dlgfb-container dlgfb-admin-nav-inner">
          <span className="dlgfb-admin-brand">
            {/* <span className="dlgfb-admin-brand-mark" aria-hidden="true">{EVENT_NAME.charAt(0)}</span> */}
            <span>{EVENT_NAME} <span className="dlgfb-admin-brand-sub">Admin</span></span>
          </span>
          <button
            className={`dlgfb-admin-burger${open ? " dlgfb-open" : ""}`}
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            aria-controls="admin-menu"
            onClick={() => setOpen(!open)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className={`dlgfb-admin-menu${open ? " dlgfb-show" : ""}`} id="admin-menu">
            <nav className="dlgfb-admin-links" aria-label="Admin">
              <NavLink className={link} to={eventPath("/admin/lucky-draw")}>Lucky draw</NavLink>
              <NavLink className={link} to={eventPath("/admin/feedback-submission")}>Submissions</NavLink>
              <NavLink className={link} to={eventPath("/admin/attendees")}>Attendees</NavLink>
            </nav>
            <div className="dlgfb-admin-user">
              <span className="dlgfb-admin-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
              <span className="dlgfb-admin-user-name">{name}</span>
              <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-signout" onClick={handleLogout}>Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <main className="dlgfb-container dlgfb-admin-main">
        <Outlet />
      </main>
    </div>
  );
}
