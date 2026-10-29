// Create sample attendees for local testing (and the default form settings row).
// Usage: npm run seed:attendees -- --event dle26 --count 50
const { query } = require("../src/db");
const { loadSettings } = require("../src/models");
const { choice, inEvent, intArg, parseArgs, run } = require("./cli");

const FIRST = ["Aarav", "Priya", "James", "Olivia", "Mohammed", "Sofia", "Liam", "Ananya", "Noah", "Emma",
  "Rohan", "Isabella", "Lucas", "Meera", "Ethan", "Chloe", "Arjun", "Mia", "Daniel", "Zara"];
const LAST = ["Sharma", "Patel", "Smith", "Johnson", "Khan", "Garcia", "Brown", "Iyer", "Wilson", "Taylor",
  "Mehta", "Martin", "Lee", "Nair", "Walker", "Clark", "Gupta", "Lopez", "Hall", "Young"];
const COMPANIES = ["Shell", "BP", "Siemens Energy", "Aramco", "TotalEnergies", "Honeywell", "Schneider Electric",
  "ABB", "Wood PLC", "Baker Hughes", "Petrofac", "Equinor", "Worley", "SLB", "Halliburton"];

run(() => inEvent(parseArgs(), async () => {
  const count = intArg(parseArgs(), "count", 50);
  await loadSettings();
  let created = 0;
  for (let i = 0; i < count; i += 1) {
    const first = choice(FIRST);
    const last = choice(LAST);
    const email = `${first}.${last}.${i}@example.com`.toLowerCase();
    const result = await query(
      "INSERT IGNORE INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
      [`${first} ${last}`, email, choice(COMPANIES)]
    );
    created += result.affectedRows;
  }
  console.log(`Created ${created} attendees.`);
}));
