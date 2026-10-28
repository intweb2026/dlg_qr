import { useEffect, useMemo, useRef, useState } from "react";

const MIN_CHARS = 3;
const MAX_RESULTS = 8;
const MAX_NAME = 255;

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

// Collapse repeated spaces, so "  jane   doe " is saved as "jane doe".
function cleanName(text) {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Attendee picker. The full list is loaded once with the page (see FeedbackForm), and is only
 * filtered and shown after 3 characters are typed. When the typed name is not on the list, it can be
 * added as a new attendee, which the backend creates together with the feedback submission.
 */
export default function AttendeeSearch({ attendees, loadError, onRetry, value, onChange, invalid, companyInvalid, emailInvalid }) {
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
  const newName = cleanName(term);
  // "Add" is always offered, a listed name can belong to someone else from another company.
  // The backend refuses it when the same name and company are already on the list.
  const canAdd = searching && newName.length <= MAX_NAME;
  const sameNameListed = canAdd && matches.some((a) => a._name === normalize(newName));
  const optionCount = shown.length + (canAdd ? 1 : 0);
  const addIndex = canAdd ? shown.length : -1;

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

  const addNew = () => {
    onChange({ attendee_id: null, full_name: newName, company_name: "", email: "", is_new: true });
    setQuery("");
    setOpen(false);
  };

  const choose = (index) => (index === addIndex ? addNew() : pick(shown[index]));

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!optionCount) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, optionCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (highlight >= 0) choose(highlight);
      else if (shown.length === 1) pick(shown[0]);
    }
  };

  if (value) {
    return (
      <>
        <div className="dlgfb-selected-attendee">
          <span className="dlgfb-attendee-avatar" aria-hidden="true">{initials(value.full_name)}</span>
          <div className="dlgfb-selected-attendee-text">
            <div className="dlgfb-selected-attendee-name">{value.full_name}</div>
            <div className="dlgfb-selected-attendee-company">
              {value.is_new ? "New attendee, not on the list" : value.company_name || "No company listed"}
            </div>
          </div>
          <button type="button" className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-change" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
        {value.is_new && (
          <>
            <input
              id="q-company"
              type="text"
              className={`dlgfb-form-control dlgfb-new-attendee-company${companyInvalid ? " dlgfb-is-invalid" : ""}`}
              placeholder="Company name"
              aria-label="Company name"
              aria-required="true"
              aria-invalid={!!companyInvalid}
              maxLength={MAX_NAME}
              value={value.company_name}
              onChange={(e) => onChange({ ...value, company_name: e.target.value })}
            />
            {companyInvalid ? (
              <div className="dlgfb-invalid-feedback dlgfb-d-block">Enter your company name to add yourself.</div>
            ) : (
              <small className="dlgfb-form-text dlgfb-text-muted">Required, it tells you apart from someone with the same name.</small>
            )}
            <input
              id="q-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={`dlgfb-form-control dlgfb-new-attendee-company${emailInvalid ? " dlgfb-is-invalid" : ""}`}
              placeholder="Email (optional)"
              aria-label="Email, optional"
              aria-invalid={!!emailInvalid}
              maxLength={MAX_NAME}
              value={value.email}
              onChange={(e) => onChange({ ...value, email: e.target.value })}
            />
            {emailInvalid && <div className="dlgfb-invalid-feedback dlgfb-d-block">Enter a valid email address, or leave it empty.</div>}
          </>
        )}
      </>
    );
  }

  const loading = attendees === null && !loadError;
  let hint;
  if (loadError) hint = null;
  else if (loading) hint = "Loading the attendee list.";
  else if (term.length > 0 && !searching) {
    const left = MIN_CHARS - term.length;
    hint = `Type ${left} more character${left > 1 ? "s" : ""} to see matching names.`;
  } else hint = "Type at least 3 letters of your name, then pick it from the list, or add it if it is not there.";

  return (
    <div className="dlgfb-attendee-search" ref={wrapRef}>
      <div className={`dlgfb-search-field${invalid ? " dlgfb-is-invalid" : ""}`}>
        <svg className="dlgfb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          id="attendee-search"
          type="text"
          className="dlgfb-form-control dlgfb-form-control-lg"
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
          aria-activedescendant={
            highlight < 0 ? undefined : highlight === addIndex ? "attendee-opt-new" : `attendee-opt-${shown[highlight]?.attendee_id}`
          }
          aria-describedby="attendee-hint"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading && <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-search-spinner" role="status" aria-label="Loading" />}
        {query && !loading && (
          <button type="button" className="dlgfb-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        )}
      </div>

      {loadError ? (
        <div className="dlgfb-search-error" id="attendee-hint">
          <span>The attendee list could not load.</span>
          <button type="button" className="dlgfb-btn dlgfb-btn-link dlgfb-btn-sm dlgfb-p-0" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <small className="dlgfb-form-text dlgfb-text-muted" id="attendee-hint">{hint}</small>
      )}
      {invalid && <div className="dlgfb-invalid-feedback dlgfb-d-block">Select your name from the list, or add it as a new attendee.</div>}

      {open && searching && (
        <div className="dlgfb-attendee-results" id="attendee-results" role="listbox" ref={listRef}>
          {shown.length === 0 && (
            <div className="dlgfb-attendee-empty">
              No attendee matches “{term}”. Check the spelling, or add your name below.
            </div>
          )}
          {shown.map((a, i) => (
            <div
              key={a.attendee_id}
              id={`attendee-opt-${a.attendee_id}`}
              data-index={i}
              role="option"
              aria-selected={i === highlight}
              className={`dlgfb-attendee-option${i === highlight ? " dlgfb-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="dlgfb-attendee-avatar" aria-hidden="true">{initials(a.full_name)}</span>
              <span className="dlgfb-attendee-option-text">
                <span className="dlgfb-attendee-option-name"><Highlight text={a.full_name} term={terms[0]} /></span>
                <span className="dlgfb-attendee-option-company">{a.company_name || "No company listed"}</span>
              </span>
            </div>
          ))}
          {canAdd && (
            <div
              id="attendee-opt-new"
              data-index={addIndex}
              role="option"
              aria-selected={highlight === addIndex}
              className={`dlgfb-attendee-option dlgfb-attendee-option-new${highlight === addIndex ? " dlgfb-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                addNew();
              }}
              onMouseEnter={() => setHighlight(addIndex)}
            >
              <span className="dlgfb-attendee-avatar" aria-hidden="true">+</span>
              <span className="dlgfb-attendee-option-text">
                <span className="dlgfb-attendee-option-name">Add “{newName}”</span>
                <span className="dlgfb-attendee-option-company">
                  {sameNameListed ? "Same name, I am from another company" : "My name is not on the list"}
                </span>
              </span>
            </div>
          )}
          {matches.length > MAX_RESULTS && (
            <div className="dlgfb-attendee-more">
              {matches.length - MAX_RESULTS} more match{matches.length - MAX_RESULTS > 1 ? "es" : ""}, keep typing to narrow the list.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
