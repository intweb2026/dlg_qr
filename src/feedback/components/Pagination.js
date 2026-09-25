export const PAGE_SIZE = 20;

export function pageSlice(list, page) {
  return list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export function pageCount(total) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

// Page numbers with gaps, e.g. 1 … 4 5 6 … 10
function pageItems(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
}

export default function Pagination({ page, total, onChange, noun = "rows" }) {
  const pages = pageCount(total);
  if (total === 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="pager">
      <span className="pager-summary">
        {from} to {to} of {total} {noun}
      </span>
      {pages > 1 && (
        <nav aria-label="Pages">
          <ul className="pager-list">
            <li>
              <button type="button" className="pager-btn" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
                ‹
              </button>
            </li>
            {pageItems(page, pages).map((p) =>
              typeof p === "string" ? (
                <li key={p} className="pager-gap" aria-hidden="true">…</li>
              ) : (
                <li key={p}>
                  <button
                    type="button"
                    className={`pager-btn${p === page ? " active" : ""}`}
                    aria-current={p === page ? "page" : undefined}
                    onClick={() => onChange(p)}
                  >
                    {p}
                  </button>
                </li>
              )
            )}
            <li>
              <button type="button" className="pager-btn" disabled={page === pages} onClick={() => onChange(page + 1)} aria-label="Next page">
                ›
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
