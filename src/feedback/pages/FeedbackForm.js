import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useEvent, useEventPath } from "../../event/EventContext";
import api, { errorMessage, eventKey, padId } from "../api";
import AttendeeSearch from "../components/AttendeeSearch";
// eslint-disable-next-line no-unused-vars -- used by the confirm popup, commented out for now
import Modal from "../components/Modal";
import SpeakerReviews, { REVIEWS_KEY, reviewsToSubmit } from "../components/SpeakerReviews";
import TestimonialAssist, { AutoGrowTextarea, PolishButton, RollBackButton, testimonialHelper, testimonialOriginal } from "../components/TestimonialAssist";
import feedbackQuestions, { SESSIONS_AFTER } from "../config/feedbackQuestions";
import { useToast } from "../context/ToastContext";
import { hasSubmittedOnDevice, markSubmittedOnDevice, readEntryHolder, readEntryNumber, saveEntryHolder, saveEntryNumber } from "../utils/device";

// eslint-disable-next-line no-unused-vars -- used by the commented-out chips under the intro
const REQUIRED_TOTAL = feedbackQuestions.filter((q) => q.required).length + 1; // plus the name

const checkedIcon = "/common/images/checked.png" 

const PANEL_ICONS = {
  closed: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  upcoming: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  info: (
    <>
      <path d="M12 11v6" />
      <path d="M12 7.3v.2" />
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
  const number = hasNumber ? padId(id, 3) : "";
  return (
    <div className="dlgfb-form-ticket">
      <div className="dlgfb-form-ticket-main">
        <div className="dlgfb-form-ticket-text">
          <span className="dlgfb-form-ticket-kicker">Your draw number</span>
          <span className="dlgfb-form-ticket-title">Entry confirmed</span>
          <span className="dlgfb-form-ticket-sub">{hasNumber ? "Keep this number handy" : "You are in the raffle draw"}</span>
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

/** "Monday, November 9, 2026 at 12:00 AM", the opening time as it is where the event is held. */
function openingText(opensAt, timeZone) {
  if (!opensAt) return "";
  const options = { dateStyle: "full", timeStyle: "short" };
  try {
    return new Date(opensAt).toLocaleString(undefined, timeZone ? { ...options, timeZone } : options);
  } catch {
    return new Date(opensAt).toLocaleString(undefined, options);
  }
}

// Light check only, the backend validates the email properly.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAnswered(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
}

/** A "list" question is complete when every required field is filled, "Other" when its text is filled,
 any other question when it has an answer. */
function isComplete(q, answers) {
  const v = answers[q.key];
  if (q.type === "list") return q.fields.every((f, i) => !f.required || String(v?.[i] || "").trim() !== "");
  if (q.other && v === q.other) return String(answers[`${q.key}_other`] || "").trim() !== "";
  return isAnswered(v);
}

/** The questions for one event. A question with "optionsFrom" takes its options from that list in sources,
 and is left out while the list is empty. */
function eventQuestions(sources) {
  return feedbackQuestions
    .map((q) => {
      if (!q.optionsFrom) return q;
      const items = Array.isArray(sources[q.optionsFrom]) ? sources[q.optionsFrom] : [];
      return {
        ...q,
        options: items.map((item) => item.name),
        // The dates and the place, each on its own line under the name.
        optionDetails: Object.fromEntries(items.map((item) => [item.name, [item.dates, item.location].filter(Boolean)])),
      };
    })
    .filter((q) => !q.optionsFrom || q.options.length > 0);
}

const EDIT_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  </svg>
);

const SAVE_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

// One row of the confirm popup. The edit button turns the value into a text box in the same place,
// Enter or the tick saves it, Escape puts the old value back.
// eslint-disable-next-line no-unused-vars -- used by the confirm popup, commented out for now
function ConfirmRow({ label, value, editing, disabled, onEdit, onSave, onCancel }) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setInvalid(false);
    }
  }, [editing, value]);

  const save = () => {
    const next = draft.trim().replace(/\s+/g, " ");
    if (Array.from(next).length < 2) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <div className={`dlgfb-form-confirm-row${editing ? " dlgfb-is-editing" : ""}`}>
      <span className="dlgfb-form-confirm-label">{label} -</span>
      {editing ? (
        <input
          className={`dlgfb-form-confirm-input${invalid ? " dlgfb-is-invalid" : ""}`}
          value={draft}
          maxLength={255}
          autoFocus
          aria-label={label}
          aria-invalid={invalid}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              // Escape here only cancels the edit, not the whole popup.
              e.nativeEvent.stopImmediatePropagation();
              onCancel();
            }
          }}
        />
      ) : (
        <span className="dlgfb-form-confirm-value">{value || "---"}</span>
      )}
      <button
        type="button"
        className="dlgfb-form-confirm-edit"
        aria-label={editing ? `Save ${label}` : `Edit ${label}`}
        disabled={disabled}
        onClick={editing ? save : onEdit}
      >
        {editing ? SAVE_ICON : EDIT_ICON}
      </button>
      {editing && invalid && <span className="dlgfb-form-confirm-error">Enter at least 2 characters.</span>}
    </div>
  );
}

/** The question count, above the form, with a bar under it. */
function FormProgress({ count }) {
  return (
    <div className="dlgfb-form-progress">
      <div className="dlgfb-form-progress-head">
        <span>Your feedback</span>
        <span>{count} Questions</span>
      </div>
      <div className="dlgfb-form-progress-bar" aria-hidden="true" />
    </div>
  );
}

/** A conference's dates and place under its name, one line each. */
function OptionDetails({ lines }) {
  if (!lines?.length) return null;
  return lines.map((line) => (
    <span className="dlgfb-form-check-detail" key={line}>
      {line}
    </span>
  ));
}

/** The tick, the title and the raffle ticket number, after a submit and when this device has already submitted. */
function SubmittedCard({ title, subtitle, entryId, holder, homePath }) {
  const hasEntry = entryId !== null && entryId !== undefined;
  return (
    <div className="dlgfb-form-card dlgfb-form-success" role="status">
      <span className="dlgfb-form-success-icon" aria-hidden="true">
        <img src={checkedIcon} alt="Success" />
      </span>
      <h2>{title}</h2>
      <p className="dlgfb-form-success-sub">{subtitle}</p>
      {hasEntry && (
        <div className="dlgfb-form-raffle">
          <p className="dlgfb-form-raffle-kicker">Your raffle ticket</p>
          <p className="dlgfb-form-raffle-number">{entryId}</p>
          {holder?.name && <p className="dlgfb-form-raffle-name">{holder.name}</p>}
          {holder?.company && <p className="dlgfb-form-raffle-company">{holder.company}</p>}
        </div>
      )}
      <p className="dlgfb-form-raffle-note">
        The winner will be announced shortly. Please stay in the room to claim your prize if you win.
      </p>
      <p className="dlgfb-form-raffle-foot">Good luck!</p>
      {/* Takes the place of the header's back arrow, which is hidden once the feedback is in. */}
      <Link to={homePath} className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-home">
        Back to home page
      </Link>
    </div>
  );
}

// The form in progress is kept in this tab's session storage, so a refresh comes back with every answer. It is removed once the feedback is submitted; closing the tab drops it too.
const draftKey = () => eventKey("feedbackDraft");

function readDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey()) || "null");
    if (!draft || typeof draft !== "object") return null;
    // A suggestion that was still being written is asked for again when the text box is left.
    const answers = { ...(draft.answers || {}) };
    for (const key of Object.keys(answers)) {
      if (key.endsWith("_assist") && answers[key]?.status === "loading") answers[key] = { status: "idle" };
    }
    return { attendee: draft.attendee || null, answers };
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(draftKey());
  } catch {
    /* storage blocked, nothing was saved */
  }
}

export default function FeedbackForm() {
  const notify = useToast();
  const eventPath = useEventPath();
  const eventConfig = useEvent().config;
  const { logo, background } = eventConfig.media || {};
  // This event's limit on session reviews in all, "speakerReviews.maxReviews" in backend/events.json.
  const maxReviews = eventConfig.speakerReviews?.maxReviews;
  // The last question's options, the conferences listed on the event's website.
  const [upcomingConferences, setUpcomingConferences] = useState([]);
  // The agenda's speaker sessions, each one can be reviewed after the questions.
  const [speakerSessions, setSpeakerSessions] = useState([]);
  const [draft] = useState(readDraft);
  // Every question is on one screen, under the name.
  const questions = useMemo(() => eventQuestions({ upcomingConferences }), [upcomingConferences]);
  // loading | already | upcoming | closed | form | success | offline
  const [view, setView] = useState("loading");
  const [attendees, setAttendees] = useState(null);
  const [attendeesError, setAttendeesError] = useState(false);
  const [attendee, setAttendee] = useState(() => draft?.attendee ?? null);
  const [answers, setAnswers] = useState(() => draft?.answers ?? {});
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  // A refusal shown inside the confirm card, in place of a toast.
  // eslint-disable-next-line no-unused-vars -- kept for the confirm popup, commented out for now
  const [confirmError, setConfirmError] = useState(null);
  // The confirm popup field being edited, "full_name" or "company_name", or null.
  // eslint-disable-next-line no-unused-vars -- kept for the confirm popup, commented out for now
  const [editingField, setEditingField] = useState(null);
  // Name and company as shown on the confirm popup, saved as the alias. Kept apart from the attendee,
  // so a new attendee's typed name is saved as their real name even when the popup changes it.
  const [alias, setAlias] = useState({ full_name: "", company_name: "" });
  const [submitting, setSubmitting] = useState(false);
  const [entryId, setEntryId] = useState(() => readEntryNumber());
  const [entryHolder, setEntryHolder] = useState(() => readEntryHolder());
  // When the form opens, at 12:00 AM of the event's first day where it is held. Comes with the event config, and with
  // the server's refusal when a page loaded before the opening is used.
  const [opening, setOpening] = useState({ opensAt: eventConfig.feedback_opens_at, timeZone: eventConfig.time_zone });

  /** Shows the closed or not open yet card when the server refuses because the form takes no answers now. */
  const notOpenYet = (err) => {
    const code = err?.response?.status === 403 ? err.response.data?.code : null;
    if (code === "closed") {
      setView("closed");
      return true;
    }
    if (code !== "not_open") return false;
    setOpening({ opensAt: err.response.data.opens_at, timeZone: err.response.data.time_zone });
    setView("upcoming");
    return true;
  };

  const loadAttendees = useCallback(() => {
    setAttendeesError(false);
    setAttendees(null);
    return api
      .get("/attendees/")
      .then(({ data }) => setAttendees(Array.isArray(data) ? data : []))
      .catch((err) => {
        const code = err?.response?.status === 403 ? err.response.data?.code : null;
        if (code === "closed") setView("closed");
        else if (code === "not_open") {
          setOpening({ opensAt: err.response.data.opens_at, timeZone: err.response.data.time_zone });
          setView("upcoming");
        } else setAttendeesError(true);
      });
  }, []);

  useEffect(() => {
    // Pre-check: device already submitted
    if (hasSubmittedOnDevice()) {
      clearDraft();
      setView("already");
      return;
    }
    // Before 12:00 AM of the event's first day where it is held, the form says when it opens. After that it is open
    // for good, also after the raffle draw.
    // An admin can also close the form, it then says so until they open it again.
    if (eventConfig.feedback_closed) {
      setView("closed");
      return undefined;
    }
    if (eventConfig.feedback_open === false) {
      setView("upcoming");
      return undefined;
    }
    let cancelled = false;
    setView("form");
    loadAttendees();
    // Without the list the last question is left out, so a failure needs no message.
    api
      .get("/upcoming-conferences/")
      .then(({ data: list }) => !cancelled && setUpcomingConferences(Array.isArray(list) ? list : []))
      .catch(() => {});
    // Without the sessions the reviews are left out, so a failure needs no message.
    api
      .get("/speaker-sessions/")
      .then(({ data: list }) => !cancelled && setSpeakerSessions(Array.isArray(list) ? list : []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only on page load, a later config reload must not reset a form in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttendees]);

  // Saves the form in progress after every change.
  useEffect(() => {
    if (view !== "form") return;
    try {
      sessionStorage.setItem(draftKey(), JSON.stringify({ attendee, answers }));
    } catch {
      /* storage blocked or full, the form still works without the draft */
    }
  }, [view, attendee, answers]);

  // One field of a "list" question, the others keep their text.
  const setListAnswer = (q, index, val) => {
    setAnswers((a) => {
      const list = [...(a[q.key] || q.fields.map(() => ""))];
      list[index] = val;
      return { ...a, [q.key]: list };
    });
    setErrors((e) => ({ ...e, [q.key]: false }));
  };

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

  /** Checks the name, company and email, then every question, in the order they are shown. */
  const validate = () => {
    const next = {};
    if (!attendee) next.attendee = true;
    else if (attendee.is_new) {
      if (attendee.company_name.trim().length < 2) next.company = true;
      const email = attendee.email.trim();
      if (!EMAIL_RE.test(email)) next.email = true;
    }
    questions.forEach((q) => {
      if (q.required && !isComplete(q, answers)) next[q.key] = true;
    });
    setErrors(next);
    return next;
  };

  // Submit Feedback submits straight away once every required answer is in, the name and company on the form are
  // saved as the display name. The "Your Display Name" confirm popup is commented out below.
  const handleContinue = (e) => {
    e.preventDefault();
    if (submitting) return;
    const missing = Object.keys(validate());
    if (missing.length === 0) {
      setConfirmError(null);
      setEditingField(null);
      const confirmed = { full_name: attendee.full_name.trim(), company_name: attendee.company_name.trim() };
      setAlias(confirmed);
      // setConfirming(true);
      handleSubmit(confirmed);
      return;
    }
    notify(
      `${missing.length} required answer${missing.length > 1 ? "s are" : " is"} missing, they are marked in red.`,
      "warning",
      { title: "Almost there" }
    );
    const first = document.getElementById(`q-${["attendee", "company", "email"].includes(missing[0]) ? "attendee" : missing[0]}`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Sends the feedback. alias is the display name and company, from the form, or from the popup when it is used. */
  const handleSubmit = async (confirmed = alias) => {
    setSubmitting(true);
    const feedback_data = {};
    questions.forEach((q) => {
      let v = q.type === "list" ? (answers[q.key] || []).map((text) => text.trim()).filter(Boolean) : answers[q.key];
      if (q.other && v === q.other) v = `Other: ${String(answers[`${q.key}_other`] || "").trim()}`;
      if (q.aiSuggestion) {
        // The text in the box is the answer. When Polish changed it, the attendee's own words are kept beside it.
        if (isAnswered(v)) {
          const original = testimonialOriginal(answers, q.key);
          const polished = original !== undefined && String(v).trim() !== original;
          if (polished) feedback_data[`${q.key}_original`] = original;
          feedback_data[`${q.key}_version`] = polished ? "polished" : "original";
        }
        // The marketing question is saved when Yes or No was picked.
        const consent = answers[`${q.key}_consent`];
        if (consent === "Yes" || consent === "No") feedback_data[`${q.key}_consent`] = consent;
      }
      if (isAnswered(v)) feedback_data[q.key] = typeof v === "string" ? v.trim() : v;
    });
    const speakerReviews = reviewsToSubmit(speakerSessions, answers[REVIEWS_KEY]);
    if (speakerReviews.length) feedback_data[REVIEWS_KEY] = speakerReviews;
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
      // The popup's name and company are always saved as the alias, edited or not.
      const aliasFields = { alias_name: confirmed.full_name, company_alias_name: confirmed.company_name };
      const { data } = await api.post("/feedback/submit/", { ...who, ...aliasFields, feedback_data });
      const id = Number.isInteger(data?.id) ? data.id : null;
      if (id !== null) saveEntryNumber(id);
      setEntryId(id);
      // The ticket shows the name and company as confirmed on the popup, the same the raffle draw shows.
      const holder = { name: confirmed.full_name.trim(), company: confirmed.company_name.trim() };
      saveEntryHolder(holder);
      setEntryHolder(holder);
      markSubmittedOnDevice();
      clearDraft();
      setConfirming(false);
      setView("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const code = err?.response?.data?.code;
      // With the confirm popup this refusal was shown inside it. Without it, it shows as a toast below.
      if (confirming && attendee.is_new && (code === "already_submitted" || code === "email_exists")) {
        // Same name and company already submitted, or the email belongs to someone listed, keep the card open and say so there.
        setConfirmError(errorMessage(err));
        return;
      }
      setConfirming(false);
      if (notOpenYet(err)) return;
      if (code === "already_submitted" && !attendee.is_new) {
        setAttendees((list) => (list || []).filter((a) => a.attendee_id !== attendee.attendee_id));
        setAttendee(null);
      } else if (code === "attendee_exists") {
        // The name was added to the list after this page loaded, reload it so it can be picked.
        setAttendee(null);
        loadAttendees();
      }
      notify(errorMessage(err), "danger", { title: "Not submitted" });
    } finally {
      setSubmitting(false);
    }
  };

  const showIntro = view === "form" || view === "loading";

  // "Which presentations did you find most valuable?", after question SESSIONS_AFTER when the agenda has speaker sessions.
  const hasSessions = speakerSessions.length > 0;
  const sessionsQuestion = hasSessions && (
    <SpeakerReviews
      sessions={speakerSessions}
      reviews={answers[REVIEWS_KEY]}
      maxReviews={maxReviews}
      onChange={(next) => setAnswer(REVIEWS_KEY, next)}
    />
  );

  // The thank you screens, after a submit or for a device that already submitted.
  const submitted = view === "success" || view === "already";

  // eslint-disable-next-line no-unused-vars -- kept for when the Required tag beside Your Name is shown again
  const requiredTag = (required) =>
    required ? <span className="dlgfb-form-tag dlgfb-form-tag-req">Required</span> : <span className="dlgfb-form-tag dlgfb-form-tag-opt">Optional</span>;

  return (
    <div className="dlgfb-form-page feedback-form-page" style={background ? { "--event-pattern": `url(${background})` } : undefined}>
      <div className="dlgfb-form-shell">
        <header className="dlgfb-form-header">
          <div className="dlgfb-form-header-bar">
            {!submitted && <Link
              className="dlgfb-form-back"
              to={eventPath()}
              aria-label="Go back"
            >
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>}
            <h1 className={`dlgfb-form-title${view === "success" ? " dlgfb-sr-only" : ""}`}>Feedback Form</h1>
          </div>
          {logo && <img src={logo} alt="" className="dlgfb-form-logo" />}
          {showIntro && (
            <>
              <p className="dlgfb-form-intro">
                Your feedback helps shape our future conferences. Complete this short survey for a chance to win a prize in our
                closing raffle draw.
              </p>
              {/* <ul className="dlgfb-form-chips">
                
                <li>{REQUIRED_TOTAL} Answers Required</li>
                <li>One Entry Per Attendee</li>
              </ul> */}
            </>
          )}
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
            <SubmittedCard
              title="You’re Already In!"
              subtitle="We’ve already got your feedback. It’s one entry per attendee."
              entryId={entryId}
              holder={entryHolder}
              homePath={eventPath()}
            />
          )}

          {view === "closed" && (
            <StatusPanel tone="closed" title="The feedback form is closed">
              Feedback is not being taken at the moment. Thank you for your interest.
            </StatusPanel>
          )}

          {view === "upcoming" && (
            <StatusPanel tone="upcoming" title="The feedback form is not open yet">
              {opening.opensAt
                ? `It opens when the event starts, on ${openingText(opening.opensAt, opening.timeZone)} at the venue. Please come back then.`
                : "It opens when the event starts. Please come back then."}
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
            <SubmittedCard
              title="You’re all set!"
              subtitle="Thank you for your feedback."
              entryId={entryId}
              holder={entryHolder}
              homePath={eventPath()}
            />
          )}

          {view === "form" && (
            <form className="dlgfb-form-panel" onSubmit={handleContinue} noValidate>
              <FormProgress count={questions.length + (hasSessions ? 1 : 0)} />

              <section className={`dlgfb-form-name${errors.attendee || errors.company || errors.email ? " dlgfb-has-error" : ""}`} id="q-attendee">
                <label htmlFor="attendee-search" className="dlgfb-form-name-label">
                  Your name
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

              {questions.map((q, index) => {
                const invalid = !!errors[q.key];
                const labelId = `${q.key}-label`;
                const labelled = q.type === "select" || q.type === "textarea";
                const LabelTag = labelled ? "label" : "div";
                const assistHelper = q.aiSuggestion ? testimonialHelper(q, answers, setAnswers) : null;
                const TextBox = assistHelper ? AutoGrowTextarea : "textarea";
                return (
                  <Fragment key={q.key}>
                  {hasSessions && index === SESSIONS_AFTER && sessionsQuestion}
                  <section className={`dlgfb-form-q${invalid ? " dlgfb-has-error" : ""}`} id={`q-${q.key}`}>
                    <LabelTag className="dlgfb-form-q-head" id={labelId} htmlFor={labelled ? q.key : undefined}>
                      <span className="dlgfb-form-q-text">{q.label}</span>
                    </LabelTag>

                    <div className="dlgfb-form-q-body">
                      {q.hint && <p className="dlgfb-form-q-hint">{q.hint}</p>}

                      {q.type === "radio" && (
                        <div className={`dlgfb-form-options${invalid && !answers[q.key] ? " dlgfb-is-invalid" : ""}`} role="radiogroup" aria-labelledby={labelId}>
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
                              {q.optionDetails ? (
                                <span className="dlgfb-form-check-label">
                                  <span className="dlgfb-form-check-title">{opt}</span>
                                  <OptionDetails lines={q.optionDetails[opt]} />
                                </span>
                              ) : (
                                <span>{opt}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}

                      {q.type === "radio" && q.other && answers[q.key] === q.other && (
                        <input
                          type="text"
                          className={`dlgfb-form-input dlgfb-form-other${invalid && !(answers[`${q.key}_other`] || "").trim() ? " dlgfb-is-invalid" : ""}`}
                          placeholder={q.otherPlaceholder || "Please specify *"}
                          aria-label="Please specify"
                          maxLength={200}
                          autoFocus
                          value={answers[`${q.key}_other`] || ""}
                          onChange={(e) => {
                            setAnswer(`${q.key}_other`, e.target.value);
                            setErrors((err) => ({ ...err, [q.key]: false }));
                          }}
                        />
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
                              {q.optionDetails ? (
                                <span className="dlgfb-form-check-label">
                                  <span className="dlgfb-form-check-title">{opt}</span>
                                  <OptionDetails lines={q.optionDetails[opt]} />
                                </span>
                              ) : (
                                <span>{opt}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}

                      {q.type === "textarea" && (
                        <div className={assistHelper ? "dlgfb-polish-wrap" : undefined}>
                          <TextBox
                            id={q.key}
                            className={`dlgfb-form-textarea${invalid ? " dlgfb-is-invalid" : ""}`}
                            rows={4}
                            maxLength={2000}
                            placeholder={q.placeholder || "Type here..."}
                            value={answers[q.key] || ""}
                            // Held while Polish is working, so the polished text does not overwrite new typing.
                            readOnly={assistHelper?.assist.status === "loading"}
                            onChange={(e) => setAnswer(q.key, e.target.value)}
                          />
                          {assistHelper && (
                            <div className="dlgfb-polish-actions">
                              <PolishButton text={answers[q.key] || ""} helper={assistHelper} />
                              <RollBackButton helper={assistHelper} />
                            </div>
                          )}
                        </div>
                      )}

                      {assistHelper && <TestimonialAssist q={q} helper={assistHelper} />}

                      {q.type === "list" && (
                        <div className={`dlgfb-form-list${q.numbered ? " dlgfb-is-numbered" : ""}`} role="group" aria-labelledby={labelId}>
                          {q.fields.map((f, i) => {
                            const input = (
                              <input
                                type="text"
                                className={`dlgfb-form-input${invalid && f.required && !(answers[q.key]?.[i] || "").trim() ? " dlgfb-is-invalid" : ""}`}
                                placeholder={f.placeholder}
                                aria-label={q.numbered ? `${f.placeholder} ${i + 1}` : f.placeholder}
                                maxLength={200}
                                value={answers[q.key]?.[i] || ""}
                                onChange={(e) => setListAnswer(q, i, e.target.value)}
                              />
                            );
                            // "1." beside the box for a numbered list, the placeholders repeat there.
                            return q.numbered ? (
                              <div className="dlgfb-form-list-row" key={i}>
                                <span className="dlgfb-form-list-num" aria-hidden="true">
                                  {i + 1}.
                                </span>
                                {input}
                              </div>
                            ) : (
                              <Fragment key={i}>{input}</Fragment>
                            );
                          })}
                        </div>
                      )}

                      {invalid && (
                        <div className="dlgfb-form-error">
                          {q.other && answers[q.key] === q.other ? "Please specify your answer." : "Please answer this question."}
                        </div>
                      )}
                    </div>
                  </section>
                  </Fragment>
                );
              })}

              {/* Fewer questions than SESSIONS_AFTER, the sessions go last. */}
              {hasSessions && questions.length <= SESSIONS_AFTER && sessionsQuestion}

              <p className="dlgfb-form-submit-note">
                If you win, your name and company will be announced and displayed on the conference screen.
              </p>
              <button type="submit" className="dlgfb-form-submit" disabled={submitting}>
                {submitting && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
                {submitting ? "Submitting" : "Submit Feedback"}
              </button>
            </form>
          )}
        </main>
      </div>

      {/* "Your Display Name" confirm popup, not used for now: Submit Feedback submits straight away and the success
          card opens. To bring it back, uncomment this block and setConfirming(true) in handleContinue.
      {confirming && attendee && (
        <Modal
          title="Your Display Name"
          className="dlgfb-form-modal"
          showClose={false}
          onClose={() => !submitting && setConfirming(false)}
          footer={
            <>
              <button className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-ghost" disabled={submitting} onClick={() => setConfirming(false)}>
                GO BACK
              </button>
              <button
                className="dlgfb-btn dlgfb-form-btn dlgfb-form-btn-primary"
                disabled={submitting || !!confirmError || editingField !== null}
                onClick={handleSubmit}
              >
                {submitting && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />}
                {submitting ? "SUBMITTING" : "SUBMIT"}
              </button>
            </>
          }
        >
          {confirmError ? (
            <p className="dlgfb-form-modal-error" role="alert">{confirmError}</p>
          ) : (
            <p className="dlgfb-form-modal-note">
              <strong>Disclaimer</strong> - The host will call out your name and company name, and they will appear on the screen,
              exactly as shown below. Use the edit button to change them. Only one submission is allowed per person.
            </p>
          )}
          <div className="dlgfb-form-confirm-list dlgfb-mb-0">
            {[
              { key: "full_name", label: "Display Name" },
              { key: "company_name", label: "Company Name" },
            ].map(({ key, label }) => (
              <ConfirmRow
                key={key}
                label={label}
                value={alias[key]}
                editing={editingField === key}
                disabled={submitting || (editingField !== null && editingField !== key)}
                onEdit={() => setEditingField(key)}
                onCancel={() => setEditingField(null)}
                onSave={(next) => {
                  // A refusal is about the name typed on the form, so it stays until Go back.
                  setAlias((a) => ({ ...a, [key]: next }));
                  setEditingField(null);
                }}
              />
            ))}
            {attendee.is_new && attendee.email.trim() && (
              <div className="dlgfb-form-confirm-row">
                <span className="dlgfb-form-confirm-label">Email -</span>
                <span className="dlgfb-form-confirm-value dlgfb-text-break">{attendee.email.trim()}</span>
              </div>
            )}
          </div>
        </Modal>
      )} */}
    </div>
  );
}
