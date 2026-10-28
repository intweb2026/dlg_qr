import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import "./base.css";
import "./styles.css";
import { ToastProvider } from "./context/ToastContext";
import { AuthProvider } from "./context/AuthContext";

// Fonts used only by the feedback form and admin. Montserrat is listed again at the weights this app was
// designed with. The link is removed when the user leaves, so the event pages keep their own fonts.
const FONTS_ID = "dlgfb-fonts";
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=Montserrat:wght@700;800" +
  "&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap";

// Wrapper for every feedback and admin route. Every rule in base.css and styles.css sits under .dlgfb-app,
// and every class starts with dlgfb-, so these styles never clash with the rest of a site.
export default function FeedbackShell() {
  useEffect(() => {
    let link = document.getElementById(FONTS_ID);
    if (!link) {
      link = document.createElement("link");
      link.id = FONTS_ID;
      link.rel = "stylesheet";
      link.href = FONTS_URL;
      document.head.appendChild(link);
    }
    document.body.classList.add("dlgfb-body-active");
    return () => {
      document.body.classList.remove("dlgfb-body-active");
      link.remove();
    };
  }, []);

  return (
    <div className="dlgfb-app">
      <ToastProvider>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      </ToastProvider>
    </div>
  );
}
