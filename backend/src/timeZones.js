// The event's time zone from its location, such as "Anaheim, California, USA" on the event website, so the daily CRM
// sync stops at midnight where the event is held, see eventDates.js. The location is split on commas and each part is
// looked up, the most specific first: a US state, Canadian province or Australian state, then a city or a country.
// A country spread over several zones, with no state given, takes its westernmost mainland zone, so the sync never
// stops before the day is over there. Nothing found gives null.

const US_STATES = {
  "America/New_York": [
    ["connecticut", "ct"], ["delaware", "de"], ["district of columbia", "dc", "washington dc", "washington d.c."],
    ["florida", "fl"], ["georgia", "ga"], ["maine", "me"], ["maryland", "md"], ["massachusetts", "ma"],
    ["new hampshire", "nh"], ["new jersey", "nj"], ["new york", "ny"], ["north carolina", "nc"], ["ohio", "oh"],
    ["pennsylvania", "pa"], ["rhode island", "ri"], ["south carolina", "sc"], ["vermont", "vt"], ["virginia", "va"],
    ["west virginia", "wv"], ["kentucky", "ky"],
  ],
  "America/Detroit": [["michigan", "mi"]],
  "America/Indiana/Indianapolis": [["indiana", "in"]],
  "America/Chicago": [
    ["alabama", "al"], ["arkansas", "ar"], ["illinois", "il"], ["iowa", "ia"], ["kansas", "ks"], ["louisiana", "la"],
    ["minnesota", "mn"], ["mississippi", "ms"], ["missouri", "mo"], ["nebraska", "ne"], ["north dakota", "nd"],
    ["oklahoma", "ok"], ["south dakota", "sd"], ["tennessee", "tn"], ["texas", "tx"], ["wisconsin", "wi"],
  ],
  "America/Denver": [["colorado", "co"], ["montana", "mt"], ["new mexico", "nm"], ["utah", "ut"], ["wyoming", "wy"], ["idaho", "id"]],
  "America/Phoenix": [["arizona", "az"]],
  "America/Los_Angeles": [["california", "ca"], ["nevada", "nv"], ["oregon", "or"], ["washington", "wa"]],
  "America/Anchorage": [["alaska", "ak"]],
  "Pacific/Honolulu": [["hawaii", "hi"]],
};

const CA_PROVINCES = {
  "America/Vancouver": [["british columbia", "bc"]],
  "America/Edmonton": [["alberta", "ab"]],
  "America/Regina": [["saskatchewan", "sk"]],
  "America/Winnipeg": [["manitoba", "mb"]],
  "America/Toronto": [["ontario", "on"], ["quebec", "qc", "québec"]],
  "America/Halifax": [["nova scotia", "ns"], ["new brunswick", "nb"], ["prince edward island", "pe", "pei"]],
  "America/St_Johns": [["newfoundland and labrador", "nl", "newfoundland"]],
};

const AU_STATES = {
  "Australia/Sydney": [["new south wales", "nsw"], ["victoria", "vic"], ["tasmania", "tas"], ["australian capital territory", "act"]],
  "Australia/Brisbane": [["queensland", "qld"]],
  "Australia/Adelaide": [["south australia", "sa"]],
  "Australia/Perth": [["western australia", "wa"]],
  "Australia/Darwin": [["northern territory", "nt"]],
};

// Countries and well known event cities with one time zone. A multi-zone country maps to its westernmost mainland zone.
const PLACES = {
  "America/Los_Angeles": ["usa", "us", "u.s.", "u.s.a.", "united states", "united states of america", "america", "las vegas", "los angeles", "san francisco", "san diego", "anaheim", "seattle"],
  "America/New_York": ["new york city", "nyc", "boston", "miami", "orlando", "atlanta", "philadelphia"],
  "America/Chicago": ["chicago", "dallas", "houston", "austin", "nashville", "new orleans"],
  "America/Vancouver": ["canada", "vancouver"],
  "America/Toronto": ["toronto", "montreal", "ottawa"],
  "Australia/Perth": ["australia"],
  "Australia/Sydney": ["sydney", "melbourne", "canberra"],
  "Europe/London": ["uk", "u.k.", "united kingdom", "great britain", "england", "scotland", "wales", "london", "manchester", "birmingham", "edinburgh"],
  "Europe/Dublin": ["ireland", "dublin"],
  "Europe/Berlin": ["germany", "berlin", "frankfurt", "munich", "hamburg", "cologne", "düsseldorf", "dusseldorf"],
  "Europe/Paris": ["france", "paris", "lyon"],
  "Europe/Amsterdam": ["netherlands", "the netherlands", "holland", "amsterdam", "rotterdam"],
  "Europe/Brussels": ["belgium", "brussels"],
  "Europe/Madrid": ["spain", "madrid", "barcelona"],
  "Europe/Lisbon": ["portugal", "lisbon"],
  "Europe/Rome": ["italy", "rome", "milan"],
  "Europe/Zurich": ["switzerland", "zurich", "geneva", "basel"],
  "Europe/Vienna": ["austria", "vienna"],
  "Europe/Copenhagen": ["denmark", "copenhagen"],
  "Europe/Stockholm": ["sweden", "stockholm"],
  "Europe/Oslo": ["norway", "oslo"],
  "Europe/Helsinki": ["finland", "helsinki"],
  "Europe/Warsaw": ["poland", "warsaw"],
  "Europe/Prague": ["czech republic", "czechia", "prague"],
  "Europe/Athens": ["greece", "athens"],
  "Europe/Istanbul": ["turkey", "türkiye", "istanbul"],
  "Asia/Dubai": ["uae", "u.a.e.", "united arab emirates", "dubai", "abu dhabi"],
  "Asia/Riyadh": ["saudi arabia", "ksa", "riyadh", "jeddah"],
  "Asia/Qatar": ["qatar", "doha"],
  "Asia/Kolkata": ["india", "mumbai", "delhi", "new delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "pune", "kolkata"],
  "Asia/Singapore": ["singapore"],
  "Asia/Kuala_Lumpur": ["malaysia", "kuala lumpur"],
  "Asia/Bangkok": ["thailand", "bangkok"],
  "Asia/Tokyo": ["japan", "tokyo"],
  "Asia/Seoul": ["south korea", "korea", "seoul"],
  "Asia/Shanghai": ["china", "beijing", "shanghai"],
  "Asia/Hong_Kong": ["hong kong"],
  "Asia/Manila": ["philippines", "manila"],
  "Asia/Jakarta": ["indonesia", "jakarta"],
  "Asia/Jerusalem": ["israel", "tel aviv", "jerusalem"],
  "Africa/Johannesburg": ["south africa", "johannesburg", "cape town"],
  "Africa/Nairobi": ["kenya", "nairobi"],
  "Africa/Lagos": ["nigeria", "lagos"],
  "Africa/Cairo": ["egypt", "cairo"],
  "Pacific/Auckland": ["new zealand", "auckland"],
  "America/Mexico_City": ["mexico", "mexico city"],
  "America/Sao_Paulo": ["brazil", "sao paulo", "são paulo"],
  "America/Argentina/Buenos_Aires": ["argentina", "buenos aires"],
  "America/Santiago": ["chile", "santiago"],
  "America/Bogota": ["colombia", "bogota", "bogotá"],
};

// The names of the USA in PLACES, so a two letter state code is trusted after them.
const US_NAMES = new Set(PLACES["America/Los_Angeles"].slice(0, 7));

/** name -> zone for one table of { zone: [[name, abbreviation...], ...] } or { zone: [name, ...] }. */
function index(table) {
  const map = new Map();
  for (const [zone, entries] of Object.entries(table)) {
    for (const entry of entries) for (const name of [].concat(entry)) map.set(name, zone);
  }
  return map;
}

const US = index(US_STATES);
const CA = index(CA_PROVINCES);
const AU = index(AU_STATES);
const PLACE = index(PLACES);

/** True when the name is a time zone this server knows, such as "America/Los_Angeles". */
function isTimeZone(name) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return typeof name === "string" && name.includes("/");
  } catch (err) {
    return false;
  }
}

/** The time zone for a location such as "Anaheim, California, USA", or null when it cannot be told. */
function timeZoneForLocation(location) {
  const parts = String(location || "")
    .replace(/<[^>]*>/g, " ")
    .split(",")
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean);
  if (!parts.length) return null;
  const country = parts[parts.length - 1];
  // A state or province first. Two letter codes are only trusted with the country named, "CA" is also Canada.
  const regionTables = US_NAMES.has(country) ? [US] : country === "canada" ? [CA] : country === "australia" ? [AU] : [US, CA, AU];
  for (const part of parts.slice().reverse()) {
    for (const table of regionTables) {
      const zone = table.get(part);
      if (zone && (part.length > 3 || regionTables.length === 1)) return zone;
    }
  }
  // Then a city, then the country.
  for (const part of parts) {
    if (part !== country && PLACE.has(part)) return PLACE.get(part);
  }
  return PLACE.get(country) || null;
}

/** Milliseconds the zone is ahead of UTC at that instant, negative west of Greenwich. */
function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a calendar day ends in the zone, 23:59:59.999 local, for a date given as UTC midnight of that day. */
function endOfDayIn(date, timeZone) {
  const nextMidnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  // Local midnight is UTC midnight minus the offset; checked twice in case a clock change falls in between.
  let guess = nextMidnightUtc - zoneOffsetMs(new Date(nextMidnightUtc), timeZone);
  guess = nextMidnightUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - 1);
}

/** The instant a calendar day starts in the zone, 12:00 AM local, for a date given as UTC midnight of that day. */
function startOfDayIn(date, timeZone) {
  const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
  return new Date(endOfDayIn(previous, timeZone).getTime() + 1);
}

module.exports = { endOfDayIn, isTimeZone, startOfDayIn, timeZoneForLocation, zoneOffsetMs };
