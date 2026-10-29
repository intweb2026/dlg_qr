import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./WifiPasswordMobile.css";
import { useEvent, useEventPath } from "./event/EventContext";

export default function WifiPasswordMobile() {
  const navigate = useNavigate();
  const { config } = useEvent();
  const eventPath = useEventPath();
  const [copiedField, setCopiedField] = useState(null);
  // The network, password and venue come from "wifi" in the event file, the logo and QR code from "media".
  const { network: WIFI_NETWORK = "", password: WIFI_PASSWORD = "", venueName = "" } = config.wifi || {};
  const media = config.media || {};

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
        "--wifi-bg": `url(${media.background})`,
      }}
    >
      <div className="wifi-mobile__header">
        <div className="wifi-mobile__header-inner">
          <button
            type="button"
            className="wifi-mobile__back_button"
            aria-label="Go back"
            onClick={() => navigate(eventPath())}
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
        {media.venueLogo && <img src={media.venueLogo} alt={venueName} className="wifi-mobile__logo" />}

        <img
          src={media.wifiQr}
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
