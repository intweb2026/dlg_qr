import React from "react";
import { useNavigate } from "react-router-dom";
import "./ThankYouMobile.css";

export default function ThankYouMobile() {
  const navigate = useNavigate();

  return (
    <div
      className="thank-you-mobile"
      style={{
        "--thank-you-bg": `url(${process.env.PUBLIC_URL}/images/DLE-Folder-BG.png)`,
      }}
    >
      <div className="thank-you-mobile__card">
        <span className="thank-you-mobile__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className="thank-you-mobile__title">Thank you!</h1>
        <p className="thank-you-mobile__subtitle">Submitted Successful</p>

        <button
          type="button"
          className="thank-you-mobile__link"
          onClick={() => navigate("/")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Go back to Homepage
        </button>
      </div>
    </div>
  );
}
