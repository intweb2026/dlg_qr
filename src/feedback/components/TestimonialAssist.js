import { useState } from "react";
import api, { eventKey } from "../api";
import Modal from "./Modal";

const MIN_WORDS = 3;

const SUGGESTION_LIMIT = 5;

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// One form session is one browser tab on one event. Its id goes with each request, so the API can allow
// 5 suggestions per session; the number left is kept here too, so the form stops asking at 0.
function readSession() {
  try {
    let id = sessionStorage.getItem(eventKey("testimonialSession"));
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(eventKey("testimonialSession"), id);
    }
    const left = sessionStorage.getItem(eventKey("testimonialLeft"));
    return { id, left: left === null ? SUGGESTION_LIMIT : Number(left) };
  } catch {
    return { id: `nostore-${Math.random().toString(36).slice(2, 12)}`, left: SUGGESTION_LIMIT };
  }
}

function saveLeft(left) {
  try {
    sessionStorage.setItem(eventKey("testimonialLeft"), String(left));
  } catch {
    /* storage blocked, the API still enforces the limit */
  }
}

/**
 * The suggested testimonial under a text question with "aiSuggestion". When the attendee leaves the text box,
 * their words are sent to the API, which asks Gemini for a polished version. They can use it, edit it in a
 * popup, or keep their original. Everything is kept in the form's answers, so Back and Continue keep it:
 *   assist  { status, basis, suggestion, version, final }  status is idle, loading, ready or unavailable,
 *           basis is the text the suggestion was made for, version is suggested, edited or original.
 *   consent true or false, the publishing agreement.
 */
export function testimonialHelper(q, answers, setAnswers) {
  const assistKey = `${q.key}_assist`;
  const consentKey = `${q.key}_consent`;
  const assist = answers[assistKey] || { status: "idle" };
  const setAssist = (next) => setAnswers((a) => ({ ...a, [assistKey]: typeof next === "function" ? next(a[assistKey] || { status: "idle" }) : next }));

  // Called when the text changes, a suggestion for other words no longer applies.
  const onTextChange = (text) => {
    if (assist.basis !== undefined && text.trim() !== assist.basis) setAssist({ status: "idle" });
  };

  // Called when the attendee leaves the text box.
  const requestSuggestion = (text) => {
    const basis = text.trim();
    if (wordCount(basis) < MIN_WORDS || (basis === assist.basis && assist.status !== "idle")) return;
    const session = readSession();
    if (session.left <= 0) {
      setAssist({ status: "limit", basis });
      return;
    }
    setAssist({ status: "loading", basis });
    api
      .post("/feedback/suggest-testimonial/", { text: basis, session: session.id })
      .then(({ data }) => {
        if (Number.isInteger(data.remaining)) saveLeft(data.remaining);
        setAssist((cur) => (cur.basis === basis ? { status: "ready", basis, suggestion: data.suggestion } : cur));
      })
      // No key, busy, declined or out of attempts: no suggestion, the attendee's words are used.
      .catch((err) => {
        const data = err?.response?.data || {};
        if (Number.isInteger(data.remaining)) saveLeft(data.remaining);
        const status = data.code === "limit_reached" ? "limit" : "unavailable";
        setAssist((cur) => (cur.basis === basis ? { status, basis } : cur));
      });
  };

  // Puts the chosen wording into the question's text box. The attendee's own words are kept as "original", so they
  // can be brought back with Keep my original and are saved beside the chosen version.
  const choose = (version, final) =>
    setAnswers((a) => {
      const cur = a[assistKey] || { status: "idle" };
      const original = cur.original ?? String(a[q.key] || "").trim();
      const text = version === "original" ? original : final;
      // basis is the box's new text, so leaving the box again does not ask for another suggestion.
      return { ...a, [q.key]: text, [assistKey]: { ...cur, version, final: text, basis: text, original } };
    });

  return { assist, setAssist, choose, consent: !!answers[consentKey], setConsent: (v) => setAnswers((a) => ({ ...a, [consentKey]: v })), onTextChange, requestSuggestion };
}

/** The final wording to save: the chosen version, or the attendee's own words when none was chosen. */
export function testimonialFinal(answers, key) {
  const assist = answers[`${key}_assist`];
  return assist?.version ? assist.final : String(answers[key] || "").trim();
}

export default function TestimonialAssist({ q, text, helper }) {
  const { assist, choose, consent, setConsent } = helper;
  const [editing, setEditing] = useState(null);
  const hasText = text.trim() !== "";

  return (
    <>
      {assist.status === "loading" && (
        <div className="dlgfb-testimonial" role="status">
          <p className="dlgfb-testimonial-title">Suggested testimonial</p>
          <p className="dlgfb-testimonial-text dlgfb-testimonial-wait">Writing a suggestion from your words...</p>
        </div>
      )}

      {assist.status === "ready" && (
        <div className="dlgfb-testimonial">
          <p className="dlgfb-testimonial-title">Suggested testimonial</p>
          <p className="dlgfb-testimonial-text">{assist.suggestion}</p>
          <button type="button" className="dlgfb-testimonial-btn dlgfb-testimonial-btn-primary" onClick={() => choose("suggested", assist.suggestion)}>
            Use this version
          </button>
          <button type="button" className="dlgfb-testimonial-btn" onClick={() => setEditing(assist.version === "edited" ? assist.final : assist.suggestion)}>
            Edit suggestion
          </button>
          <button type="button" className="dlgfb-testimonial-btn" onClick={() => choose("original")}>
            Keep my original
          </button>
        </div>
      )}

      {assist.status === "limit" && (
        <p className="dlgfb-testimonial-note">You have used all {SUGGESTION_LIMIT} suggestions, your own words will be used.</p>
      )}

      {/* The agreement shows as soon as there is any text, whether or not a suggested version is chosen. */}
      {hasText && q.consentLabel && (
        <label className={`dlgfb-form-check dlgfb-testimonial-consent${consent ? " dlgfb-is-selected" : ""}`}>
          <input type="checkbox" className="dlgfb-sr-only" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="dlgfb-form-check-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="dlgfb-form-check-title">{q.consentLabel}</span>
        </label>
      )}

      {editing !== null && (
        <Modal
          title="Make it your own"
          className="dlgfb-form-modal dlgfb-testimonial-modal"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button
                type="button"
                className="dlgfb-testimonial-btn dlgfb-testimonial-btn-primary"
                disabled={!editing.trim()}
                onClick={() => {
                  choose("edited", editing.trim());
                  setEditing(null);
                }}
              >
                Use edited version
              </button>
              <button type="button" className="dlgfb-testimonial-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p className="dlgfb-testimonial-modal-intro">Review and edit your final wording before using it.</p>
          <textarea
            className="dlgfb-form-textarea dlgfb-testimonial-modal-text"
            rows={5}
            maxLength={1000}
            aria-label="Your testimonial"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            autoFocus
          />
        </Modal>
      )}
    </>
  );
}
