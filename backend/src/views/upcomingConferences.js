// The upcoming conferences for the feedback form's last question, read from the event's own website.
// The site is server rendered and puts its data in window.__INITIAL_DATA__; its upcomingEvents are used,
// or its otherEvents when upcomingEvents is empty. Both empty, or the site not reachable, gives an empty
// list and the form leaves the question out.

const CACHE_MS = 10 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

// Event code to { at, ttl, list }, so the website is fetched at most once per 10 minutes per event.
const cache = new Map();

/** The JSON object assigned to window.__INITIAL_DATA__ in the page, or null when there is none. */
function initialData(html) {
  const marker = html.indexOf("window.__INITIAL_DATA__");
  if (marker === -1) return null;
  const start = html.indexOf("{", marker);
  if (start === -1) return null;
  // Find the closing brace of that object, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  return null;
}

/** Name, dates and location of each event in the site's data, upcomingEvents first, otherEvents as the fallback. */
function conferencesFrom(data) {
  const pick = (key) => (Array.isArray(data?.[key]) ? data[key] : []);
  const events = pick("upcomingEvents").length ? pick("upcomingEvents") : pick("otherEvents");
  return events
    .map((e) => ({
      name: String(e.eventname || "").trim(),
      dates: String(e.eventdate || "").trim(),
      location: String(e.eventlocation || "").trim(),
    }))
    .filter((e) => e.name);
}

async function fetchConferences(website) {
  const res = await fetch(website, {
    headers: { "User-Agent": "event-feedback-form", Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${website} answered ${res.status}`);
  return conferencesFrom(initialData(await res.text()));
}

async function upcomingConferences(req, res) {
  const { code } = req.event;
  const website = req.event.links?.website;
  if (!website) return res.json([]);

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < hit.ttl) return res.json(hit.list);

  try {
    const list = await fetchConferences(website);
    cache.set(code, { at: Date.now(), ttl: CACHE_MS, list });
    return res.json(list);
  } catch (err) {
    console.error(`Upcoming conferences for ${code}: ${err.message}`);
    // Keep the last good list if there is one, and try the site again in a minute.
    const list = hit ? hit.list : [];
    cache.set(code, { at: Date.now(), ttl: FAILURE_CACHE_MS, list });
    return res.json(list);
  }
}

module.exports = { upcomingConferences, initialData, conferencesFrom };
