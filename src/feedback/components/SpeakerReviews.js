import { useState } from "react";
import { ratingScale } from "../config/feedbackQuestions";

// "Which presentations did you find most valuable?", question 6 of the form. The agenda's speaker sessions, see
// backend/src/views/speakerSessions.js, listed under a heading per day, each with a tick box. Picking is optional.
// Picks are kept as { [session id]: { selected: true } }. Reviews from the earlier version of this question, with a
// rating or a comment, are still read the same way, so a saved draft keeps them.

export const REVIEWS_KEY = "speaker_reviews";

// How many presentations an attendee can pick in all, whatever the day, is set per event, "speakerReviews.maxReviews"
// in backend/events.json, and comes in the event config. This is the default for a config without it; the backend
// checks the same limit on submit.
const DEFAULT_MAX_REVIEWS = 3;

const MODERATOR_RE = /\s*\|\s*moderator\s*$/i;

/** "Name - Company", or the name alone when the agenda gives no company. Saved with each pick. */
function speakerText(s) {
  const company = s.company.replace(MODERATOR_RE, "").trim();
  return company ? `${s.name} - ${company}` : s.name;
}

export function speakerLine(session) {
  return session.speakers.map(speakerText).join(", ");
}

/** One speaker on the list, "Name | Company", with "(moderator)" after a moderator's company. */
function speakerRow(s) {
  const moderator = MODERATOR_RE.test(s.company);
  const company = s.company.replace(MODERATOR_RE, "").trim();
  return `${company ? `${s.name} | ${company}` : s.name}${moderator ? " (moderator)" : ""}`;
}

// Lowercase and strip accents, so "bajio" finds "Bajío", the same as the attendee search.
function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Everything a session can be found by, the full and short title, the speakers and their organisations. */
function searchText(session) {
  const people = session.speakers.map((sp) => `${sp.name} ${sp.company}`).join(" ");
  return normalize(`${session.title} ${session.short_title || ""} ${people}`);
}

/** True when every word typed is somewhere in the session, in any order. */
function matches(session, terms) {
  const hay = searchText(session);
  return terms.every((t) => hay.includes(t));
}

function hasReview(r) {
  return !!r && (r.selected === true || r.rating > 0 || String(r.comment || "").trim() !== "");
}

/** The picks to save, one per ticked session, in the order of the agenda. */
export function reviewsToSubmit(sessions, reviews) {
  return sessions
    .filter((s) => hasReview(reviews?.[s.id]))
    .map((s) => {
      const r = reviews[s.id];
      const rating = r.rating > 0 ? r.rating : null;
      const out = {
        session_id: s.id,
        title: s.title,
        short_title: s.short_title || "",
        speakers: speakerLine(s),
        day: s.day,
        start_time: s.start_time,
        end_time: s.end_time,
        rating,
        rating_label: rating ? ratingScale.find((x) => x.value === rating)?.label || "" : "",
      };
      const comment = String(r.comment || "").trim();
      if (comment) out.comment = comment;
      return out;
    });
}

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function SessionPick({ session, picked, locked, onToggle }) {
  return (
    <label className={`dlgfb-session-pick${picked ? " dlgfb-is-selected" : ""}${locked ? " dlgfb-is-locked" : ""}`}>
      <input type="checkbox" className="dlgfb-sr-only" checked={picked} disabled={locked} onChange={onToggle} />
      <span className="dlgfb-form-check-mark" aria-hidden="true">
        {CHECK}
      </span>
      <span className="dlgfb-session-pick-text">
        {session.start_time && <span className="dlgfb-session-pick-time">{session.start_time}</span>}
        {/* The short title from the backend, or the full one when there is none. */}
        <span className="dlgfb-session-pick-title">{session.short_title || session.title}</span>
        {session.speakers.map((s, i) => (
          <span className="dlgfb-session-pick-speaker" key={i}>
            {speakerRow(s)}
          </span>
        ))}
      </span>
    </label>
  );
}

export default function SpeakerReviews({ sessions, reviews, maxReviews = DEFAULT_MAX_REVIEWS, onChange }) {
  const [query, setQuery] = useState("");
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const toggle = (id) => onChange({ ...(reviews || {}), [id]: hasReview(reviews?.[id]) ? null : { selected: true } });

  // Counted over every day, not only the sessions the search shows. At the limit the other sessions are locked.
  const picked = sessions.filter((s) => hasReview(reviews?.[s.id])).length;
  const full = picked >= maxReviews;

  // Grouped by the agenda's days, in the agenda's order.
  const days = [];
  for (const s of sessions) {
    const last = days[days.length - 1];
    if (last && last.day === s.day) last.sessions.push(s);
    else days.push({ day: s.day, sessions: [s] });
  }

  return (
    <section className="dlgfb-form-q dlgfb-sessions" id={`q-${REVIEWS_KEY}`}>
      <div className="dlgfb-form-q-head" id={`${REVIEWS_KEY}-label`}>
        <span className="dlgfb-form-q-text">Which presentations did you find most valuable?</span>
      </div>
      <div className="dlgfb-form-q-body">
        <div className="dlgfb-sessions-hint-row">
          <p className="dlgfb-form-q-hint">Select up to {maxReviews === 3 ? "three" : maxReviews}.</p>
          <span className="dlgfb-sessions-count" role="status">
            {picked} of {maxReviews} selected
          </span>
        </div>

        <div className="dlgfb-search-field dlgfb-sessions-search">
          <svg className="dlgfb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input
            type="search"
            className="dlgfb-form-control"
            placeholder="Search presentations"
            aria-label="Search presentations by title, speaker or organization"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Enter here would submit the whole form.
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          />
          {query && (
            <button type="button" className="dlgfb-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          )}
        </div>

        {terms.length > 0 && !sessions.some((s) => matches(s, terms)) && (
          <p className="dlgfb-sessions-empty" role="status">
            No presentations match "{query.trim()}".
          </p>
        )}

        {days.map((d, index) => {
          const shown = terms.length ? d.sessions.filter((s) => matches(s, terms)) : d.sessions;
          if (!shown.length) return null;
          // "DAY 1", "DAY 2" in the agenda's order. The agenda's own day name ("Monday, November 9, 2026") is still
          // saved with each pick, and is read out to screen readers.
          return (
            <div className="dlgfb-sessions-day" key={d.day || `day-${index}`} role="group" aria-label={d.day || `Day ${index + 1}`}>
              <h3 className="dlgfb-sessions-day-label">Day {index + 1}</h3>
              {shown.map((s) => {
                const isPicked = hasReview(reviews?.[s.id]);
                return <SessionPick key={s.id} session={s} picked={isPicked} locked={full && !isPicked} onToggle={() => toggle(s.id)} />;
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
