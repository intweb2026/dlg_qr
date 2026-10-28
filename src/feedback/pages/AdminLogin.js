import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const EVENT_NAME = process.env.REACT_APP_EVENT_NAME || "Summit";

export default function AdminLogin() {
  const { user, login } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/admin/lucky-draw" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(form.username.trim(), form.password);
      notify("You are signed in to the admin panel.", "success", { title: "Welcome back" });
      navigate(location.state?.from || "/admin/lucky-draw", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlgfb-login-page">
      <div className="dlgfb-login-wrap">
        <div className="dlgfb-login-intro">
          <span className="dlgfb-admin-brand-mark" aria-hidden="true">{EVENT_NAME.charAt(0)}</span>
          <p className="dlgfb-event-name dlgfb-mb-1">{EVENT_NAME}</p>
          <h1>Event admin</h1>
          <p className="dlgfb-login-intro-copy">Manage feedback, attendees and the lucky draw.</p>
        </div>
        <form className="dlgfb-login-card" onSubmit={submit} noValidate>
          <h2 className="dlgfb-h5 dlgfb-mb-1">Sign in</h2>
          <p className="dlgfb-text-muted dlgfb-small dlgfb-mb-4">Use your admin username and password.</p>
          {error && (
            <div className="dlgfb-login-error" role="alert">
              {error}
            </div>
          )}
          <div className="dlgfb-form-group">
            <label htmlFor="username">Username</label>
            <input id="username" className="dlgfb-form-control dlgfb-form-control-lg" autoComplete="username" autoCapitalize="none"
              value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoFocus />
          </div>
          <div className="dlgfb-form-group">
            <label htmlFor="password">Password</label>
            <div className="dlgfb-password-field">
              <input id="password" type={showPassword ? "text" : "password"} className="dlgfb-form-control dlgfb-form-control-lg"
                autoComplete="current-password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <button type="button" className="dlgfb-password-toggle" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <button className="dlgfb-btn dlgfb-btn-primary dlgfb-btn-lg dlgfb-btn-block" disabled={busy || !form.username.trim() || !form.password}>
            {busy && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
