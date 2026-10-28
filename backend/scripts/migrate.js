// Creates missing tables, the form settings row and the default admins. Usage: npm run migrate
const { migrate } = require("../src/migrate");
const { run } = require("./cli");

run(() => migrate({ log: console.log }));
