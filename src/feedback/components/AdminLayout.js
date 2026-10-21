import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const EVENT_NAME = process.env.REACT_APP_EVENT_NAME || "Summit";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const handleLogout = async () => {
    await logout();
    notify("You have signed out of the admin panel.", "info", { title: "Signed out" });
    navigate("/admin/login");
  };

  const link = ({ isActive }) => `admin-link${isActive ? " active" : ""}`;
  const name = user?.full_name || user?.username || "";

  return (
    <div className="admin-shell">
      <header className="admin-nav">
        <div className="container admin-nav-inner">
          <span className="admin-brand">
            <span className="admin-brand-mark" aria-hidden="true">{EVENT_NAME.charAt(0)}</span>
            <span>{EVENT_NAME} <span className="admin-brand-sub">Admin</span></span>
          </span>
          <button
            className={`admin-burger${open ? " open" : ""}`}
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
          <div className={`admin-menu${open ? " show" : ""}`} id="admin-menu">
            <nav className="admin-links" aria-label="Admin">
              <NavLink className={link} to="/admin/lucky-draw">Lucky draw</NavLink>
              <NavLink className={link} to="/admin/feedback-submission">Submissions</NavLink>
              <NavLink className={link} to="/admin/attendees">Attendees</NavLink>
            </nav>
            <div className="admin-user">
              <span className="admin-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
              <span className="admin-user-name">{name}</span>
              <button className="btn btn-sm btn-signout" onClick={handleLogout}>Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <main className="container admin-main">
        <Outlet />
      </main>
    </div>
  );
}
