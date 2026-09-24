import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import emailjs from "@emailjs/browser";
import "./AskAQuestionMobile.css";

const EMAILJS_SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.REACT_APP_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;
const EMAILJS_CONFIGURED = Boolean(
  EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY
);

const DEFAULT_SPEAKERS = ["Event Host", "Jaco Bester", "Osman Şen", "Salvatore Pinizzotto", "Kaustubh Deshpande", "Luis Santillana", "Famke Schaap", "Oliver Tzschaetzsch", "Tom Frising", "Christoph Maurer", "Stewart Dickson", "Tommaso Ferrari", "Steffen Garbe", "Paul-Louis Wöhrlin", "Christian Heubner", "Andreas Kuhlmann", "Simon Gillibrand", "Irina Melkonyan", "Libby Banks", "Michael Palmer", "Ferdinand Ferstl", "Paw Juul", "Sebastian Stolzenberg", "Dominic Wells"];

// Every question now goes to the same fixed address, cc'd to the same
// fixed list, there's no more "Submit to" choice driving this.
const TO_EMAIL = "Slides2@iq-hub.com";
const CC_EMAILS = ["ken.peters@iq-hub.com", "delegates@iq-hub.com"];

export default function AskAQuestionMobile({ speakers = DEFAULT_SPEAKERS, onSubmit }) {
  const navigate = useNavigate();
  const [speaker, setSpeaker] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | error
  const [errorDetail, setErrorDetail] = useState("");

  const handleCancel = () => {
    navigate("/");
  };

  const openMailto = (subject, body) => {
    // mailto: only opens the visitor's own mail app with these fields
    // pre-filled, it still needs them to hit Send there themselves; used
    // as a fallback so the form still does *something* before EmailJS is
    // configured, or if a send attempt through it fails
    window.location.href = `mailto:${TO_EMAIL}?cc=${encodeURIComponent(
      CC_EMAILS.join(",")
    )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const subject = `Ask A Question: ${speaker}`;
    // RFC 6068 wants CRLF for a mailto: body, a bare \n renders fine in
    // most clients but some (Outlook via its mailto: handler chief among
    // them) collapse it and run every line together instead
    const body = [`Speaker: ${speaker}`, `Query: ${query}`].join("\r\n");

    if (!EMAILJS_CONFIGURED) {
      openMailto(subject, body);
      if (onSubmit) {
        onSubmit({ speaker, query, to: TO_EMAIL, cc: CC_EMAILS });
      }
      navigate("/thank-you");
      return;
    }

    setStatus("sending");
    setErrorDetail("");
    try {
      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        {
          to_email: TO_EMAIL,
          cc_email: CC_EMAILS.join(","),
          subject,
          speaker,
          message: query,
        },
        EMAILJS_PUBLIC_KEY
      );
      if (onSubmit) {
        onSubmit({ speaker, query, to: TO_EMAIL, cc: CC_EMAILS });
      }
      navigate("/thank-you");
    } catch (error) {
      // EmailJS rejects with { status, text }, text is the actual reason
      // (bad service/template ID, invalid public key, empty recipient,
      // etc.), log it and show it so a failure is diagnosable without
      // digging through devtools network responses each time
      console.error("EmailJS send failed:", error);
      setErrorDetail(error?.text || error?.message || "");
      // stay on the form so the visitor can retry rather than showing a
      // false "Thank you" for a question that never actually sent
      setStatus("error");
    }
  };

  return (
    <div
      className="ask-question-mobile"
      style={{
        "--ask-question-bg": `url(${process.env.PUBLIC_URL}/images/DLE-Folder-BG.png)`,
      }}
    >
      <div className="ask-question-mobile__header">
        <div className="ask-question-mobile__header-inner">
          <button
            type="button"
            className="ask-question-mobile__back_button"
            aria-label="Go back"
            onClick={handleCancel}
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
          <h1 className="ask-question-mobile__title">Ask A Question</h1>
        </div>
      </div>

      <form className="ask-question-mobile__card" onSubmit={handleSubmit}>
        <label className="ask-question-mobile__label" htmlFor="ask-question-speaker">
          Select Speakers:
        </label>
        <div className="ask-question-mobile__select-wrap">
          <select
            id="ask-question-speaker"
            className="ask-question-mobile__select"
            value={speaker}
            onChange={(event) => setSpeaker(event.target.value)}
            required
          >
            <option value="" disabled>
              Choose a speaker
            </option>
            {speakers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <label className="ask-question-mobile__label" htmlFor="ask-question-query">
          Submit Query:
        </label>
        <textarea
          id="ask-question-query"
          className="ask-question-mobile__textarea"
          placeholder="Type your question here..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />

        {status === "error" && (
          <p className="ask-question-mobile__error">
            Something went wrong sending your question. Please try again.
            {errorDetail && ` (${errorDetail})`}
          </p>
        )}

        <div className="ask-question-mobile__actions">
          <button
            type="button"
            className="ask-question-mobile__button ask-question-mobile__button--cancel"
            onClick={handleCancel}
            disabled={status === "sending"}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="ask-question-mobile__button ask-question-mobile__button--submit"
            disabled={status === "sending"}
          >
            {status === "sending" ? "Sending…" : "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}
