import { useEffect, useState } from "react";
import api, { errorMessage, mediaUrl } from "../api";
import { useToast } from "../context/ToastContext";

const MAX = 255;

// The one screen the support user on the floor can open. The Wi-Fi network and password shown on the Wi-Fi page.
// Admins can open it too, the same two fields are on their Event Details page.
// Saving new details also makes the Wi-Fi QR code again on the server, so the Wi-Fi page never shows an old one.
export default function AdminWifi() {
  const notify = useToast();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({ network: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    api
      .get("/admin/wifi/")
      .then(({ data }) => {
        if (cancelled) return;
        setSaved(data);
        setForm({ network: data.network, password: data.password });
      })
      .catch((err) => !cancelled && notify(errorMessage(err), "danger", { title: "Could not load the Wi-Fi details" }));
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const changed = saved && (form.network.trim() !== saved.network || form.password.trim() !== saved.password);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.patch("/admin/wifi/", { network: form.network, password: form.password });
      setSaved(data);
      setForm({ network: data.network, password: data.password });
      if (data.qr_updated === false) {
        notify("The new details are saved but the QR code could not be made. Ask an admin to generate it on the Event Details page.", "warning", { title: "Wi-Fi saved, QR code not updated" });
      } else {
        notify(data.qr_updated ? "The Wi-Fi page and its QR code now show the new details." : "The Wi-Fi page now shows the new details.", "success", { title: "Wi-Fi saved" });
      }
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 400 && data && !data.detail) {
        setErrors(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
      } else {
        notify(errorMessage(err), "danger", { title: "Not saved" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dlgfb-page-head">
        <div>
          <h1>Wi-Fi</h1>
          <p className="dlgfb-text-muted dlgfb-mb-0">The network name and password attendees see on the Wi-Fi page. Change them here when the venue's Wi-Fi changes.</p>
        </div>
      </div>

      <form className="dlgfb-panel" onSubmit={submit} noValidate>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="wifi-network">Network name</label>
          <input id="wifi-network" className={`dlgfb-form-control${errors.network ? " dlgfb-is-invalid" : ""}`} maxLength={MAX}
            autoComplete="off" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} disabled={!saved} />
          {errors.network && <div className="dlgfb-invalid-feedback">{errors.network}</div>}
        </div>
        <div className="dlgfb-form-group">
          <label className="dlgfb-ed-label" htmlFor="wifi-password">Password</label>
          <div className="dlgfb-input-group">
            <input id="wifi-password" type={show ? "text" : "password"} className={`dlgfb-form-control${errors.password ? " dlgfb-is-invalid" : ""}`}
              maxLength={MAX} autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} disabled={!saved} />
            <button type="button" className="dlgfb-btn dlgfb-btn-light" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
          </div>
          {errors.password && <div className="dlgfb-invalid-feedback dlgfb-d-block">{errors.password}</div>}
        </div>
        <div className="dlgfb-form-group">
          <span className="dlgfb-ed-label">QR code on the Wi-Fi page</span>
          {saved?.qr ? (
            <div><img src={mediaUrl(saved.qr)} alt="Current Wi-Fi QR code" width={160} height={160} /></div>
          ) : (
            <p className="dlgfb-small dlgfb-text-muted dlgfb-mb-1">No QR code yet. It is made when you save the network and password.</p>
          )}
          <small className="dlgfb-form-text dlgfb-text-muted">Made again by itself every time the network or password is saved.</small>
        </div>
        <button className="dlgfb-btn dlgfb-btn-primary" disabled={busy || !changed}>{busy ? "Saving" : "Save Wi-Fi details"}</button>
      </form>
    </>
  );
}
