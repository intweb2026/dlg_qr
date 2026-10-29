import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useEventPath } from "../../event/EventContext";
import api, { errorMessage, padId } from "../api";
import AttendeeSearch from "../components/AttendeeSearch";
import Modal from "../components/Modal";
import feedbackQuestions from "../config/feedbackQuestions";
import { useToast } from "../context/ToastContext";
import { hasSubmittedOnDevice, markSubmittedOnDevice, readEntryNumber, saveEntryNumber } from "../utils/device";

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
    <div className={`dlgfb-form-card dlgfb-form-status dlgfb-form-status-${tone}`} role="status">
      <span className="dlgfb-form-status-icon" aria-hidden="true">
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

// eslint-disable-next-line no-unused-vars -- kept for when the draw ticket is shown again
function DrawTicket({ id }) {
  const hasNumber = id !== null && id !== undefined;
  const number = hasNumber ? padId(id, 2) : "";
  return (
    <div className="dlgfb-form-ticket">
      <div className="dlgfb-form-ticket-main">
        <div className="dlgfb-form-ticket-text">
          <span className="dlgfb-form-ticket-kicker">Your draw number</span>
          <span className="dlgfb-form-ticket-title">Entry confirmed</span>
          <span className="dlgfb-form-ticket-sub">{hasNumber ? "Keep this number handy" : "You are in the lucky draw"}</span>
        </div>
        {hasNumber && (
          <span
            className={`dlgfb-form-ticket-number${number.length > 3 ? " dlgfb-is-long" : number.length === 3 ? " dlgfb-is-mid" : ""}`}
            aria-label={`Draw number ${number}`}
          >
            {number}
          </span>
        )}
      </div>
      <div className="dlgfb-form-ticket-foot">Thank you for taking part</div>
    </div>
  );
}

// Light check only, the backend validates the email properly.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAnswered(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export default function FeedbackForm() {
  const notify = useToast();
  const eventPath = useEventPath();
  // loading | already | closed | form | success | offline
  const [view, setView] = useState("loading");
  const [attendees, setAttendees] = useState(null);
  const [attendeesError, setAttendeesError] = useState(false);
  const [attendee, setAttendee] = useState(null);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  // A refusal shown inside the confirm card, in place of a toast.
  const [confirmError, setConfirmError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-unused-vars -- read by the DrawTicket lines, commented out below
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
      .then(({ data }) => setView((v) => (v === "closed" || !data.is_active ? "closed" : "form")))
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
    else if (attendee.is_new) {
      if (attendee.company_name.trim().length < 2) next.company = true;
      const email = attendee.email.trim();
      if (email && !EMAIL_RE.test(email)) next.email = true;
    }
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
      setConfirmError(null);
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
      // A name that is not on the list is sent as new_attendee, the backend creates it with the submission.
      const who = attendee.is_new
        ? {
            new_attendee: {
              full_name: attendee.full_name,
              company_name: attendee.company_name.trim(),
              email: attendee.email.trim() || null,
            },
          }
        : { attendee_id: attendee.attendee_id };
      const { data } = await api.post("/feedback/submit/", { ...who, feedback_data });
      const id = Number.isInteger(data?.id) ? data.id : null;
      if (id !== null) saveEntryNumber(id);
      setEntryId(id);
      markSubmittedOnDevice();
      setConfirming(false);
      setView("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const code = err?.response?.data?.code;
      if (attendee.is_new && (code === "already_submitted" || code === "email_exists")) {
        // Same name and company already submitted, or the email belongs to someone listed, keep the card open and say so there.
        setConfirmError(errorMessage(err));
        return;
      }
      setConfirming(false);
      if (err?.response?.status === 403) {
        setView("closed");
      } else {
        if (code === "already_submitted" && !attendee.is_new) {
          setAttendees((list) => (list || []).filter((a) => a.attendee_id !== attendee.attendee_id));
          setAttendee(null);
        } else if (code === "attendee_exists") {
          // The name was added to the list after this page loaded, reload it so it can be picked.
          setAttendee(null);
          loadAttendees();
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
    required ? <span className="dlgfb-form-tag dlgfb-form-tag-req">Required</span> : <span className="dlgfb-form-tag dlgfb-form-tag-opt">Optional</span>;

  return (
    <div className="dlgfb-form-page">
      <div className="dlgfb-form-shell">
        <header className="dlgfb-form-header">
          <div className="dlgfb-form-header-bar">
            <Link className="dlgfb-form-back" to={eventPath()} aria-label="Go back">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className={`dlgfb-form-title${view === "success" ? " dlgfb-sr-only" : ""}`}>Feedback Form</h1>
          </div>
          {showIntro && (
            <>
              <p className="dlgfb-form-intro">Your answers help shape next year. Every complete submission goes into the lucky draw at the closing session.</p>
              <ul className="dlgfb-form-chips">
                {/* <li>About 1 Minute</li> */}
                <li>{REQUIRED_TOTAL} Answers Required</li>
                <li>One Entry Per Attendee</li>
              </ul>
            </>
          )}
          {/* Moved into the success card, as its last line */}
          {/* {view === "success" && <p className="dlgfb-form-tagline">Your voice helps make each event better.</p>} */}
        </header>

        <main className="dlgfb-form-body">
          {view === "loading" && (
            <div className="dlgfb-form-panel" aria-busy="true">
              <span className="dlgfb-sr-only">Loading</span>
              {[0, 1, 2].map((i) => (
                <div className="dlgfb-form-skeleton-block" key={i}>
                  <div className="dlgfb-skeleton dlgfb-skeleton-line dlgfb-w-50" />
                  <div className="dlgfb-skeleton dlgfb-skeleton-box" />
                </div>
              ))}
            </div>
          )}

          {view === "already" && (
            <StatusPanel
              tone="info"
              title="Feedback already received"
              // extra={entryId !== null ? <DrawTicket id={entryId} /> : null}
            >
              You have already submitted your feedback. Thank you for taking part.
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
                <button type="button" className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-primary dlgfb-mt-3" onClick={() => window.location.reload()}>
                  Try again
                </button>
              }
            >
              The feedback service did not respond. Check your connection and try again.
            </StatusPanel>
          )}

          {view === "success" && (
            <div className="dlgfb-form-card dlgfb-form-success" role="status">
              <span className="dlgfb-form-success-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 12.5l4 4L18 8" />
                </svg>
              </span>
              <h2>You’re all set!</h2>
              <p>Your feedback has been submitted.</p>
              {/* <DrawTicket id={entryId} />
              <p className="dlgfb-form-success-note">Keep your number handy for the draw.</p> */}
              <div className="dlgfb-form-success-quote">
                <p>Your voice helps make each event better.</p>
              </div>
            </div>
          )}

          {view === "form" && (
            <form className="dlgfb-form-panel" onSubmit={handleReview} noValidate>
              <section className={`dlgfb-form-name${errors.attendee || errors.company || errors.email ? " dlgfb-has-error" : ""}`} id="q-attendee">
                <label htmlFor="attendee-search" className="dlgfb-form-name-label">
                  Your Name {requiredTag(true)}
                </label>
                <AttendeeSearch
                  attendees={attendees}
                  loadError={attendeesError}
                  onRetry={loadAttendees}
                  value={attendee}
                  onChange={(a) => {
                    setAttendee(a);
                    setErrors((e) => ({ ...e, attendee: false, company: false, email: false }));
                  }}
                  invalid={errors.attendee}
                  companyInvalid={errors.company}
                  emailInvalid={errors.email}
                />
              </section>

              {feedbackQuestions.map((q) => {
                const invalid = !!errors[q.key];
                const labelId = `${q.key}-label`;
                const labelled = q.type === "select" || q.type === "textarea";
                const LabelTag = labelled ? "label" : "div";
                return (
                  <section className={`dlgfb-form-q${invalid ? " dlgfb-has-error" : ""}`} key={q.key} id={`q-${q.key}`}>
                    <LabelTag className="dlgfb-form-q-head" id={labelId} htmlFor={labelled ? q.key : undefined}>
                      <span className="dlgfb-form-q-num">{number++}.</span>
                      <span className="dlgfb-form-q-text">
                        {q.label} {requiredTag(q.required)}
                      </span>
                    </LabelTag>

                    {q.type === "radio" && (
                      <div className={`dlgfb-form-options${invalid ? " dlgfb-is-invalid" : ""}`} role="radiogroup" aria-labelledby={labelId}>
                        {q.options.map((opt) => (
                          <label key={opt} className={`dlgfb-form-radio${answers[q.key] === opt ? " dlgfb-is-selected" : ""}`}>
                            <input
                              type="radio"
                              className="dlgfb-sr-only"
                              name={q.key}
                              value={opt}
                              checked={answers[q.key] === opt}
                              onChange={() => setAnswer(q.key, opt)}
                            />
                            <span className="dlgfb-form-radio-mark" aria-hidden="true" />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {q.type === "select" && (
                      <div className={`dlgfb-form-select${invalid ? " dlgfb-is-invalid" : ""}`}>
                        <select
                          id={q.key}
                          className={answers[q.key] ? "" : "dlgfb-is-empty"}
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
                        <svg className="dlgfb-form-select-caret" viewBox="0 0 12 8" aria-hidden="true">
                          <path d="M0 0h12L6 8z" />
                        </svg>
                      </div>
                    )}

                    {q.type === "checkbox" && (
                      <div className={`dlgfb-form-checks${invalid ? " dlgfb-is-invalid" : ""}`} role="group" aria-labelledby={labelId}>
                        {q.options.map((opt) => (
                          <label
                            key={opt}
                            className={`dlgfb-form-check${Array.isArray(answers[q.key]) && answers[q.key].includes(opt) ? " dlgfb-is-selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="dlgfb-sr-only"
                              name={q.key}
                              value={opt}
                              checked={Array.isArray(answers[q.key]) && answers[q.key].includes(opt)}
                              onChange={() => toggleOption(q, opt)}
                            />
                            <span className="dlgfb-form-check-mark" aria-hidden="true">
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
                        className={`dlgfb-form-textarea${invalid ? " dlgfb-is-invalid" : ""}`}
                        rows={3}
                        maxLength={2000}
                        placeholder="Type here..."
                        value={answers[q.key] || ""}
                        onChange={(e) => setAnswer(q.key, e.target.value)}
                      />
                    )}

                    {invalid && <div className="dlgfb-form-error">Answer this question to continue.</div>}
                  </section>
                );
              })}

              <button type="submit" className="dlgfb-form-submit">
                Submit
              </button>
            </form>
          )}
        </main>
      </div>

      {confirming && attendee && (
        <Modal
          title="Confirm it is you"
          className="dlgfb-form-modal"
          onClose={() => !submitting && setConfirming(false)}
          footer={
            <>
              <button className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-ghost" disabled={submitting} onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-primary" disabled={submitting || !!confirmError} onClick={handleSubmit}>
                {submitting && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
                {submitting ? "Submitting" : "Submit feedback"}
              </button>
            </>
          }
        >
          {confirmError ? (
            <p className="dlgfb-form-modal-error" role="alert">{confirmError}</p>
          ) : (
            <p className="dlgfb-form-modal-note">Your feedback will be submitted under this attendee. You can only submit once.</p>
          )}
          <dl className="dlgfb-form-confirm-list dlgfb-mb-0">
            <dt>Name</dt>
            <dd>{attendee.full_name}</dd>
            <dt>Company</dt>
            <dd>{attendee.company_name.trim() || "---"}</dd>
            {attendee.is_new && attendee.email.trim() && (
              <>
                <dt>Email</dt>
                <dd className="dlgfb-text-break">{attendee.email.trim()}</dd>
              </>
            )}
          </dl>
        </Modal>
      )}
    </div>
  );
}
