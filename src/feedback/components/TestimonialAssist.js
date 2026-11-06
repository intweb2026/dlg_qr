import { useLayoutEffect, useRef } from "react";
import api, { eventKey } from "../api";

const MIN_WORDS = 3;

const SUGGESTION_LIMIT = 5;

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// One form session is one browser tab on one event. Its id goes with each request, so the API can allow
// 5 polishes per session; the number left is kept here too, so the form stops asking at 0.
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
 * Polish and Roll back for a text question with "aiSuggestion". Nothing goes to the AI until the attendee presses
 * Polish, which needs at least 3 words. The polished wording replaces the text in the box, and the text it replaced
 * is kept, so Roll back puts it back; each press of Roll back undoes one Polish. Everything is kept in the form's
 * answers, so a refresh keeps it:
 *   assist  { status, basis, history }  status is idle, loading, unavailable or limit; basis is the text being
 *           polished; history is the texts replaced by Polish, oldest first, so history[0] is the attendee's own words.
 *   consent "Yes" or "No", the answer to the marketing question under the box.
 */
export function testimonialHelper(q, answers, setAnswers) {
  const assistKey = `${q.key}_assist`;
  const consentKey = `${q.key}_consent`;
  const assist = answers[assistKey] || { status: "idle" };
  const history = Array.isArray(assist.history) ? assist.history : [];
  const setAssist = (next) =>
    setAnswers((a) => ({ ...a, [assistKey]: typeof next === "function" ? next(a[assistKey] || { status: "idle" }) : next }));

  const requestSuggestion = (text) => {
    const basis = text.trim();
    if (wordCount(basis) < MIN_WORDS || assist.status === "loading") return;
    const session = readSession();
    if (session.left <= 0) {
      setAssist((cur) => ({ ...cur, status: "limit" }));
      return;
    }
    setAssist((cur) => ({ ...cur, status: "loading", basis }));
    api
      .post("/feedback/suggest-testimonial/", { text: basis, session: session.id })
      .then(({ data }) => {
        if (Number.isInteger(data.remaining)) saveLeft(data.remaining);
        // The polished text goes in the box, the text it replaces is kept for Roll back.
        setAnswers((a) => {
          const cur = a[assistKey] || { status: "idle" };
          if (cur.basis !== basis || String(a[q.key] || "").trim() !== basis) return { ...a, [assistKey]: { ...cur, status: "idle" } };
          const past = Array.isArray(cur.history) ? cur.history : [];
          return { ...a, [q.key]: data.suggestion, [assistKey]: { status: "idle", history: [...past, String(a[q.key] || "")] } };
        });
      })
      // No key, busy, declined or out of attempts: the text stays as typed.
      .catch((err) => {
        const data = err?.response?.data || {};
        if (Number.isInteger(data.remaining)) saveLeft(data.remaining);
        const status = data.code === "limit_reached" ? "limit" : "unavailable";
        setAssist((cur) => (cur.basis === basis ? { ...cur, status } : cur));
      });
  };

  // Puts back the text from before the last Polish.
  const rollBack = () =>
    setAnswers((a) => {
      const cur = a[assistKey] || { status: "idle" };
      const past = Array.isArray(cur.history) ? cur.history : [];
      if (past.length === 0) return a;
      return { ...a, [q.key]: past[past.length - 1], [assistKey]: { ...cur, status: "idle", history: past.slice(0, -1) } };
    });

  return {
    assist,
    canRollBack: history.length > 0 && assist.status !== "loading",
    requestSuggestion,
    rollBack,
    consent: answers[consentKey] === "Yes" || answers[consentKey] === "No" ? answers[consentKey] : "",
    setConsent: (v) => setAnswers((a) => ({ ...a, [consentKey]: v })),
  };
}

/** The attendee's own words, before the first Polish, or undefined when Polish was not used. */
export function testimonialOriginal(answers, key) {
  const history = answers[`${key}_assist`]?.history;
  return Array.isArray(history) && history.length > 0 ? String(history[0]).trim() : undefined;
}

const MAX_BOX_HEIGHT = 340;

/**
 * The text box grows with what is typed so the attendee can read all of it, from the box's minimum height up to
 * MAX_BOX_HEIGHT. Longer text scrolls inside the box, so it never takes over the page.
 */
export function AutoGrowTextarea({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = "auto";
      const min = parseFloat(getComputedStyle(el).minHeight) || 0;
      const wanted = Math.max(el.scrollHeight + 2, min);
      el.style.height = `${Math.min(wanted, MAX_BOX_HEIGHT)}px`;
      el.style.overflowY = wanted > MAX_BOX_HEIGHT ? "auto" : "hidden";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return <textarea ref={ref} value={value} {...props} />;
}

/** Polish, at the bottom right of the text box. It is the only thing that sends text to the AI, from 3 words. */
export function PolishButton({ text, helper }) {
  const { assist, requestSuggestion } = helper;
  const loading = assist.status === "loading";
  const tooShort = wordCount(text) < MIN_WORDS;
  return (
    <button
      type="button"
      className="dlgfb-polish-btn"
      disabled={loading || assist.status === "limit" || tooShort}
      onClick={() => requestSuggestion(text)}
      title={tooShort ? `Write at least ${MIN_WORDS} words to polish` : "Rewrite your words with AI"}
    >
      {loading ? "Polishing..." : "Polish"}
    </button>
  );
}

/** Roll back, beside Polish. Puts back the text from before the last Polish. */
export function RollBackButton({ helper }) {
  const { canRollBack, rollBack } = helper;
  return (
    <button
      type="button"
      className="dlgfb-polish-btn dlgfb-rollback-btn"
      disabled={!canRollBack}
      onClick={rollBack}
      title={canRollBack ? "Go back to your text before the last Polish" : "Nothing to roll back yet"}
    >
      Roll back
    </button>
  );
}

/** The note when Polish could not run, and the marketing question with Yes and No under the box. */
export default function TestimonialAssist({ q, helper }) {
  const { assist, consent, setConsent } = helper;
  const name = `${q.key}_consent`;
  return (
    <>
      {assist.status === "unavailable" && <p className="dlgfb-testimonial-note">Polish is not available right now, your own words will be used.</p>}
      {assist.status === "limit" && <p className="dlgfb-testimonial-note">You have used all {SUGGESTION_LIMIT} polishes, your own words will be used.</p>}

      {q.consentLabel && (
        <div className="dlgfb-testimonial-consent" role="radiogroup" aria-labelledby={`${name}-label`}>
          <p className="dlgfb-testimonial-consent-q" id={`${name}-label`}>
            {q.consentLabel}
          </p>
          <div className="dlgfb-testimonial-consent-options">
            {["Yes", "No"].map((opt) => (
              <label key={opt} className={`dlgfb-form-radio dlgfb-testimonial-consent-opt${consent === opt ? " dlgfb-is-selected" : ""}`}>
                <input type="radio" className="dlgfb-sr-only" name={name} value={opt} checked={consent === opt} onChange={() => setConsent(opt)} />
                <span className="dlgfb-form-radio-mark" aria-hidden="true" />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
