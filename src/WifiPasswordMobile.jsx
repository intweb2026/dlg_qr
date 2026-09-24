import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./WifiPasswordMobile.css";

const venueLogo = "/images/dlg_hotel.png";

const WIFI_NETWORK = process.env.REACT_APP_WIFI_NETWORK || "Event Wi-Fi";
const WIFI_PASSWORD = process.env.REACT_APP_WIFI_PASSWORD || "ChangeMe123";

export default function WifiPasswordMobile() {
  const navigate = useNavigate();
  const [copiedField, setCopiedField] = useState(null);

  const handleCopy = async (field, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (error) {
      console.error("Copy to clipboard failed:", error);
    }
  };

  return (
    <div
      className="wifi-mobile"
      style={{
        "--wifi-bg": `url(${process.env.PUBLIC_URL}/images/DLE-Folder-BG.png)`,
      }}
    >
      <div className="wifi-mobile__header">
        <div className="wifi-mobile__header-inner">
          <button
            type="button"
            className="wifi-mobile__back_button"
            aria-label="Go back"
            onClick={() => navigate("/")}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="wifi-mobile__title">Wi-Fi Password</h1>
        </div>
      </div>

      <div className="wifi-mobile__card">
        <img src={venueLogo} alt="Emperador" className="wifi-mobile__logo" />

        <img
          src="/images/dlg_wifi_qr.jpeg"
          alt="Wi-Fi QR code"
          className="wifi-mobile__icon"
        />

        <div className="wifi-mobile__field">
          <div className="wifi-mobile__field-text">
            <span className="wifi-mobile__field-label">Network</span>
            <span className="wifi-mobile__field-value">{WIFI_NETWORK}</span>
          </div>
          <button
            type="button"
            className={`wifi-mobile__copy_button${copiedField === "network" ? " wifi-mobile__copy_button--copied" : ""}`}
            aria-label="Copy network name"
            onClick={() => handleCopy("network", WIFI_NETWORK)}
          >
            {copiedField === "network" ? (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M5 13l4 4 10-10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        </div>

        <div className="wifi-mobile__field">
          <div className="wifi-mobile__field-text">
            <span className="wifi-mobile__field-label">Password</span>
            <span className="wifi-mobile__field-value">{WIFI_PASSWORD}</span>
          </div>
          <button
            type="button"
            className={`wifi-mobile__copy_button${copiedField === "password" ? " wifi-mobile__copy_button--copied" : ""}`}
            aria-label="Copy password"
            onClick={() => handleCopy("password", WIFI_PASSWORD)}
          >
            {copiedField === "password" ? (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M5 13l4 4 10-10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
