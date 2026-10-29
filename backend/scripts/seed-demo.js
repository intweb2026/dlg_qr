// Add demo attendees and feedback submissions for testing the form, admin panel and lucky draw.
// Usage: npm run seed:demo -- --event dle26 --attendees 100 --feedback 50
const crypto = require("crypto");

const { transaction } = require("../src/db");
const { loadSettings } = require("../src/models");
const { choice, inEvent, intArg, parseArgs, run, shuffle, weightedChoice } = require("./cli");

const FIRST = [
  "Aisha", "Benjamin", "Carlos", "Deepika", "Elena", "Farhan", "Grace", "Hiroshi", "Ingrid", "Jamal",
  "Kavya", "Lorenzo", "Mariam", "Nikolai", "Oluwaseun", "Pooja", "Quentin", "Rania", "Samuel", "Tanvi",
  "Umar", "Valentina", "William", "Ximena", "Yusuf", "Zoe", "Adrian", "Bianca", "Cyrus", "Divya",
  "Elias", "Fatima", "Gabriel", "Hannah", "Ishaan", "Julia", "Kenji", "Leila", "Mateo", "Nadia",
];
const LAST = [
  "Al Mansoori", "Bennett", "Castillo", "Desai", "Eriksen", "Fernandes", "Gonzalez", "Haddad", "Ibrahim", "Jensen",
  "Kapoor", "Lindqvist", "Menon", "Novak", "Okafor", "Pereira", "Qureshi", "Rossi", "Sato", "Thompson",
  "Usman", "Varga", "Williams", "Xu", "Yamamoto", "Zimmermann", "Anand", "Bose", "Chowdhury", "Dubois",
];
const COMPANIES = [
  "ADNOC", "Shell", "BP", "Siemens Energy", "Aramco", "TotalEnergies", "Honeywell", "Schneider Electric", "ABB",
  "Wood PLC", "Baker Hughes", "Petrofac", "Equinor", "Worley", "SLB", "Halliburton", "Emerson", "Yokogawa",
  "KBR", "McDermott", "Technip Energies", "Fluor", "QatarEnergy", "ENOC", "Masdar",
];
const MOST_VALUABLE = [
  "The keynote on energy transition was excellent.",
  "Networking with peers from other operators.",
  "The panel on digital twins gave us ideas we can use right away.",
  "Hands-on workshops, especially the AI in maintenance session.",
  "Meeting suppliers in the exhibition hall.",
  "Case studies from real projects, very practical.",
  "The hydrogen roundtable.",
  "Clear, well prepared speakers.",
  "Learning how other teams approach decarbonisation.",
  "The closing fireside chat.",
  "",
];
const SUGGESTIONS = [
  "Longer breaks between sessions for networking.",
  "More seating in the main hall.",
  "Share the slides after each session.",
  "Better Wi-Fi in the breakout rooms.",
  "More vegetarian options at lunch.",
  "Start the second day a little later.",
  "Add a mobile app with the agenda.",
  "More time for audience questions.",
  "Clearer signage to the workshop rooms.",
  "Nothing, it was very well organised.",
  "",
];

const weightedRating = () => weightedChoice([1, 2, 3, 4, 5], [3, 6, 20, 38, 33]);

async function createAttendees(q, count) {
  const taken = new Set((await q("SELECT full_name FROM attendees")).map((r) => r.full_name));
  const combos = shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`)).filter((name) => !taken.has(name)));
  if (combos.length < count) console.warn(`Only ${combos.length} unused names left, creating that many.`);
  let created = 0;
  for (const name of combos.slice(0, count)) {
    const base = name.toLowerCase().replace(/ /g, ".");
    let email = `${base}@example.com`;
    for (let n = 2; (await q("SELECT 1 FROM attendees WHERE email = ?", [email])).length; n += 1) {
      email = `${base}${n}@example.com`;
    }
    await q(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
      [name, email, choice(COMPANIES)]
    );
    created += 1;
  }
  return created;
}

async function createFeedback(q, count) {
  const pending = shuffle(
    await q(
      `SELECT a.attendee_id FROM attendees a
       LEFT JOIN feedback_submissions s ON s.attendee_id = a.attendee_id WHERE s.id IS NULL`
    )
  );
  if (pending.length < count) console.warn(`Only ${pending.length} attendees without feedback, creating that many.`);
  let created = 0;
  for (const { attendee_id: attendeeId } of pending.slice(0, count)) {
    const data = {
      overall_experience: weightedRating(),
      content_quality: weightedRating(),
      speakers: weightedRating(),
      networking: weightedRating(),
      venue_organisation: weightedRating(),
      attend_again: weightedChoice(["Yes", "Maybe", "No"], [70, 22, 8]),
    };
    for (const [key, pool] of [["most_valuable", MOST_VALUABLE], ["suggestions", SUGGESTIONS]]) {
      const text = choice(pool);
      if (text) data[key] = text;
    }
    const fingerprint = crypto.createHash("sha256").update(`demo-${attendeeId}-${Math.random()}`).digest("hex");
    // Spread submission times over the last few hours so the admin table looks realistic
    const minutesAgo = 5 + Math.floor(Math.random() * 356);
    await q(
      "INSERT INTO feedback_submissions (attendee_id, device_fingerprint, feedback_data, is_suspended, created_at) " +
        "VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6) - INTERVAL ? MINUTE)",
      [attendeeId, fingerprint, JSON.stringify(data), minutesAgo]
    );
    created += 1;
  }
  return created;
}

run(() => inEvent(parseArgs(), async () => {
  const args = parseArgs();
  const attendees = intArg(args, "attendees", 100);
  const feedback = intArg(args, "feedback", 50);
  await loadSettings();
  const message = await transaction(async (q) => {
    const createdAttendees = await createAttendees(q, attendees);
    const createdFeedback = await createFeedback(q, feedback);
    const [totals] = await q(
      "SELECT (SELECT COUNT(*) FROM attendees) AS attendees, (SELECT COUNT(*) FROM feedback_submissions) AS submissions"
    );
    return `Created ${createdAttendees} attendees and ${createdFeedback} feedback submissions. ` +
      `Totals now ${totals.attendees} attendees, ${totals.submissions} submissions.`;
  });
  console.log(message);
}));
