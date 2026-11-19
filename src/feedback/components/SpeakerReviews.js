import { useState } from "react";
import { ratingScale } from "../config/feedbackQuestions";

// The speaker session reviews after the questions, an accordion with one item per "speaker" entry of the event's agenda, see
// backend/src/views/speakerSessions.js. Every review is optional. Reviews are kept as { [session id]: { rating, comment } }.

export const REVIEWS_KEY = "speaker_reviews";

// How many sessions an attendee can review on each day is set per event, "speakerReviews.maxPerDay" in
// backend/events.json, and comes in the event config. This is the default for a config without it; the backend
// checks the same limit on submit.
const DEFAULT_MAX_PER_DAY = 3;

const MODERATOR_RE = /\s*\|\s*moderator\s*$/i;

/** A panel lists the speakers' names only, any other session "Name - Company". */
function speakerText(session, s) {
  if (session.is_panel) return s.name;
  const company = s.company.replace(MODERATOR_RE, "").trim();
  return company ? `${s.name} - ${company}` : s.name;
}

export function speakerLine(session) {
  return session.speakers.map((s) => speakerText(session, s)).join(", ");
}

/** "09:10 - 09:35", or the one time the agenda gives. */
function timeRange(session) {
  return [session.start_time, session.end_time].filter(Boolean).join(" - ");
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
  return !!r && (r.rating > 0 || String(r.comment || "").trim() !== "");
}

/** The reviews to save, one per session with a rating or a comment, in the order of the agenda. */
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

// eslint-disable-next-line no-unused-vars -- kept for when the star rating is switched back on
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />
  </svg>
);

function SessionItem({ session, review, open, locked, maxPerDay, onToggle, onChange }) {
  const rating = review?.rating || 0;
  const comment = review?.comment || "";
  // eslint-disable-next-line no-unused-vars -- used by the star rating, switched off for now
  const ratingLabel = ratingScale.find((x) => x.value === rating)?.label;
  const panelId = `session-${session.id}-panel`;
  const headId = `session-${session.id}-head`;
  const time = timeRange(session);
  // The header shows the short title from the backend, or the full one when there is none.
  const shortTitle = session.short_title || session.title;

  return (
    <div className={`dlgfb-session${open ? " dlgfb-is-open" : ""}${hasReview(review) ? " dlgfb-is-reviewed" : ""}${locked ? " dlgfb-is-locked" : ""}`}>
      <h3 className="dlgfb-session-heading">
        <button type="button" id={headId} className="dlgfb-session-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span className="dlgfb-session-summary">
            <span className="dlgfb-session-title">{shortTitle}</span>
            {/* Second row, "time | speakers", and the rating when the stars are on. */}
            {(time || session.speakers.length > 0) && (
              <span className="dlgfb-session-meta">
                {time && <span className="dlgfb-session-time">{time}</span>}
                {time && session.speakers.length > 0 && (
                  <span className="dlgfb-session-sep" aria-hidden="true">
                    |
                  </span>
                )}
                {session.speakers.length > 0 && <span className="dlgfb-session-speakers">{speakerLine(session)}</span>}
                {/* The rating beside the time, switched off with the stars for now.
                {rating > 0 && (
                  <span className="dlgfb-session-rated">
                    {"★"} {rating} {ratingLabel}
                  </span>
                )}
                */}
              </span>
            )}
          </span>
          <svg className="dlgfb-session-caret" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>

      {open && (
        <div className="dlgfb-session-body" id={panelId} role="region" aria-labelledby={headId}>
          {/* The full title inside an open session, switched off for now; the search still finds it.
          {shortTitle !== session.title && <p className="dlgfb-session-full">{session.title}</p>}
          */}
          {locked ? (
            <p className="dlgfb-session-limit" role="status">
              You have reviewed {maxPerDay} sessions for this day, the most allowed.
            </p>
          ) : (
            /* Star rating switched off for now, only the comment is taken. Put this back, and the rating > 0
               check on the comment box below, to bring the stars back.
            <div className="dlgfb-session-rate">
              <div className="dlgfb-session-stars" role="radiogroup" aria-label={`Rate ${session.title}`}>
                {ratingScale.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={rating === r.value}
                    aria-label={`${r.value} of 5, ${r.label}`}
                    title={r.label}
                    className={`dlgfb-session-star${r.value <= rating ? " dlgfb-is-on" : ""}`}
                    onClick={() => onChange({ ...review, rating: r.value })}
                  >
                    {STAR}
                  </button>
                ))}
              </div>
              <span className="dlgfb-session-rate-label">{ratingLabel || "Tap to rate"}</span>
            </div>
            */
            <textarea
              className="dlgfb-form-textarea dlgfb-session-comment"
              rows={2}
              maxLength={500}
              placeholder="Any comments on this session?"
              aria-label={`Comments on ${session.title}`}
              value={comment}
              onChange={(e) => onChange({ ...review, comment: e.target.value })}
            />
          )}
          {/* Takes the review off, so on a day at its limit another session can be reviewed instead. */}
          {hasReview(review) && (
            <button type="button" className="dlgfb-session-clear" onClick={() => onChange(null)}>
              Clear review
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SpeakerReviews({ number, sessions, reviews, maxPerDay = DEFAULT_MAX_PER_DAY, onChange }) {
  // One session open at a time, tapping its header again closes it.
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState("");
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const setReview = (id, review) => onChange({ ...(reviews || {}), [id]: review });

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
        <span className="dlgfb-form-q-num">{String(number).padStart(2, "0")}</span>
        <span className="dlgfb-form-q-text">How would you rate the sessions?</span>
      </div>
      <div className="dlgfb-form-q-body">
        <div className="dlgfb-search-field dlgfb-sessions-search">
          <svg className="dlgfb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input
            type="search"
            className="dlgfb-form-control dlgfb-form-control-lg"
            placeholder="Search by title, speaker or organization"
            aria-label="Search sessions by title, speaker or organization"
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
            No sessions match "{query.trim()}".
          </p>
        )}

        {days.map((d) => {
          // Once a day has its most reviews, its other sessions cannot be rated. Counted over the whole day, not
          // only the sessions the search shows.
          const full = d.sessions.filter((s) => hasReview(reviews?.[s.id])).length >= maxPerDay;
          const shown = terms.length ? d.sessions.filter((s) => matches(s, terms)) : d.sessions;
          if (!shown.length) return null;
          return (
            <div className="dlgfb-sessions-day" key={d.day || "day"}>
              {d.day && days.length > 1 && <h3 className="dlgfb-sessions-day-title">{d.day}</h3>}
              <div className="dlgfb-sessions-list">
                {shown.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    review={reviews?.[s.id]}
                    open={openId === s.id}
                    locked={full && !hasReview(reviews?.[s.id])}
                    maxPerDay={maxPerDay}
                    onToggle={() => setOpenId((id) => (id === s.id ? null : s.id))}
                    onChange={(r) => setReview(s.id, r)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
