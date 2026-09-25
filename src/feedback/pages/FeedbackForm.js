import { useCallback, useEffect, useState } from "react";
import api, { errorMessage, padId } from "../api";
import AttendeeSearch from "../components/AttendeeSearch";
import Modal from "../components/Modal";
import feedbackQuestions from "../config/feedbackQuestions";
import { useToast } from "../context/ToastContext";
import { hasSubmittedOnDevice, markSubmittedOnDevice, readEntryNumber, saveEntryNumber } from "../utils/device";

// Link for the back arrow, the event home page. The arrow is hidden while this is empty.
const HOME_URL = (process.env.REACT_APP_EVENT_HOME_URL || "").trim();
const REQUIRED_TOTAL = feedbackQuestions.filter((q) => q.required).length + 1; // plus the name

const PANEL_ICONS = {
  info: (
    <>
      <path d="M12 11v6" />
      <path d="M12 7.3v.2" />
    </>
  ),
  closed: (
    <>
      <rect x="6" y="10.5" width="12" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </>
  ),
  offline: (
    <>
      <path d="M12 8v5" />
      <path d="M12 16.3v.2" />
    </>
  ),
};

function StatusPanel({ tone, title, children, action, extra }) {
  return (
    <div className={`fb-card fb-status fb-status-${tone}`} role="status">
      <span className="fb-status-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {PANEL_ICONS[tone]}
        </svg>
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {extra}
      {action}
    </div>
  );
}

function DrawTicket({ id }) {
  const hasNumber = id !== null && id !== undefined;
  const number = hasNumber ? padId(id, 2) : "";
  return (
    <div className="fb-ticket">
      <div className="fb-ticket-main">
        <div className="fb-ticket-text">
          <span className="fb-ticket-kicker">Your draw number</span>
          <span className="fb-ticket-title">Entry confirmed</span>
          <span className="fb-ticket-sub">{hasNumber ? "Keep this number handy" : "You are in the lucky draw"}</span>
        </div>
        {hasNumber && (
          <span
            className={`fb-ticket-number${number.length > 3 ? " is-long" : number.length === 3 ? " is-mid" : ""}`}
            aria-label={`Draw number ${number}`}
          >
            {number}
          </span>
        )}
      </div>
      <div className="fb-ticket-foot">Thank you for taking part</div>
    </div>
  );
}

function isAnswered(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export default function FeedbackForm() {
  const notify = useToast();
  // loading | already | closed | form | success | offline
  const [view, setView] = useState("loading");
  const [attendees, setAttendees] = useState(null);
  const [attendeesError, setAttendeesError] = useState(false);
  const [attendee, setAttendee] = useState(null);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [entryId, setEntryId] = useState(() => readEntryNumber());

  const loadAttendees = useCallback(() => {
    setAttendeesError(false);
    setAttendees(null);
    return api
      .get("/attendees/")
      .then(({ data }) => setAttendees(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err?.response?.status === 403) setView("closed");
        else setAttendeesError(true);
      });
  }, []);

  useEffect(() => {
    // Pre-check: device already submitted
    if (hasSubmittedOnDevice()) {
      setView("already");
      return;
    }
    // The attendee list loads together with the form status, when the page opens.
    loadAttendees();
    api
      .get("/form-status/")
      .then(({ data }) => {
        if (data.submission_status) {
          markSubmittedOnDevice();
          setView("already");
        } else {
          setView((v) => (v === "closed" || !data.is_active ? "closed" : "form"));
        }
      })
      .catch(() => setView("offline"));
  }, [loadAttendees]);

  const setAnswer = (key, val) => {
    setAnswers((a) => ({ ...a, [key]: val }));
    setErrors((e) => ({ ...e, [key]: false }));
  };

  // Tick boxes, the saved list always follows the order of the options in the config.
  const toggleOption = (q, opt) => {
    const current = Array.isArray(answers[q.key]) ? answers[q.key] : [];
    const next = current.includes(opt) ? current.filter((o) => o !== opt) : [...current, opt];
    setAnswer(q.key, q.options.filter((o) => next.includes(o)));
  };

  const validate = () => {
    const next = {};
    if (!attendee) next.attendee = true;
    feedbackQuestions.forEach((q) => {
      if (q.required && !isAnswered(answers[q.key])) next[q.key] = true;
    });
    setErrors(next);
    return next;
  };

  const handleReview = (e) => {
    e.preventDefault();
    const missing = Object.keys(validate());
    if (missing.length === 0) {
      setConfirming(true);
      return;
    }
    notify(
      `${missing.length} required answer${missing.length > 1 ? "s are" : " is"} missing, they are marked in red.`,
      "warning",
      { title: "Almost there" }
    );
    const first = document.getElementById(`q-${missing[0]}`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const feedback_data = {};
    feedbackQuestions.forEach((q) => {
      const v = answers[q.key];
      if (isAnswered(v)) feedback_data[q.key] = typeof v === "string" ? v.trim() : v;
    });
    try {
      const { data } = await api.post("/feedback/submit/", { attendee_id: attendee.attendee_id, feedback_data });
      const id = Number.isInteger(data?.id) ? data.id : null;
      if (id !== null) saveEntryNumber(id);
      setEntryId(id);
      markSubmittedOnDevice();
      setConfirming(false);
      setView("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const code = err?.response?.data?.code;
      setConfirming(false);
      if (code === "device_submitted") {
        markSubmittedOnDevice();
        setView("already");
      } else if (err?.response?.status === 403) {
        setView("closed");
      } else {
        if (code === "already_submitted") {
          setAttendees((list) => (list || []).filter((a) => a.attendee_id !== attendee.attendee_id));
          setAttendee(null);
        }
        notify(errorMessage(err), "danger", { title: "Not submitted" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const showIntro = view === "form" || view === "loading";
  let number = 1;

  const requiredTag = (required) =>
    required ? <span className="fb-tag fb-tag-req">Required</span> : <span className="fb-tag fb-tag-opt">Optional</span>;

  return (
    <div className="fb-page">
      <div className="fb-shell">
        <header className="fb-header">
          <div className="fb-header-bar">
            {HOME_URL && (
              <a className="fb-back" href={HOME_URL} aria-label="Go back">
                <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
            <h1 className={`fb-title${view === "success" ? " sr-only" : ""}`}>Feedback Form</h1>
          </div>
          {showIntro && (
            <>
              <p className="fb-intro">Your answers help shape next year. Every complete submission goes into the lucky draw at the closing session.</p>
              <ul className="fb-chips">
                {/* <li>About 1 Minute</li> */}
                <li>{REQUIRED_TOTAL} Answers Required</li>
                <li>One Entry Per Attendee</li>
              </ul>
            </>
          )}
          {view === "success" && <p className="fb-tagline">Your voice helps make each event better.</p>}
        </header>

        <main className="fb-body">
          {view === "loading" && (
            <div className="fb-panel" aria-busy="true">
              <span className="sr-only">Loading</span>
              {[0, 1, 2].map((i) => (
                <div className="fb-skeleton-block" key={i}>
                  <div className="skeleton skeleton-line w-50" />
                  <div className="skeleton skeleton-box" />
                </div>
              ))}
            </div>
          )}

          {view === "already" && (
            <StatusPanel
              tone="info"
              title="Feedback already received"
              extra={entryId !== null ? <DrawTicket id={entryId} /> : null}
            >
              You have already submitted your feedback from this device. Thank you for taking part.
            </StatusPanel>
          )}

          {view === "closed" && (
            <StatusPanel tone="closed" title="Event feedback is closed">
              The feedback form is not accepting responses right now. Please check with the event team.
            </StatusPanel>
          )}

          {view === "offline" && (
            <StatusPanel
              tone="offline"
              title="The form could not load"
              action={
                <button type="button" className="btn fb-btn fb-btn-primary mt-3" onClick={() => window.location.reload()}>
                  Try again
                </button>
              }
            >
              The feedback service did not respond. Check your connection and try again.
            </StatusPanel>
          )}

          {view === "success" && (
            <div className="fb-card fb-success" role="status">
              <span className="fb-success-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 12.5l4 4L18 8" />
                </svg>
              </span>
              <h2>You’re all set!</h2>
              <p>Your feedback has been submitted. Here is your number for the draw.</p>
              <DrawTicket id={entryId} />
              <p className="fb-success-note">Keep your number handy for the draw.</p>
            </div>
          )}

          {view === "form" && (
            <form className="fb-panel" onSubmit={handleReview} noValidate>
              <section className={`fb-name${errors.attendee ? " has-error" : ""}`} id="q-attendee">
                <label htmlFor="attendee-search" className="fb-name-label">
                  Your Name {requiredTag(true)}
                </label>
                <AttendeeSearch
                  attendees={attendees}
                  loadError={attendeesError}
                  onRetry={loadAttendees}
                  value={attendee}
                  onChange={(a) => {
                    setAttendee(a);
                    setErrors((e) => ({ ...e, attendee: false }));
                  }}
                  invalid={errors.attendee}
                />
              </section>

              {feedbackQuestions.map((q) => {
                const invalid = !!errors[q.key];
                const labelId = `${q.key}-label`;
                const labelled = q.type === "select" || q.type === "textarea";
                const LabelTag = labelled ? "label" : "div";
                return (
                  <section className={`fb-q${invalid ? " has-error" : ""}`} key={q.key} id={`q-${q.key}`}>
                    <LabelTag className="fb-q-head" id={labelId} htmlFor={labelled ? q.key : undefined}>
                      <span className="fb-q-num">{number++}.</span>
                      <span className="fb-q-text">
                        {q.label} {requiredTag(q.required)}
                      </span>
                    </LabelTag>

                    {q.type === "radio" && (
                      <div className={`fb-options${invalid ? " is-invalid" : ""}`} role="radiogroup" aria-labelledby={labelId}>
                        {q.options.map((opt) => (
                          <label key={opt} className={`fb-radio${answers[q.key] === opt ? " is-selected" : ""}`}>
                            <input
                              type="radio"
                              className="sr-only"
                              name={q.key}
                              value={opt}
                              checked={answers[q.key] === opt}
                              onChange={() => setAnswer(q.key, opt)}
                            />
                            <span className="fb-radio-mark" aria-hidden="true" />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {q.type === "select" && (
                      <div className={`fb-select${invalid ? " is-invalid" : ""}`}>
                        <select
                          id={q.key}
                          className={answers[q.key] ? "" : "is-empty"}
                          value={answers[q.key] || ""}
                          onChange={(e) => setAnswer(q.key, e.target.value)}
                        >
                          <option value="" disabled>
                            Select an option
                          </option>
                          {q.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <svg className="fb-select-caret" viewBox="0 0 12 8" aria-hidden="true">
                          <path d="M0 0h12L6 8z" />
                        </svg>
                      </div>
                    )}

                    {q.type === "checkbox" && (
                      <div className={`fb-checks${invalid ? " is-invalid" : ""}`} role="group" aria-labelledby={labelId}>
                        {q.options.map((opt) => (
                          <label
                            key={opt}
                            className={`fb-check${Array.isArray(answers[q.key]) && answers[q.key].includes(opt) ? " is-selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              name={q.key}
                              value={opt}
                              checked={Array.isArray(answers[q.key]) && answers[q.key].includes(opt)}
                              onChange={() => toggleOption(q, opt)}
                            />
                            <span className="fb-check-mark" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {q.type === "textarea" && (
                      <textarea
                        id={q.key}
                        className={`fb-textarea${invalid ? " is-invalid" : ""}`}
                        rows={3}
                        maxLength={2000}
                        placeholder="Type here..."
                        value={answers[q.key] || ""}
                        onChange={(e) => setAnswer(q.key, e.target.value)}
                      />
                    )}

                    {invalid && <div className="fb-error">Answer this question to continue.</div>}
                  </section>
                );
              })}

              <button type="submit" className="fb-submit">
                Submit
              </button>
            </form>
          )}
        </main>
      </div>

      {confirming && attendee && (
        <Modal
          title="Confirm it is you"
          className="fb-modal"
          onClose={() => !submitting && setConfirming(false)}
          footer={
            <>
              <button className="btn fb-btn fb-btn-ghost" disabled={submitting} onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button className="btn fb-btn fb-btn-primary" disabled={submitting} onClick={handleSubmit}>
                {submitting && <span className="spinner-border spinner-border-sm mr-2" aria-hidden="true" />}
                {submitting ? "Submitting" : "Submit feedback"}
              </button>
            </>
          }
        >
          <p className="fb-modal-note">Your feedback will be submitted under this attendee. You can only submit once.</p>
          <dl className="fb-confirm-list mb-0">
            <dt>Name</dt>
            <dd>{attendee.full_name}</dd>
            <dt>Company</dt>
            <dd>{attendee.company_name || "Not on file"}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
