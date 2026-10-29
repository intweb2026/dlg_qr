// Creates missing databases, tables, the form settings row and the default admins.
// Usage: npm run migrate                   every event in backend/events
//        npm run migrate -- --event dle26  one event
const { allEvents } = require("../src/events");
const { migrate } = require("../src/migrate");
const { eventArg, parseArgs, run } = require("./cli");

run(async () => {
  const args = parseArgs();
  const events = args.event ? [eventArg(args)] : allEvents();
  for (const event of events) await migrate(event, { log: console.log });
});
