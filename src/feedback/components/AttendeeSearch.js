import { useEffect, useMemo, useRef, useState } from "react";

const MIN_CHARS = 3;
const MAX_RESULTS = 8;

// Lowercase and strip accents, so "jose" finds "José".
function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function rank(attendee, terms) {
  const name = attendee._name;
  if (name.startsWith(terms[0])) return 0;
  if (name.split(/\s+/).some((w) => w.startsWith(terms[0]))) return 1;
  return 2;
}

function Highlight({ text, term }) {
  const plain = normalize(text);
  const idx = plain.indexOf(term);
  // Accented letters can change the normalized length, then the slice would be off, so skip it.
  if (!term || idx < 0 || plain.length !== text.length) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * Attendee picker. The full list is loaded once with the page (see FeedbackForm), and is only
 * filtered and shown after 3 characters are typed. Free text is never accepted as a value.
 */
export default function AttendeeSearch({ attendees, loadError, onRetry, value, onChange, invalid }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const indexed = useMemo(
    () => (attendees || []).map((a) => ({ ...a, _name: normalize(a.full_name), _hay: normalize(`${a.full_name} ${a.company_name}`) })),
    [attendees]
  );

  const term = query.trim();
  const terms = normalize(term).split(/\s+/).filter(Boolean);
  const searching = term.length >= MIN_CHARS;

  const matches = useMemo(() => {
    if (!searching) return [];
    return indexed
      .filter((a) => terms.every((t) => a._hay.includes(t)))
      .sort((a, b) => rank(a, terms) - rank(b, terms) || a._name.localeCompare(b._name));
    // terms is derived from term
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexed, searching, term]);

  const shown = matches.slice(0, MAX_RESULTS);

  useEffect(() => {
    setHighlight(-1);
  }, [term]);

  useEffect(() => {
    const close = (e) => wrapRef.current && !wrapRef.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, []);

  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlight}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const pick = (attendee) => {
    const { _name, _hay, ...clean } = attendee;
    onChange(clean);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!shown.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (highlight >= 0) pick(shown[highlight]);
      else if (shown.length === 1) pick(shown[0]);
    }
  };

  if (value) {
    return (
      <div className="selected-attendee">
        <span className="attendee-avatar" aria-hidden="true">{initials(value.full_name)}</span>
        <div className="selected-attendee-text">
          <div className="selected-attendee-name">{value.full_name}</div>
          <div className="selected-attendee-company">{value.company_name || "No company listed"}</div>
        </div>
        <button type="button" className="btn btn-sm btn-change" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  const loading = attendees === null && !loadError;
  let hint;
  if (loadError) hint = null;
  else if (loading) hint = "Loading the attendee list.";
  else if (term.length > 0 && !searching) {
    const left = MIN_CHARS - term.length;
    hint = `Type ${left} more character${left > 1 ? "s" : ""} to see matching names.`;
  } else hint = "Type at least 3 letters of your name, then pick it from the list.";

  return (
    <div className="attendee-search" ref={wrapRef}>
      <div className={`search-field${invalid ? " is-invalid" : ""}`}>
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          id="attendee-search"
          type="text"
          className="form-control form-control-lg"
          placeholder={loading ? "Loading attendees" : "Start typing your name"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          disabled={loading || !!loadError}
          role="combobox"
          aria-expanded={open && searching}
          aria-controls="attendee-results"
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `attendee-opt-${shown[highlight]?.attendee_id}` : undefined}
          aria-describedby="attendee-hint"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading && <span className="spinner-border spinner-border-sm search-spinner" role="status" aria-label="Loading" />}
        {query && !loading && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        )}
      </div>

      {loadError ? (
        <div className="search-error" id="attendee-hint">
          <span>The attendee list could not load.</span>
          <button type="button" className="btn btn-link btn-sm p-0" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <small className="form-text text-muted" id="attendee-hint">{hint}</small>
      )}
      {invalid && <div className="invalid-feedback d-block">Select your name from the list.</div>}

      {open && searching && (
        <div className="attendee-results" id="attendee-results" role="listbox" ref={listRef}>
          {shown.length === 0 && (
            <div className="attendee-empty">
              No attendee matches “{term}”. Check the spelling, or ask the registration desk.
            </div>
          )}
          {shown.map((a, i) => (
            <div
              key={a.attendee_id}
              id={`attendee-opt-${a.attendee_id}`}
              data-index={i}
              role="option"
              aria-selected={i === highlight}
              className={`attendee-option${i === highlight ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="attendee-avatar" aria-hidden="true">{initials(a.full_name)}</span>
              <span className="attendee-option-text">
                <span className="attendee-option-name"><Highlight text={a.full_name} term={terms[0]} /></span>
                <span className="attendee-option-company">{a.company_name || "No company listed"}</span>
              </span>
            </div>
          ))}
          {matches.length > MAX_RESULTS && (
            <div className="attendee-more">
              {matches.length - MAX_RESULTS} more match{matches.length - MAX_RESULTS > 1 ? "es" : ""}, keep typing to narrow the list.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
