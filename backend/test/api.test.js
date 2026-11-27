// API tests, run with: npm test
// They use the test events in test/events.json, each with its own database, created and dropped here.
// The test databases use the login of the first entry in databases.json, written to a temporary logins file.
// Most tests run against testa, the isolation tests also use testb.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, describe, test } = require("node:test");

process.env.EVENTS_FILE = path.join(__dirname, "events.json");
const testLogin = Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "databases.json"), "utf8")))[0];
const LOGINS_FILE = path.join(os.tmpdir(), `feedback-test-databases-${process.pid}.json`);
fs.writeFileSync(
  LOGINS_FILE,
  JSON.stringify({ feedback_testa_test: testLogin, feedback_testb_test: testLogin, feedback_off_test: testLogin })
);
process.env.DATABASES_FILE = LOGINS_FILE;
const EXPORT_TOKEN = "test-export-token-0123456789abcdef0123456789";
process.env.EXPORT_ACCESS_TOKEN = EXPORT_TOKEN;
process.env.FEEDBACK_REPORT_TO = "reports@example.com";
process.env.ALLOWED_HOSTS = "localhost,127.0.0.1";
const UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-test-uploads-"));
process.env.UPLOADS_DIR = UPLOADS_DIR;

const http = require("node:http");

const { createApp } = require("../src/app");
const config = require("../src/config");
// The default admins are the ones npm run migrate makes, read from config.js so the test never holds its own copy.
const adminPassword = (username) => config.defaultAdmins.find(([name]) => name === username)[1];
const crm = require("../src/crmDelegates");
const db = require("../src/db");
const { allEvents } = require("../src/events");
const loginGuard = require("../src/loginGuard");
const { migrate } = require("../src/migrate");

const EVENT_A = allEvents().find((e) => e.code === "testa");
const EVENT_B = allEvents().find((e) => e.code === "testb");

let server;
let root;

/** query() against testa, the event most tests use. */
const query = (sql, params) => db.withDatabase(EVENT_A.database, () => db.query(sql, params));
const queryB = (sql, params) => db.withDatabase(EVENT_B.database, () => db.query(sql, params));

async function dropDatabases() {
  for (const event of allEvents()) {
    const conn = await db.serverConnection(event.database);
    await conn.query(`DROP DATABASE IF EXISTS \`${event.database}\``);
    await conn.end();
  }
}

before(async () => {
  await dropDatabases();
  await migrate(EVENT_A);
  await migrate(EVENT_B);
  server = createApp().listen(0);
  root = `http://127.0.0.1:${server.address().port}/api/events`;
});

after(async () => {
  server.close();
  await db.closeAll();
  await dropDatabases();
  fs.rmSync(LOGINS_FILE, { force: true });
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const q of [query, queryB]) {
    for (const table of ["lucky_draw_winners", "feedback_submissions", "attendees", "admin_tokens", "logbook"]) {
      await q(`DELETE FROM ${table}`);
    }
    await q("UPDATE form_settings SET form_status = 'active', max_spin_attempts = 0, spin_duration_seconds = 5");
    await q("UPDATE admin_users SET is_active = 1");
  }
});

/** Calls the API of an event, testa unless event is given. */
async function api(method, url, { body, token, form, headers = {}, event = "testa" } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Token ${token}`;
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${root}/${event}${url}`, init);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

async function createAttendee(fullName, email, companyName = "") {
  const r = await query(
    "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6))",
    [fullName, email, companyName]
  );
  return r.insertId;
}

async function createSubmission(attendeeId, { suspended = false } = {}) {
  const r = await query(
    "INSERT INTO feedback_submissions (attendee_id, device_fingerprint, feedback_data, is_suspended, created_at) " +
      "VALUES (?, 'a', '{\"x\": 1}', ?, UTC_TIMESTAMP(6))",
    [attendeeId, suspended ? 1 : 0]
  );
  return r.insertId;
}

async function count(table, where = "1", params = []) {
  const [row] = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  return row.n;
}

async function login(username, event = "testa") {
  return (await api("POST", "/auth/login/", { body: { username, password: adminPassword(username) }, event })).data.token;
}

describe("feedback flow", () => {
  let a1;
  let a2;
  beforeEach(async () => {
    a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    a2 = await createAttendee("James Smith", "james@example.com", "BP");
  });

  test("attendee list loads all and masks email", async () => {
    const { data } = await api("GET", "/attendees/");
    assert.deepEqual(new Set(data.map((a) => a.full_name)), new Set(["Priya Sharma", "James Smith"]));
    assert.equal(data.find((a) => a.full_name === "Priya Sharma").email, "p***a@example.com");
  });

  test("attendee list hides submitted", async () => {
    await createSubmission(a1);
    const { data } = await api("GET", "/attendees/");
    assert.deepEqual(data.map((a) => a.full_name), ["James Smith"]);
  });

  test("attendee list stays open whatever the old status column says", async () => {
    await query("UPDATE form_settings SET form_status = 'ended'");
    assert.equal((await api("GET", "/attendees/")).status, 200);
  });

  test("submit and duplicate", async () => {
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { overall: 5 } } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("set-cookie"), null);
    const r2 = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { overall: 4 } } });
    assert.equal(r2.status, 400);
    assert.equal(r2.data.code, "already_submitted");
  });

  test("submit saves the display name and company alias", async () => {
    const body = { attendee_id: a1, alias_name: "  Priya   S ", company_alias_name: "Shell plc", feedback_data: { x: 1 } };
    const r = await api("POST", "/feedback/submit/", { body });
    assert.equal(r.status, 201);
    const [row] = await query("SELECT userAliesName, userComapnyAliesName FROM feedback_submissions WHERE id = ?", [r.data.id]);
    assert.deepEqual({ ...row }, { userAliesName: "Priya S", userComapnyAliesName: "Shell plc" });
    // The attendee list itself is not changed.
    assert.equal((await query("SELECT full_name FROM attendees WHERE attendee_id = ?", [a1]))[0].full_name, "Priya Sharma");

    // Without an alias the name and company on the list are saved.
    const r2 = await api("POST", "/feedback/submit/", { body: { attendee_id: a2, feedback_data: { x: 1 } } });
    const [row2] = await query("SELECT userAliesName, userComapnyAliesName FROM feedback_submissions WHERE id = ?", [r2.data.id]);
    assert.deepEqual({ ...row2 }, { userAliesName: "James Smith", userComapnyAliesName: "BP" });
  });

  test("new attendee keeps the typed name apart from the alias", async () => {
    const body = {
      new_attendee: { full_name: "Abc Real", company_name: "Acme", email: "abc@example.com" },
      alias_name: "Xyz Rep",
      company_alias_name: "Acme Group",
      feedback_data: { x: 1 },
    };
    const r = await api("POST", "/feedback/submit/", { body });
    assert.equal(r.status, 201);
    const [row] = await query(
      `SELECT a.full_name, a.company_name, s.userAliesName, s.userComapnyAliesName
       FROM feedback_submissions s JOIN attendees a ON a.attendee_id = s.attendee_id WHERE s.id = ?`,
      [r.data.id]
    );
    assert.deepEqual({ ...row }, { full_name: "Abc Real", company_name: "Acme", userAliesName: "Xyz Rep", userComapnyAliesName: "Acme Group" });
  });

  test("migrate fills the alias on older submissions", async () => {
    const id = await createSubmission(a1);
    await migrate(EVENT_A);
    const [row] = await query("SELECT userAliesName, userComapnyAliesName FROM feedback_submissions WHERE id = ?", [id]);
    assert.deepEqual({ ...row }, { userAliesName: "Priya Sharma", userComapnyAliesName: "Shell" });
  });

  test("device check is left to the form", async () => {
    // Clearing the form site's cookies must open the form again, so the API keeps no device flag of its own.
    await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } });
    assert.ok(!("submission_status" in (await api("GET", "/")).data));
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a2, feedback_data: { x: 1 } } });
    assert.equal(r.status, 201);
  });

  test("submit with new attendee", async () => {
    const r = await api("POST", "/feedback/submit/", {
      body: { new_attendee: { full_name: "  Ana   Lopez ", company_name: "Total", email: "ana@example.com" }, feedback_data: { x: 1 } },
    });
    assert.equal(r.status, 201);
    const [row] = await query(
      "SELECT a.full_name, a.company_name, a.is_walk_in FROM feedback_submissions s JOIN attendees a USING (attendee_id) WHERE s.id = ?",
      [r.data.id]
    );
    assert.deepEqual([row.full_name, row.company_name, row.is_walk_in], ["Ana Lopez", "Total", 1]);
    assert.equal(await count("attendees", "attendee_id = ? AND is_walk_in = 0", [a1]), 1);
  });

  test("new attendee already on the list", async () => {
    const body = { new_attendee: { full_name: "priya  SHÁRMA", company_name: " shell ", email: "new@example.com" }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).data.code, "attendee_exists");
    await createSubmission(a1);
    assert.equal((await api("POST", "/feedback/submit/", { body })).data.code, "already_submitted");
    assert.equal(await count("attendees"), 2);
  });

  test("same name from another company is added", async () => {
    await createSubmission(a1);
    const body = { new_attendee: { full_name: "Priya Sharma", company_name: "BP", email: "priya.bp@example.com" }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).status, 201);
    assert.equal(await count("attendees", "full_name = 'Priya Sharma'"), 2);
  });

  test("new attendee email is required", async () => {
    for (const email of [undefined, "", "   ", null]) {
      const newAttendee = { full_name: "Ana Lopez", company_name: "Total" };
      if (email !== undefined) newAttendee.email = email;
      const r = await api("POST", "/feedback/submit/", { body: { new_attendee: newAttendee, feedback_data: { x: 1 } } });
      assert.equal(r.status, 400);
      assert.ok(r.data.new_attendee.email, `email ${JSON.stringify(email)} is refused`);
    }
    assert.equal(await count("attendees"), 2);
  });

  test("new attendee email is checked and unique", async () => {
    let body = { new_attendee: { full_name: "Ana Lopez", company_name: "Total", email: " Ana@Example.com " }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).status, 201);
    const [ana] = await query("SELECT email FROM attendees WHERE full_name = 'Ana Lopez'");
    assert.equal(ana.email, "ana@example.com");
    body = { new_attendee: { full_name: "Ana Ruiz", company_name: "Total", email: "priya@example.com" }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).data.code, "email_exists");
    body = { new_attendee: { full_name: "Ana Ruiz", company_name: "Total", email: "not-an-email" }, feedback_data: { x: 1 } };
    const r = await api("POST", "/feedback/submit/", { body });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { new_attendee: { email: ["Enter a valid email address."] } });
    assert.equal(await count("attendees", "full_name = 'Ana Ruiz'"), 0);
  });

  test("new attendee needs a company", async () => {
    for (const company of [undefined, "", "   "]) {
      const newAttendee = { full_name: "Ana Lopez", email: "ana@example.com" };
      if (company !== undefined) newAttendee.company_name = company;
      const r = await api("POST", "/feedback/submit/", { body: { new_attendee: newAttendee, feedback_data: { x: 1 } } });
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { new_attendee: { company_name: ["Enter your company name."] } });
    }
    assert.equal(await count("attendees"), 2);
  });

  test("submit needs exactly one attendee", async () => {
    let r = await api("POST", "/feedback/submit/", { body: { feedback_data: { x: 1 } } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { attendee_id: ["Select your name from the list, or add it as a new attendee."] });
    r = await api("POST", "/feedback/submit/", {
      body: { attendee_id: a1, new_attendee: { full_name: "Ana Lopez", company_name: "Total" }, feedback_data: { x: 1 } },
    });
    assert.equal(r.status, 400);
    assert.equal(await count("attendees"), 2);
  });

  test("submit field errors", async () => {
    let r = await api("POST", "/feedback/submit/", { body: { attendee_id: 999999, feedback_data: {} } });
    assert.deepEqual(r.data, {
      attendee_id: ["Select your name from the attendee list."],
      feedback_data: ["This dictionary may not be empty."],
    });
    r = await api("POST", "/feedback/submit/", { body: { attendee_id: "abc", feedback_data: [1] } });
    assert.deepEqual(r.data, {
      attendee_id: ["A valid integer is required."],
      feedback_data: ['Expected a dictionary of items but got type "list".'],
    });
    r = await api("POST", "/feedback/submit/", { body: "{oops", headers: {} });
    assert.equal(r.status, 400);
  });

  test("speaker reviews are limited to 3 in all, whatever the day", async () => {
    const review = (id, day) => ({ session_id: id, day, comment: "Good" });
    const four = [review(1, "Day 1"), review(2, "Day 2"), review(3, "Day 2"), review(4, "Day 3")];
    let r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { speaker_reviews: four } } });
    assert.deepEqual([r.status, r.data], [400, { feedback_data: ["You can review up to 3 sessions in all."] }]);
    r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { speaker_reviews: four.slice(1) } } });
    assert.equal(r.status, 201);
  });

  test("the form never closes, every old status still takes feedback", async () => {
    const people = [a1, a2];
    for (const status of ["inactive", "ended"]) {
      await query("UPDATE form_settings SET form_status = ?", [status]);
      assert.equal((await api("GET", "/attendees/")).status, 200, status);
      const r = await api("POST", "/feedback/submit/", { body: { attendee_id: people.shift(), feedback_data: { x: 1 } } });
      assert.equal(r.status, 201, status);
    }
  });
});

describe("health check", () => {
  test("answers without an event or a sign in", async () => {
    const res = await fetch(root.replace("/events", "/health"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

describe("admin auth", () => {
  // The sign in lockout counts failures in memory, every test here starts with a clean count.
  beforeEach(() => loginGuard.reset());
  after(() => loginGuard.reset());

  // The passwords come from config.js, the same list npm run migrate made the accounts from.
  test("every default admin signs in with the password from the configuration", async () => {
    for (const [username, password, fullName] of config.defaultAdmins) {
      const r = await api("POST", "/auth/login/", { body: { username, password } });
      assert.equal(r.status, 200, username);
      assert.match(r.data.token, /^[0-9a-f]{64}$/, username);
      assert.equal(r.data.username, username);
      assert.equal(r.data.full_name, fullName);
      assert.equal(
        await count("admin_tokens t JOIN admin_users u ON u.id = t.user_id", "t.`key` = ? AND u.username = ?", [r.data.token, username]),
        1
      );
    }
  });

  test("the token from a sign in opens the admin pages", async () => {
    const [username, password] = config.defaultAdmins[0];
    const { data } = await api("POST", "/auth/login/", { body: { username, password } });
    assert.equal((await api("GET", "/auth/me/", { token: data.token })).data.username, username);
    assert.equal((await api("GET", "/admin/settings/", { token: data.token })).status, 200);
  });

  test("username is matched without case", async () => {
    assert.equal((await api("POST", "/auth/login/", { body: { username: " Benny ", password: adminPassword("benny") } })).status, 200);
  });

  test("passwords are hashed in the Django format", async () => {
    const [user] = await query("SELECT password FROM admin_users WHERE username = 'benny'");
    assert.notEqual(user.password, adminPassword("benny"));
    assert.match(user.password, /^pbkdf2_sha256\$600000\$\w+\$[\w+/=]+$/);
  });

  test("a password hashed by Django still signs in", async () => {
    // Hash Django 4.2 produced for "secret123" with salt "abcdefghijklmnopqrstuv".
    const hash = "pbkdf2_sha256$600000$abcdefghijklmnopqrstuv$" +
      require("crypto").pbkdf2Sync("secret123", "abcdefghijklmnopqrstuv", 600000, 32, "sha256").toString("base64");
    await query(
      "INSERT INTO admin_users (username, password, full_name, is_active, created_at) VALUES ('legacy', ?, '', 1, UTC_TIMESTAMP(6))",
      [hash]
    );
    assert.equal((await api("POST", "/auth/login/", { body: { username: "legacy", password: "secret123" } })).status, 200);
    await query("DELETE FROM admin_tokens");
    await query("DELETE FROM admin_users WHERE username = 'legacy'");
  });

  test("every wrong sign in gets the same refusal and no session", async () => {
    const [[first, firstPassword], [second, secondPassword]] = config.defaultAdmins;
    // The count of each name stays under the lockout limit, which has its own test below.
    const cases = [
      ["wrong password", first, "not-the-password"],
      ["right password in the wrong case", first, firstPassword.toUpperCase()],
      ["another admin's password", first, secondPassword],
      ["the old name plus 123 password", second, `${second}123`],
      ["empty password", second, ""],
      ["empty name", "", firstPassword],
      ["name of spaces", "   ", firstPassword],
      ["unknown name", "ghost", "ghost-password"],
      ["SQL in the name", "' OR '1'='1", "x"],
      ["SQL in the password", first, "' OR '1'='1"],
    ];
    const before = await count("admin_tokens");
    for (const [label, username, password] of cases) {
      const r = await api("POST", "/auth/login/", { body: { username, password } });
      assert.equal(r.status, 400, label);
      assert.equal(r.data.detail, "Incorrect username or password.", label);
      assert.equal(r.data.token, undefined, label);
    }
    assert.equal(await count("admin_tokens"), before, "a refused sign in must not make a session");
  });

  test("a sign in with a missing name or password is refused", async () => {
    const [username, password] = config.defaultAdmins[0];
    for (const body of [{}, { username }, { password }, { username: null, password: null }]) {
      const r = await api("POST", "/auth/login/", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.data.token, undefined);
    }
  });

  test("inactive admin is rejected", async () => {
    await query("UPDATE admin_users SET is_active = 0 WHERE username = 'ramon'");
    assert.equal((await api("POST", "/auth/login/", { body: { username: "ramon", password: adminPassword("ramon") } })).status, 400);
  });

  test("sign in is locked after repeated wrong passwords", async () => {
    loginGuard.reset();
    for (let i = 0; i < config.security.loginMaxFailures; i++) {
      assert.equal((await api("POST", "/auth/login/", { body: { username: "benny", password: "wrong" } })).status, 400);
    }
    // Even the right password waits while the lockout lasts.
    const locked = await api("POST", "/auth/login/", { body: { username: "benny", password: adminPassword("benny") } });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    // Another name from the same address is not locked by it.
    assert.equal((await api("POST", "/auth/login/", { body: { username: "maxwell", password: adminPassword("maxwell") } })).status, 200);
    loginGuard.reset();
    assert.equal((await api("POST", "/auth/login/", { body: { username: "benny", password: adminPassword("benny") } })).status, 200);
  });

  test("an expired admin session is rejected", async () => {
    const token = await login("benny");
    assert.equal((await api("GET", "/auth/me/", { token })).status, 200);
    await query("UPDATE admin_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 13 HOUR) WHERE `key` = ?", [token]);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
  });

  test("admin endpoints need a token", async () => {
    assert.equal((await api("GET", "/admin/settings/")).status, 401);
    const r = await api("GET", "/admin/settings/", { token: "not-a-real-token" });
    assert.equal(r.status, 401);
    assert.equal(r.data.detail, "Your session has expired, sign in again.");
    assert.equal(r.headers.get("www-authenticate"), "Token");
  });

  test("lucky draw stays public", async () => {
    // The /lucky-draw screen at the venue runs without signing in.
    assert.equal((await api("GET", "/lucky-draw/pool/")).status, 200);
  });

  test("me and logout", async () => {
    const token = await login("maxwell");
    assert.equal((await api("GET", "/auth/me/", { token })).data.username, "maxwell");
    assert.equal((await api("POST", "/auth/logout/", { token })).status, 204);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
  });

  test("wrong method and unknown path", async () => {
    const r = await api("PUT", "/");
    assert.equal(r.status, 405);
    assert.equal(r.data.detail, 'Method "PUT" not allowed.');
    assert.equal((await api("GET", "/nope/")).status, 404);
    // The form status route is gone, the form is always open.
    assert.equal((await api("GET", "/form-status/")).status, 404);
  });
});

describe("user roles", () => {
  const PASSWORD = "Floor-pass-1";
  let adminToken;
  beforeEach(async () => {
    loginGuard.reset();
    await query("DELETE FROM admin_users WHERE username LIKE 'floor%'");
    adminToken = await login("benny");
  });
  after(async () => {
    await query("DELETE FROM admin_users WHERE username LIKE 'floor%'");
    loginGuard.reset();
  });

  async function addUser(body) {
    return api("POST", "/admin/users/", { token: adminToken, body: { password: PASSWORD, ...body } });
  }
  async function signIn(username, password = PASSWORD) {
    return api("POST", "/auth/login/", { body: { username, password } });
  }
  async function supportToken() {
    assert.equal((await addUser({ username: "floor1", full_name: "Floor One", role: "support" })).status, 201);
    return (await signIn("floor1")).data.token;
  }

  test("migrate changes accounts saved with the old technician role to support", async () => {
    await addUser({ username: "floor1", role: "support" });
    await query("UPDATE admin_users SET role = 'technician' WHERE username = 'floor1'");
    const token = (await signIn("floor1")).data.token;
    await migrate(EVENT_A);
    const [row] = await query("SELECT role FROM admin_users WHERE username = 'floor1'");
    assert.equal(row.role, "support");
    // The session stays and the account now opens the Wi-Fi screen.
    assert.equal((await api("GET", "/auth/me/", { token })).data.role, "support");
    assert.equal((await api("GET", "/admin/wifi/", { token })).status, 200);
    assert.equal(await count("admin_users", "role = 'technician'"), 0);
  });

  test("every default admin has the admin role", async () => {
    for (const [username] of config.defaultAdmins) {
      const r = await api("POST", "/auth/login/", { body: { username, password: adminPassword(username) } });
      assert.equal(r.data.role, "admin");
      assert.equal((await api("GET", "/auth/me/", { token: r.data.token })).data.role, "admin");
    }
  });

  test("an admin adds a support user, who signs in with the role", async () => {
    const r = await addUser({ username: "floor1", full_name: "Floor One", role: "support" });
    assert.equal(r.status, 201);
    assert.equal(r.data.role, "support");
    assert.equal(r.data.is_active, true);
    assert.ok(!("password" in r.data));
    const s = await signIn("floor1");
    assert.equal(s.status, 200);
    assert.equal(s.data.role, "support");
    const me = await api("GET", "/auth/me/", { token: s.data.token });
    assert.deepEqual(me.data, { username: "floor1", full_name: "Floor One", role: "support" });
    assert.equal((await api("POST", "/auth/logout/", { token: s.data.token })).status, 204);
  });

  test("the support user reads and changes the Wi-Fi network and password", async () => {
    const token = await supportToken();
    let r = await api("PATCH", "/admin/wifi/", { token, body: { network: "FloorNet", password: "new-secret-9" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.network, "FloorNet");
    assert.equal(r.data.password, "new-secret-9");
    r = await api("GET", "/admin/wifi/", { token });
    assert.deepEqual([r.data.network, r.data.password], ["FloorNet", "new-secret-9"]);
    // The Wi-Fi page the attendees open shows it at once.
    const pub = (await api("GET", "/wifi/")).data;
    assert.deepEqual([pub.network, pub.password], ["FloorNet", "new-secret-9"]);
    // An admin can use the same screen.
    assert.equal((await api("GET", "/admin/wifi/", { token: adminToken })).status, 200);
  });

  test("the Wi-Fi route changes nothing but the network and password", async () => {
    const token = await supportToken();
    const before = (await api("GET", "/admin/event-details/", { token: adminToken })).data;
    const r = await api("PATCH", "/admin/wifi/", { token, body: { password: "only-this-1", name: "Hacked", logo: "/x.png", website: "https://evil.example" } });
    assert.equal(r.status, 200);
    const after = (await api("GET", "/admin/event-details/", { token: adminToken })).data;
    assert.equal(after.name, before.name);
    assert.equal(after.logo, before.logo);
    assert.equal(after.website, before.website);
    assert.equal(after.password, "only-this-1");
    assert.equal((await api("PATCH", "/admin/wifi/", { token, body: { name: "Hacked" } })).status, 400);
    assert.equal((await api("PATCH", "/admin/wifi/", { token, body: { password: "x".repeat(300) } })).status, 400);
    assert.equal((await api("GET", "/admin/wifi/")).status, 401);
  });

  test("the Wi-Fi QR code is made again when the support user changes the network or password", async () => {
    const wifiQr = require("../src/wifiQr");
    const token = await supportToken();
    const file = (sitePath) => path.join(UPLOADS_DIR, sitePath.replace(/^\/uploads\//, ""));
    const pattern = /^\/uploads\/testa\/wifi-qr-[0-9a-f]{12}\.png$/;

    // The standard Wi-Fi text, with \ ; , : and " escaped. No password means an open network.
    assert.equal(wifiQr.payload({ network: "My;Net", password: 'p:"w' }), 'WIFI:T:WPA;S:My\\;Net;P:p\\:\\"w;;');
    assert.equal(wifiQr.payload({ network: "Open", password: "" }), "WIFI:T:nopass;S:Open;;");

    let r = await api("PATCH", "/admin/wifi/", { token, body: { network: "FloorNet", password: "first-pass-1" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.qr_updated, true);
    assert.match(r.data.qr, pattern);
    const first = r.data.qr;
    assert.deepEqual([...fs.readFileSync(file(first)).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal((await api("GET", "/wifi/")).data.qr, first);
    const served = await fetch(`${root.replace(/\/events$/, "")}${first}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");

    // The same details again change nothing, the file stays.
    r = await api("PATCH", "/admin/wifi/", { token, body: { network: "FloorNet", password: "first-pass-1" } });
    assert.equal(r.data.qr_updated, null);
    assert.equal(r.data.qr, first);
    assert.ok(fs.existsSync(file(first)));

    // A new password gives a new code and the earlier one made by the server is removed.
    r = await api("PATCH", "/admin/wifi/", { token, body: { password: "second-pass-2" } });
    assert.equal(r.data.qr_updated, true);
    assert.match(r.data.qr, pattern);
    assert.notEqual(r.data.qr, first);
    assert.ok(fs.existsSync(file(r.data.qr)));
    assert.ok(!fs.existsSync(file(first)));
    assert.equal((await api("GET", "/admin/wifi/", { token })).data.qr, r.data.qr);

    // A picture an admin uploaded is replaced too, and its file is deleted with it.
    const custom = "/uploads/testa/abc123-0123456789ab.png";
    fs.writeFileSync(file(custom), "custom");
    await query("UPDATE event_details SET wifi_qr = ?", [custom]);
    r = await api("PATCH", "/admin/wifi/", { token, body: { password: "third-pass-3" } });
    assert.match(r.data.qr, pattern);
    assert.ok(!fs.existsSync(file(custom)));

    // No network name leaves nothing to scan.
    const last = r.data.qr;
    r = await api("PATCH", "/admin/wifi/", { token, body: { network: "" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.qr, "");
    assert.ok(!fs.existsSync(file(last)));

    // A rejected change does not touch the code.
    await api("PATCH", "/admin/wifi/", { token, body: { network: "Again", password: "pw-again-4" } });
    const kept = (await api("GET", "/admin/wifi/", { token })).data;
    assert.equal((await api("PATCH", "/admin/wifi/", { token, body: { password: "x".repeat(300) } })).status, 400);
    assert.equal((await api("GET", "/admin/wifi/", { token })).data.qr, kept.qr);
  });

  test("the support user cannot read or change any other screen", async () => {
    const token = await supportToken();
    const closed = [
      ["GET", "/admin/settings/"],
      ["PATCH", "/admin/settings/", {}],
      ["GET", "/admin/submissions/"],
      ["PATCH", "/admin/submissions/1/suspend/", {}],
      ["GET", "/admin/feedback-report/"],
      ["GET", "/admin/feedback-report/pdf/"],
      ["POST", "/admin/feedback-report/send/", {}],
      ["GET", "/admin/logbook/"],
      ["GET", "/admin/event-dates/"],
      ["POST", "/admin/event-dates/refresh/", {}],
      ["GET", "/admin/attendees/"],
      ["POST", "/admin/attendees/", { full_name: "X" }],
      ["GET", "/admin/attendees/sync/"],
      ["POST", "/admin/attendees/sync/", {}],
      ["PATCH", "/admin/attendees/1/", {}],
      ["DELETE", "/admin/attendees/1/"],
      ["GET", "/admin/event-details/"],
      ["PATCH", "/admin/event-details/", { name: "Hacked" }],
      ["GET", "/admin/menu-items/"],
      ["POST", "/admin/menu-items/", { label: "x", target: "/x" }],
      ["PATCH", "/admin/menu-items/1/", {}],
      ["DELETE", "/admin/menu-items/1/"],
      ["POST", "/admin/uploads/", {}],
      ["GET", "/admin/users/"],
      ["POST", "/admin/users/", { username: "floor9", password: PASSWORD, role: "admin" }],
      ["PATCH", "/admin/users/1/", { role: "support" }],
      ["DELETE", "/admin/users/1/"],
    ];
    for (const [method, path, body] of closed) {
      const r = await api(method, path, { token, body });
      assert.equal(r.status, 403, `${method} ${path} gave ${r.status}`);
      assert.deepEqual(r.data, { detail: "Your role does not allow this." });
    }
    assert.equal(await count("admin_users", "username = 'floor9'"), 0);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 200);
  });

  test("the user list shows every account and never a password", async () => {
    await addUser({ username: "floor1", role: "support" });
    const r = await api("GET", "/admin/users/", { token: adminToken });
    assert.equal(r.status, 200);
    const names = r.data.map((u) => u.username);
    for (const [username] of config.defaultAdmins) assert.ok(names.includes(username));
    const floor = r.data.find((u) => u.username === "floor1");
    assert.equal(floor.full_name, "floor1");
    assert.equal(floor.role, "support");
    assert.ok(r.data.every((u) => !("password" in u)));
    assert.equal((await api("GET", "/admin/users/")).status, 401);
  });

  test("a new user is checked", async () => {
    let r = await addUser({ username: "ab", role: "admin" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data.username, ["Use at least 3 characters."]);
    r = await addUser({ username: "floor 1", role: "admin" });
    assert.deepEqual(r.data.username, ["Use letters, digits, dots, dashes and underscores only."]);
    r = await addUser({ username: "floor1", role: "root" });
    assert.deepEqual(r.data.role, ['"root" is not a valid choice.']);
    r = await addUser({ username: "floor1" });
    assert.deepEqual(r.data.role, ["Choose a role."]);
    r = await addUser({ username: "floor1", role: "admin", password: "short" });
    assert.deepEqual(r.data.password, ["Use at least 8 characters."]);
    assert.equal((await addUser({ username: "floor1", role: "admin" })).status, 201);
    r = await addUser({ username: "FLOOR1", role: "admin" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data.username, ["A user with this username already exists."]);
  });

  test("changing the role, the password or disabling signs the user out", async () => {
    const { data: created } = await addUser({ username: "floor1", role: "support" });
    let token = (await signIn("floor1")).data.token;
    // Promoted to admin, the old session ends and the next sign in opens every screen.
    let r = await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { role: "admin" } });
    assert.equal(r.data.role, "admin");
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
    token = (await signIn("floor1")).data.token;
    assert.equal((await api("GET", "/admin/users/", { token })).status, 200);
    // Back to support.
    await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { role: "support" } });
    token = (await signIn("floor1")).data.token;
    assert.equal((await api("GET", "/admin/users/", { token })).status, 403);
    // New password.
    r = await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { password: "Brand-new-pass-2" } });
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
    assert.equal((await signIn("floor1")).status, 400);
    token = (await signIn("floor1", "Brand-new-pass-2")).data.token;
    // Disabled.
    r = await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { is_active: false } });
    assert.equal(r.data.is_active, false);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
    assert.equal((await signIn("floor1", "Brand-new-pass-2")).status, 400);
    await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { is_active: true, full_name: "Renamed" } });
    r = await signIn("floor1", "Brand-new-pass-2");
    assert.equal(r.status, 200);
    assert.equal(r.data.full_name, "Renamed");
    // Nothing to change, or a bad value.
    assert.equal((await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: {} })).status, 400);
    assert.equal((await api("PATCH", `/admin/users/${created.id}/`, { token: adminToken, body: { role: "root" } })).status, 400);
    assert.equal((await api("PATCH", "/admin/users/999999/", { token: adminToken, body: { role: "admin" } })).status, 404);
  });

  test("an admin cannot lock themselves or everyone out", async () => {
    const me = (await api("GET", "/admin/users/", { token: adminToken })).data.find((u) => u.username === "benny");
    let r = await api("PATCH", `/admin/users/${me.id}/`, { token: adminToken, body: { role: "support" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data.role, ["You cannot change your own role."]);
    r = await api("PATCH", `/admin/users/${me.id}/`, { token: adminToken, body: { is_active: false } });
    assert.deepEqual(r.data.is_active, ["You cannot disable your own account."]);
    r = await api("DELETE", `/admin/users/${me.id}/`, { token: adminToken });
    assert.deepEqual(r.data.detail, ["You cannot delete your own account."]);
    // Own name and password can be changed, the device stays signed in.
    r = await api("PATCH", `/admin/users/${me.id}/`, { token: adminToken, body: { full_name: "Benny B" } });
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "/auth/me/", { token: adminToken })).status, 200);
    await query("UPDATE admin_users SET full_name = 'Benny' WHERE username = 'benny'");

    // Another admin can disable or demote this one while an active admin is left, and not the last one.
    const { data: second } = await addUser({ username: "floor2", role: "admin" });
    const secondToken = (await signIn("floor2")).data.token;
    try {
      r = await api("PATCH", `/admin/users/${me.id}/`, { token: secondToken, body: { is_active: false } });
      assert.equal(r.status, 200);
      assert.equal((await api("GET", "/auth/me/", { token: adminToken })).status, 401);
      // floor2 is now the only active admin, the guard stops anyone from removing the last one.
      await query("UPDATE admin_users SET is_active = 0 WHERE role = 'admin' AND id <> ?", [second.id]);
      r = await api("PATCH", `/admin/users/${second.id}/`, { token: secondToken, body: { role: "support" } });
      assert.deepEqual(r.data.role, ["You cannot change your own role."]);
      assert.equal(await count("admin_users", "role = 'admin' AND is_active = 1"), 1);
    } finally {
      await query("UPDATE admin_users SET is_active = 1");
    }
  });

  test("an admin deletes a user", async () => {
    const { data: created } = await addUser({ username: "floor1", role: "support" });
    const token = (await signIn("floor1")).data.token;
    assert.equal((await api("DELETE", `/admin/users/${created.id}/`, { token: adminToken })).status, 204);
    assert.equal((await api("GET", "/auth/me/", { token })).status, 401);
    assert.equal((await signIn("floor1")).status, 400);
    assert.equal((await api("DELETE", `/admin/users/${created.id}/`, { token: adminToken })).status, 404);
  });
});

describe("admin panel", () => {
  let token;
  beforeEach(async () => {
    token = await login("benny");
  });

  test("settings validation", async () => {
    let r = await api("PATCH", "/admin/settings/", { token, body: { max_spin_attempts: -1 } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { max_spin_attempts: ["Ensure this value is greater than or equal to 0."] });
    // The admin cannot close the form, a form_status sent is left out.
    r = await api("PATCH", "/admin/settings/", { token, body: { form_status: "ended", max_spin_attempts: "3" } });
    assert.equal(r.status, 200);
    assert.ok(!("form_status" in r.data));
    assert.equal(r.data.max_spin_attempts, 3);
    assert.match(r.data.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z$/);
    const [row] = await query("SELECT form_status FROM form_settings WHERE id = 1");
    assert.equal(row.form_status, "active");
    assert.equal((await api("GET", "/attendees/")).status, 200);
  });

  test("submissions list, filters and suspend", async () => {
    const a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    const a2 = await createAttendee("James Smith", "james@example.com", "BP");
    const s1 = await createSubmission(a1);
    await createSubmission(a2, { suspended: true });
    let r = await api("GET", "/admin/submissions/", { token });
    assert.deepEqual(r.data.stats, { total: 2, active: 1, suspended: 1 });
    assert.equal(r.data.pad_length, 3);
    assert.deepEqual(r.data.results[0].feedback_data, { x: 1 });
    assert.equal(r.data.results[0].attendee_name, "Priya Sharma");
    r = await api("GET", "/admin/submissions/?q=shell", { token });
    assert.deepEqual(r.data.results.map((s) => s.id), [s1]);
    r = await api("GET", "/admin/submissions/?status=suspended", { token });
    assert.deepEqual(r.data.results.map((s) => s.attendee_name), ["James Smith"]);
    r = await api("PATCH", `/admin/submissions/${s1}/suspend/`, { token, body: {} });
    assert.equal(r.data.is_suspended, true);
    r = await api("PATCH", `/admin/submissions/${s1}/suspend/`, { token, body: { is_suspended: false } });
    assert.equal(r.data.is_suspended, false);
    assert.equal((await api("PATCH", "/admin/submissions/999999/suspend/", { token, body: {} })).status, 404);
    assert.equal((await api("PATCH", "/admin/submissions/abc/suspend/", { token, body: {} })).status, 404);
  });

  test("interested attendees are grouped by upcoming conference", async () => {
    const bearer = { headers: { Authorization: `Bearer ${EXPORT_TOKEN}` } };
    assert.equal((await api("GET", "/admin/interested-attendees/")).status, 401);
    assert.equal((await api("GET", "/admin/interested-attendees/", { token })).status, 401); // admin login is not enough
    assert.equal(
      (await api("GET", "/admin/interested-attendees/", { headers: { Authorization: "Bearer wrong" } })).status,
      401
    );
    assert.equal((await api("GET", "/admin/feedback-responses/")).status, 401);
    assert.equal((await api("GET", "/admin/feedback-responses/", bearer)).status, 200);
    assert.equal((await api("PATCH", "/admin/settings/", { ...bearer, body: {} })).status, 401); // token opens only the exports
    const add = async (name, email, company, data, suspended = 0) => {
      const id = await createAttendee(name, email, company);
      await query(
        "INSERT INTO feedback_submissions (attendee_id, device_fingerprint, feedback_data, userAliesName, userComapnyAliesName, is_suspended, created_at) " +
          "VALUES (?, 'a', ?, ?, ?, ?, UTC_TIMESTAMP(6))",
        [id, JSON.stringify(data), name, company, suspended]
      );
    };
    await add("Priya Sharma", "priya@example.com", "Shell", { upcoming_interest: ["Energy Summit", "Gas Forum"] });
    await add("James Smith", "james@example.com", "BP", { upcoming_interest: ["Energy Summit"] });
    await add("Hidden Person", "hidden@example.com", "Acme", { upcoming_interest: ["Energy Summit"] }, 1);
    await add("No Interest", "none@example.com", "Acme", { upcoming_interest: [] });
    await add("No Answer", "na@example.com", "Acme", { x: 1 });
    // Several conferences ticked on question 8 come back as a list in the feedback responses.
    const fr = await api("GET", "/admin/feedback-responses/", bearer);
    const priya = fr.data.results.find((x) => x.attendeename === "Priya Sharma");
    assert.deepEqual(priya.feedback.find((f) => f.question === "Which of our upcoming conferences interest you?").response, ["Energy Summit", "Gas Forum"]);
    const r = await api("GET", "/admin/interested-attendees/", bearer);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, {
      events: [
        {
          event_name: "Energy Summit",
          count: 2,
          attendees: [
            { attendeename: "Priya Sharma", companyname: "Shell", emailaddress: "priya@example.com" },
            { attendeename: "James Smith", companyname: "BP", emailaddress: "james@example.com" },
          ],
        },
        {
          event_name: "Gas Forum",
          count: 1,
          attendees: [{ attendeename: "Priya Sharma", companyname: "Shell", emailaddress: "priya@example.com" }],
        },
      ],
    });
  });

  test("attendee create, edit and delete", async () => {
    let r = await api("POST", "/admin/attendees/", { token, body: { full_name: " Ana Lopez ", email: "Ana@Example.com " } });
    assert.equal(r.status, 201);
    assert.equal(r.data.full_name, "Ana Lopez");
    assert.equal(r.data.email, "ana@example.com");
    assert.equal(r.data.company_name, "");
    assert.equal(r.data.has_submitted, false);
    const id = r.data.attendee_id;

    r = await api("POST", "/admin/attendees/", { token, body: { full_name: "", email: "ANA@example.com" } });
    assert.deepEqual(r.data, {
      full_name: ["This field may not be blank."],
      email: ["attendee with this email already exists."],
    });

    r = await api("PATCH", `/admin/attendees/${id}/`, { token, body: { company_name: "Total", email: "" } });
    assert.equal(r.data.company_name, "Total");
    assert.equal(r.data.email, null);

    await createSubmission(id);
    r = await api("DELETE", `/admin/attendees/${id}/`, { token });
    assert.equal(r.status, 400);
    const other = await createAttendee("James Smith", null);
    assert.equal((await api("DELETE", `/admin/attendees/${other}/`, { token })).status, 204);
    assert.equal((await api("DELETE", `/admin/attendees/${other}/`, { token })).status, 404);

    r = await api("GET", "/admin/attendees/?q=lopez", { token });
    assert.deepEqual(r.data.map((a) => [a.full_name, a.has_submitted]), [["Ana Lopez", true]]);
  });
});

describe("lucky draw", () => {
  let a1;
  let a2;
  let token;
  beforeEach(async () => {
    a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    a2 = await createAttendee("James Smith", "james@example.com", "BP");
    token = await login("benny");
  });

  test("spin duration setting", async () => {
    assert.equal((await api("GET", "/admin/settings/", { token })).data.spin_duration_seconds, 5);
    const r = await api("PATCH", "/admin/settings/", { token, body: { spin_duration_seconds: 8 } });
    assert.equal(r.data.spin_duration_seconds, 8);
    assert.equal((await api("GET", "/lucky-draw/pool/")).data.spin_duration_seconds, 8);
    for (const bad of [0, 61]) {
      assert.equal((await api("PATCH", "/admin/settings/", { token, body: { spin_duration_seconds: bad } })).status, 400);
    }
  });

  test("the feedback form stays open after a spin", async () => {
    await createSubmission(a1);
    assert.equal((await api("POST", "/lucky-draw/spin/")).status, 200);
    assert.equal((await api("GET", "/attendees/")).status, 200);
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a2, feedback_data: { x: 1 } } });
    assert.equal(r.status, 201);
  });

  test("spin hides the name until reveal", async () => {
    const s1 = await createSubmission(a1);
    await createSubmission(a2);
    await api("PATCH", `/admin/submissions/${s1}/suspend/`, { token, body: {} });
    const pool = (await api("GET", "/lucky-draw/pool/")).data;
    assert.equal(pool.count, 1);
    assert.ok(!pool.ids.includes(s1));

    const spin = (await api("POST", "/lucky-draw/spin/")).data;
    assert.deepEqual(Object.keys(spin).sort(), ["pad_length", "submission_id"]); // no name before reveal
    assert.notEqual(spin.submission_id, s1);

    const reveal = await api("POST", "/lucky-draw/reveal/", { token, body: { submission_id: spin.submission_id, attempt_number: 1 } });
    assert.equal(reveal.status, 201);
    assert.equal(reveal.data.attendee_name, "James Smith");
    assert.equal(reveal.data.drawn_by, "benny");
    assert.equal(await count("lucky_draw_winners"), 1);
  });

  test("reveal rejects suspended", async () => {
    const s1 = await createSubmission(a1, { suspended: true });
    assert.equal((await api("POST", "/lucky-draw/reveal/", { body: { submission_id: s1 } })).status, 400);
  });

  test("winner is shown by the alias, admin sees both names", async () => {
    const body = { attendee_id: a1, alias_name: "Xyz Rep", company_alias_name: "Shell Rep", feedback_data: { x: 1 } };
    const id = (await api("POST", "/feedback/submit/", { body })).data.id;

    const reveal = await api("POST", "/lucky-draw/reveal/", { body: { submission_id: id } });
    assert.deepEqual([reveal.data.attendee_name, reveal.data.company_name], ["Xyz Rep", "Shell Rep"]);
    assert.ok(!JSON.stringify((await api("GET", "/lucky-draw/winners/")).data).includes("Priya Sharma"));

    const [sub] = (await api("GET", "/admin/submissions/?q=xyz", { token })).data.results;
    assert.deepEqual(
      [sub.attendee_name, sub.company_name, sub.alias_name, sub.company_alias_name],
      ["Priya Sharma", "Shell", "Xyz Rep", "Shell Rep"]
    );

    // Attendees page, the alias shows once the attendee has submitted.
    const people = (await api("GET", "/admin/attendees/", { token })).data;
    const pick = (name) => people.find((a) => a.full_name === name);
    assert.deepEqual([pick("Priya Sharma").alias_name, pick("Priya Sharma").company_alias_name], ["Xyz Rep", "Shell Rep"]);
    assert.deepEqual([pick("James Smith").alias_name, pick("James Smith").company_alias_name], [null, null]);
    assert.deepEqual((await api("GET", "/admin/attendees/?q=xyz", { token })).data.map((a) => a.full_name), ["Priya Sharma"]);
  });

  test("past winners leave the pool", async () => {
    const s1 = await createSubmission(a1);
    const s2 = await createSubmission(a2);
    assert.equal((await api("POST", "/lucky-draw/reveal/", { token, body: { submission_id: s1 } })).status, 201);
    const pool = (await api("GET", "/lucky-draw/pool/")).data;
    assert.deepEqual([pool.ids, pool.past_winners], [[s2], 1]);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await api("POST", "/lucky-draw/spin/")).data.submission_id, s2);
    }
    // the same entry cannot be revealed twice
    assert.equal((await api("POST", "/lucky-draw/reveal/", { token, body: { submission_id: s1 } })).status, 400);
    // with the history emptied, the winners are back in the pool
    await query("DELETE FROM lucky_draw_winners");
    assert.equal((await api("GET", "/lucky-draw/pool/")).data.count, 2);
  });

  test("draw works without signing in", async () => {
    await query("DELETE FROM attendees WHERE attendee_id = ?", [a2]);
    const sub = await createSubmission(a1);
    assert.deepEqual((await api("GET", "/lucky-draw/pool/")).data.ids, [sub]);
    assert.equal((await api("POST", "/lucky-draw/spin/")).data.submission_id, sub);
    const r = await api("POST", "/lucky-draw/reveal/", { body: { submission_id: String(sub) } });
    assert.equal(r.status, 201);
    assert.equal(r.data.drawn_by, null);
    assert.equal(r.data.attempt_number, 1);
    assert.equal((await api("GET", "/lucky-draw/winners/")).data.length, 1);
  });

  test("winners cannot be deleted through the API", async () => {
    // There is no route that clears the winner history, the method is refused for anyone.
    assert.equal((await api("DELETE", "/lucky-draw/winners/")).status, 405);
    assert.equal((await api("DELETE", "/lucky-draw/winners/", { token: await login("benny") })).status, 405);
  });

  test("empty pool", async () => {
    const r = await api("POST", "/lucky-draw/spin/");
    assert.equal(r.status, 400);
    assert.equal(r.data.detail, "No eligible submissions in the pool.");
  });
});

describe("events", () => {
  test("event config is public and leaves out the database", async () => {
    const r = await api("GET", "/");
    assert.equal(r.status, 200);
    assert.equal(r.data.code, "testa");
    assert.equal(r.data.name, "Test event a");
    assert.ok(!("database" in r.data));
    assert.deepEqual(r.data.theme, { secondary: "#ff6600" });
    assert.equal((await api("GET", "/", { event: "testb" })).data.theme, undefined);
  });

  test("theme secondary colour is checked when the events file loads", () => {
    const { loadEvents } = require("../src/events");
    const file = path.join(os.tmpdir(), `feedback-test-events-${process.pid}.json`);
    const load = (theme) => {
      fs.writeFileSync(file, JSON.stringify({ demo: { database: "feedback_demo", theme } }));
      try {
        return loadEvents(file);
      } finally {
        fs.unlinkSync(file);
      }
    };
    assert.equal(load({ secondary: "#278DFF" }).get("demo").theme.secondary, "#278DFF");
    assert.ok(load({}).has("demo"));
    for (const bad of ["278dff", "#278df", "blue", "#278dff; color: red"]) {
      assert.throws(() => load({ secondary: bad }), /"theme.secondary" must be a colour like #278dff/);
    }
    assert.throws(() => load("blue"), /"theme" must be an object/);
  });

  test("codes are matched without case", async () => {
    assert.equal((await api("GET", "/", { event: "TESTA" })).status, 200);
  });

  test("unknown and switched off events are not found", async () => {
    for (const event of ["nope", "off"]) {
      const r = await api("GET", "/attendees/", { event });
      assert.equal(r.status, 404, event);
      assert.equal(r.data.detail, "Event not found.");
    }
    const r = await fetch(`${root.replace(/\/events$/, "")}/attendees/`);
    assert.equal(r.status, 404);
  });

  test("attendees and submissions stay in their own event", async () => {
    const a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await queryB(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES ('James Smith', 'james@example.com', 'BP', 0, UTC_TIMESTAMP(6))"
    );
    assert.deepEqual((await api("GET", "/attendees/")).data.map((a) => a.full_name), ["Priya Sharma"]);
    assert.deepEqual((await api("GET", "/attendees/", { event: "testb" })).data.map((a) => a.full_name), ["James Smith"]);

    // The same email can register for both events.
    const r = await api("POST", "/feedback/submit/", {
      event: "testb",
      body: { new_attendee: { full_name: "Priya Sharma", company_name: "Shell", email: "priya@example.com" }, feedback_data: { x: 1 } },
    });
    assert.equal(r.status, 201);

    assert.equal((await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } })).status, 201);
    assert.equal((await api("GET", "/lucky-draw/pool/")).data.count, 1);
    assert.equal((await api("GET", "/lucky-draw/pool/", { event: "testb" })).data.count, 1);
    assert.equal((await api("GET", "/attendees/")).data.length, 0);
  });

  test("registered attendees list names and companies, without walk-ins or emails", async () => {
    await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await query(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES ('Walk In', NULL, 'Acme', 1, UTC_TIMESTAMP(6))"
    );
    await queryB(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES ('James Smith', NULL, 'BP', 0, UTC_TIMESTAMP(6))"
    );
    const r = await api("GET", "/registered-attendees/");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, [{ name: "Priya Sharma", company: "Shell" }]);
    assert.deepEqual((await api("GET", "/registered-attendees/", { event: "testb" })).data, [{ name: "James Smith", company: "BP" }]);
  });

  test("registered attendees show the alias once submitted", async () => {
    const id = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await createAttendee("Ana Lopez", null, "BP");
    await query(
      "INSERT INTO feedback_submissions (attendee_id, device_fingerprint, feedback_data, userAliesName, userComapnyAliesName, is_suspended, created_at) " +
        "VALUES (?, 'a', '{}', 'Xyz Rep', 'Acme Rep', 0, UTC_TIMESTAMP(6))",
      [id]
    );
    assert.deepEqual((await api("GET", "/registered-attendees/")).data, [
      { name: "Xyz Rep", company: "Acme Rep" },
      { name: "Ana Lopez", company: "BP" },
    ]);
  });

  test("settings belong to one event", async () => {
    const token = await login("benny");
    await api("PATCH", "/admin/settings/", { token, body: { max_spin_attempts: 7 } });
    assert.equal((await api("GET", "/lucky-draw/pool/")).data.max_spin_attempts, 7);
    assert.equal((await api("GET", "/lucky-draw/pool/", { event: "testb" })).data.max_spin_attempts, 0);
  });

  test("an admin token only works for the event it was issued for", async () => {
    const token = await login("benny");
    assert.equal((await api("GET", "/auth/me/", { token })).status, 200);
    const r = await api("GET", "/auth/me/", { token, event: "testb" });
    assert.equal(r.status, 401);
    // Each event has its own admin accounts, signing in to testb gives a different token.
    const tokenB = await login("benny", "testb");
    assert.notEqual(tokenB, token);
    assert.equal((await api("GET", "/admin/settings/", { token: tokenB, event: "testb" })).status, 200);
  });
});

describe("event details", () => {
  let token;
  beforeEach(async () => {
    for (const q of [query, queryB]) {
      await q("DELETE FROM menu_items");
      await q("DELETE FROM event_details");
    }
    token = await login("benny");
  });

  test("first read copies events.json and adds the default menu", async () => {
    const r = await api("GET", "/");
    assert.equal(r.data.name, "Test event a");
    assert.deepEqual(r.data.theme, { secondary: "#ff6600" });
    // testa has no agenda or LinkedIn link in events.json, so those two items are left out.
    assert.deepEqual(r.data.menu.map((m) => m.target), ["/registered-attendees", "/feedback-form", "/wifipassword", "website"]);
    assert.ok(r.data.menu.every((m) => m.icon.startsWith("/common/images/menu/") && !("is_visible" in m)));
    const admin = await api("GET", "/admin/event-details/", { token });
    assert.equal(admin.status, 200);
    assert.equal(admin.data.name, "Test event a");
    assert.equal(admin.data.secondary, "#ff6600");
    assert.ok(!("agenda" in admin.data) && !("linkedin" in admin.data));
    assert.equal(admin.data.menu.length, 4);
    // testb's agenda link becomes the item's address, its LinkedIn value is not a URL and is left out.
    const b = (await api("GET", "/", { event: "testb" })).data.menu;
    assert.deepEqual(b.map((m) => m.target), ["https://example.com/agenda", "/registered-attendees", "/feedback-form", "/wifipassword", "website"]);
  });

  test("admin edits reach the site config, blanks are left out", async () => {
    let r = await api("PATCH", "/admin/event-details/", {
      token,
      body: {
        name: "Renamed",
        tagline: "Line one\nLine two",
        secondary: "#00AA11",
        logo: "/uploads/testa/logo.png",
        heroVideoMp4: "https://cdn.example.com/hero.mp4",
        website: "https://example.com/",
        network: "EventWiFi",
        password: "secret1",
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.secondary, "#00aa11");
    r = await api("GET", "/");
    assert.equal(r.data.name, "Renamed");
    assert.equal(r.data.tagline, "Line one\nLine two");
    assert.deepEqual(r.data.theme, { secondary: "#00aa11" });
    assert.deepEqual(r.data.media, { logo: "/uploads/testa/logo.png", heroVideoMp4: "https://cdn.example.com/hero.mp4" });
    assert.deepEqual(r.data.links, { website: "https://example.com/" });
    // The Wi-Fi details are not in the config every page loads, only in /wifi/ for the Wi-Fi page.
    assert.equal(r.data.wifi, undefined);
    // Saving the network made its QR code.
    const wifi = (await api("GET", "/wifi/")).data;
    assert.deepEqual({ network: wifi.network, password: wifi.password }, { network: "EventWiFi", password: "secret1" });
    assert.match(wifi.qr, /^\/uploads\/testa\/wifi-qr-[0-9a-f]{12}\.png$/);
    await api("PATCH", "/admin/event-details/", { token, body: { secondary: "" } });
    assert.equal((await api("GET", "/")).data.theme, undefined);
    // Another event keeps its own details.
    assert.equal((await api("GET", "/", { event: "testb" })).data.name, "Test event b");
  });

  test("event details validation", async () => {
    const r = await api("PATCH", "/admin/event-details/", {
      token,
      body: { name: " ", secondary: "blue", logo: "javascript:alert(1)", website: "/agenda", favicon: "//evil.example/x.png" },
    });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.data).sort(), ["favicon", "logo", "name", "secondary", "website"]);
    assert.equal((await api("GET", "/admin/event-details/")).status, 401);
  });

  test("menu items are added, sorted, hidden and deleted", async () => {
    let r = await api("POST", "/admin/menu-items/", {
      token,
      body: { label: "Sponsors", icon: "/uploads/testa/s.svg", target: "https://example.com/sponsors", sort_order: 5 },
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    assert.equal(r.data.is_visible, true);
    let menu = (await api("GET", "/")).data.menu;
    assert.equal(menu[0].label, "Sponsors");

    r = await api("PATCH", `/admin/menu-items/${id}/`, { token, body: { sort_order: 999, is_visible: false } });
    assert.equal(r.status, 200);
    menu = (await api("GET", "/")).data.menu;
    assert.ok(!menu.some((m) => m.id === id));
    assert.equal((await api("GET", "/admin/menu-items/", { token })).data.at(-1).id, id);

    r = await api("POST", "/admin/menu-items/", { token, body: { label: "", target: "ftp://x", sort_order: -1 } });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.data).sort(), ["label", "sort_order", "target"]);

    assert.equal((await api("DELETE", `/admin/menu-items/${id}/`, { token })).status, 204);
    assert.equal((await api("DELETE", `/admin/menu-items/${id}/`, { token })).status, 404);
  });

  test("migrate moves the agenda and LinkedIn links into their menu items", async () => {
    const { moveLinksIntoMenu } = require("../src/eventDetails");
    await api("GET", "/");
    await query("ALTER TABLE event_details ADD COLUMN agenda_url varchar(500) NOT NULL DEFAULT '', ADD COLUMN linkedin_url varchar(500) NOT NULL DEFAULT ''");
    await query("UPDATE event_details SET agenda_url = 'https://example.com/agenda'");
    for (const target of ["agenda", "linkedin"]) {
      await query(
        "INSERT INTO menu_items (label, icon, target, sort_order, is_visible, created_at, updated_at) VALUES (?, '', ?, 1, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [target, target]
      );
    }
    await db.withDatabase(EVENT_A.database, () => moveLinksIntoMenu());
    const targets = (await query("SELECT label, target FROM menu_items WHERE label IN ('agenda', 'linkedin')")).map((m) => `${m.label} ${m.target}`);
    assert.deepEqual(targets, ["agenda https://example.com/agenda"]);
    const columns = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_details' AND COLUMN_NAME IN ('agenda_url', 'linkedin_url')");
    assert.equal(columns.length, 0);
    // A second run finds nothing to do.
    await db.withDatabase(EVENT_A.database, () => moveLinksIntoMenu());
  });

  test("migrate moves the old media paths to frontend/public/events and frontend/public/common", async () => {
    const { movePublicMedia } = require("../src/eventDetails");
    await api("GET", "/");
    await query(
      "UPDATE event_details SET logo = '/images/aiu26/aiu_logo.png', favicon = '/images/aiu26/favicon_aiu26.png', hero_video_mp4 = '/videos/aiu26/aiu_video.mp4', background = 'https://example.com/keep.png', venue_logo = '/uploads/testa/keep.png'"
    );
    await query("INSERT INTO menu_items (label, icon, target, sort_order, is_visible, created_at, updated_at) VALUES ('old icon', '/images/common/menu/wifi.svg', '/x', 1, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))");
    const run = () => db.withDatabase(EVENT_A.database, () => movePublicMedia());
    await run();
    const [row] = await query("SELECT logo, favicon, hero_video_mp4, background, venue_logo FROM event_details");
    assert.deepEqual({ ...row }, {
      logo: "/events/aiu26/images/logo.png",
      favicon: "/events/aiu26/images/favicon.png",
      hero_video_mp4: "/events/aiu26/videos/video.mp4",
      background: "https://example.com/keep.png",
      venue_logo: "/uploads/testa/keep.png",
    });
    const [item] = await query("SELECT icon FROM menu_items WHERE label = 'old icon'");
    assert.equal(item.icon, "/common/images/menu/wifi.svg");
    // A second run changes nothing.
    await run();
    assert.equal((await query("SELECT logo FROM event_details"))[0].logo, "/events/aiu26/images/logo.png");
  });

  test("deleting every menu item does not bring the defaults back", async () => {
    const items = (await api("GET", "/admin/menu-items/", { token })).data;
    for (const item of items) await api("DELETE", `/admin/menu-items/${item.id}/`, { token });
    assert.deepEqual((await api("GET", "/")).data.menu, []);
  });

  describe("uploaded files are replaced, not kept as copies", () => {
    const upload = async (name = "a.png") => {
      const form = new FormData();
      form.append("kind", "image");
      form.append("file", new Blob([`${name}-${Math.random()}`]), name);
      const r = await api("POST", "/admin/uploads/", { token, form });
      assert.equal(r.status, 201);
      return r.data.url;
    };
    const disk = (url) => path.join(UPLOADS_DIR, url.replace(/^\/uploads\//, ""));
    const exists = (url) => fs.existsSync(disk(url));
    const patch = (body) => api("PATCH", "/admin/event-details/", { token, body });

    test("replacing or removing a media field deletes the old file", async () => {
      const a = await upload();
      assert.equal((await patch({ logo: a })).status, 200);
      assert.ok(exists(a));
      const b = await upload();
      assert.ok(exists(a), "an upload waiting to be saved does not delete the one in use");
      await patch({ logo: b });
      assert.ok(!exists(a));
      assert.ok(exists(b));
      await patch({ logo: "" });
      assert.ok(!exists(b));
    });

    test("a file two fields hold stays until the last one lets go", async () => {
      const c = await upload();
      await patch({ logo: c, venueLogo: c });
      await patch({ logo: "" });
      assert.ok(exists(c));
      await patch({ venueLogo: "" });
      assert.ok(!exists(c));
    });

    test("a menu icon follows the same rule, also when the item is deleted", async () => {
      const d = await upload();
      const item = (await api("POST", "/admin/menu-items/", { token, body: { label: "Icon test", icon: d, target: "/x" } })).data;
      const e = await upload();
      await api("PATCH", `/admin/menu-items/${item.id}/`, { token, body: { icon: e } });
      assert.ok(!exists(d));
      assert.ok(exists(e));
      assert.equal((await api("DELETE", `/admin/menu-items/${item.id}/`, { token })).status, 204);
      assert.ok(!exists(e));
    });

    test("an upload nobody saved is kept for a while, then deleted on the next save", async () => {
      const fresh = await upload();
      const stale = await upload();
      const old = new Date(Date.now() - 2 * 3600 * 1000);
      fs.utimesSync(disk(stale), old, old);
      await patch({ tagline: "Any save runs the cleanup" });
      assert.ok(exists(fresh));
      assert.ok(!exists(stale));
    });

    test("the Wi-Fi QR code follows the details saved on the Event Details page", async () => {
      const qrOf = async () => (await api("GET", "/admin/event-details/", { token })).data.wifiQr;
      const pattern = /^\/uploads\/testa\/wifi-qr-[0-9a-f]{12}\.png$/;

      // Saving a network and password makes the code, with nothing to click.
      let r = await patch({ network: "AdminNet", password: "admin-pass-1" });
      assert.equal(r.data.qr_updated, true);
      assert.match(r.data.wifiQr, pattern);
      const first = r.data.wifiQr;
      assert.ok(exists(first));

      // A save that does not touch the network or the password leaves the code, and says nothing about it.
      r = await patch({ tagline: "Nothing to do with Wi-Fi" });
      assert.equal(r.data.qr_updated, null);
      assert.equal(r.data.wifiQr, first);

      // A new password makes a new code, the earlier file is deleted.
      r = await patch({ password: "admin-pass-2" });
      assert.equal(r.data.qr_updated, true);
      assert.notEqual(r.data.wifiQr, first);
      assert.ok(exists(r.data.wifiQr));
      assert.ok(!exists(first));
      const second = r.data.wifiQr;

      // A page cannot choose the code, one sent is ignored, so an old page cannot put back an old picture.
      r = await patch({ tagline: "Stale page", wifiQr: first });
      assert.equal(r.status, 200);
      assert.equal(r.data.wifiQr, second);
      r = await patch({ wifiQr: "https://example.com/other.png" });
      assert.equal(await qrOf(), second);

      // A code whose file has gone, for example after a redeploy wiped the disk, is made again on the next save.
      fs.rmSync(disk(second));
      r = await patch({ tagline: "After the disk was wiped" });
      assert.equal(r.data.qr_updated, true);
      assert.ok(exists(r.data.wifiQr));

      // No network name leaves nothing to scan.
      const last = r.data.wifiQr;
      r = await patch({ network: "" });
      assert.equal(r.data.wifiQr, "");
      assert.ok(!exists(last));
    });

    test("the security type and the hidden setting go into the Wi-Fi QR code", async () => {
      const wifiQr = require("../src/wifiQr");
      // The text phones read. WPA is the default, WEP and open networks are written as chosen, H:true only when hidden.
      assert.equal(wifiQr.payload({ network: "Net", password: "pw" }), "WIFI:T:WPA;S:Net;P:pw;;");
      assert.equal(wifiQr.payload({ network: "Net", password: "pw", security: "WEP" }), "WIFI:T:WEP;S:Net;P:pw;;");
      assert.equal(wifiQr.payload({ network: "Net", password: "pw", hidden: true }), "WIFI:T:WPA;S:Net;P:pw;H:true;;");
      assert.equal(wifiQr.payload({ network: "Net", password: "pw", security: "nopass" }), "WIFI:T:nopass;S:Net;;");
      assert.equal(wifiQr.payload({ network: "Net", password: "", security: "WPA", hidden: true }), "WIFI:T:nopass;S:Net;H:true;;");

      // New events start as a visible WPA network.
      let r = await api("GET", "/admin/event-details/", { token });
      assert.equal(r.data.security, "WPA");
      assert.equal(r.data.hidden, false);

      r = await patch({ network: "HiddenNet", password: "pw-hidden-1" });
      const plain = r.data.wifiQr;
      assert.equal(r.data.qr_updated, true);

      // Each setting changes the code, and nothing else about the details changes with it.
      r = await patch({ hidden: true });
      assert.equal(r.data.qr_updated, true);
      assert.equal(r.data.hidden, true);
      assert.notEqual(r.data.wifiQr, plain);
      const hiddenQr = r.data.wifiQr;
      assert.ok(!exists(plain));
      r = await patch({ security: "WEP" });
      assert.equal(r.data.qr_updated, true);
      assert.equal(r.data.security, "WEP");
      assert.notEqual(r.data.wifiQr, hiddenQr);
      assert.ok(!exists(hiddenQr));

      // Saving the same values again leaves the code alone.
      r = await patch({ security: "WEP", hidden: true });
      assert.equal(r.data.qr_updated, null);

      // Both are checked.
      r = await patch({ security: "WPA3" });
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { security: ['"WPA3" is not a valid choice.'] });
      r = await patch({ hidden: "yes" });
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { hidden: ["Must be a valid boolean."] });

      // The support user's Wi-Fi screen changes the network and password only, the two settings stay as the admin set them.
      const support = await api("POST", "/admin/users/", { token, body: { username: "floorqr", password: "Floor-pass-1", role: "support" } });
      assert.equal(support.status, 201);
      try {
        const supportToken = (await api("POST", "/auth/login/", { body: { username: "floorqr", password: "Floor-pass-1" } })).data.token;
        r = await api("PATCH", "/admin/wifi/", { token: supportToken, body: { password: "pw-by-support-2", security: "nopass", hidden: false } });
        assert.equal(r.status, 200);
        const after = (await api("GET", "/admin/event-details/", { token })).data;
        assert.equal(after.password, "pw-by-support-2");
        assert.equal(after.security, "WEP");
        assert.equal(after.hidden, true);
        assert.ok(exists(after.wifiQr));
      } finally {
        await query("DELETE FROM admin_users WHERE username = 'floorqr'");
      }
    });

    test("only the event's own uploaded files are ever deleted", async () => {
      // Other events, web addresses, site paths and paths that climb out of the folder are left alone.
      fs.mkdirSync(path.join(UPLOADS_DIR, "testb"), { recursive: true });
      const other = "/uploads/testb/keep.png";
      fs.writeFileSync(disk(other), "other event");
      const old = new Date(Date.now() - 2 * 3600 * 1000);
      fs.utimesSync(disk(other), old, old);
      await patch({ logo: "/uploads/testa/../testb/keep.png", favicon: "https://example.com/f.png", heroPoster: "/events/testa/images/p.png" });
      await patch({ logo: "", favicon: "", heroPoster: "" });
      assert.ok(exists(other));
    });
  });

  test("uploads are checked and served", async () => {
    const send = (name, content, kind, ext) => {
      const form = new FormData();
      if (kind) form.append("kind", kind);
      if (ext) form.append("ext", ext);
      form.append("file", new Blob([content]), name);
      return api("POST", "/admin/uploads/", { token, form });
    };
    let r = await send("logo.PNG", "png-bytes", "image");
    assert.equal(r.status, 201);
    assert.match(r.data.url, /^\/uploads\/testa\/[a-z0-9]+-[0-9a-f]{12}\.png$/);
    const res = await fetch(`${root.replace(/\/events$/, "")}${r.data.url}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "png-bytes");
    assert.match(res.headers.get("content-security-policy"), /sandbox/);

    assert.equal((await send("clip.mp4", "x", "image")).status, 400);
    assert.equal((await send("run.exe", "x")).status, 400);
    assert.equal((await send("clip.webm", "x", "video")).data.kind, "video");

    // A video field that takes one format refuses the other, whichever the file picker allowed.
    r = await send("clip.webm", "x", "video", ".mp4");
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { detail: "Upload a .mp4 file." });
    r = await send("clip.MP4", "x", "video", ".mp4");
    assert.equal(r.status, 201);
    assert.match(r.data.url, /\.mp4$/);
    assert.equal((await send("clip.mp4", "x", "video", ".webm")).status, 400);
    assert.equal((await send("clip.webm", "x", "video", ".webm")).status, 201);
  });
});

describe("feedback submissions report", () => {
  const report = require("../src/feedbackReport");
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  let sent;

  before(() => {
    // Nothing is emailed, sendMail only records the message.
    sent = [];
    report.setMailer({ sendMail: async (message) => sent.push(message) });
    config.smtpHost = "smtp.test";
  });

  after(() => {
    config.smtpHost = "";
    report.setMailer(null);
    delete EVENT_A.eventEndDate;
    delete EVENT_A.timeZone;
  });

  beforeEach(async () => {
    sent = [];
    await query("UPDATE form_settings SET report_sent_at = NULL, report_sent_count = NULL WHERE id = 1");
  });

  const sendIfDue = () => db.withDatabase(EVENT_A.database, () => report.sendIfDue(EVENT_A));

  test("an admin downloads every submission in one PDF", async () => {
    const token = await login("benny");
    const a = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await createSubmission(a);
    const res = await fetch(`${root}/testa/admin/feedback-report/pdf/`, { headers: { Authorization: `Token ${token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-disposition"), /filename="[^"]+_feedback_submission_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_\(1\)\.pdf"/);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    assert.equal((await fetch(`${root}/testa/admin/feedback-report/pdf/`)).status, 401);
  });

  test("the report file name is event name, feedback_submission, date and time in the event's zone, and the count", () => {
    const at = (iso, timeZone) => ({ date: new Date(iso), timeZone });
    // 2026-11-27 18:30 UTC is 10:30 in Los Angeles in winter, 11:30 in summer (2026-07-01), and 00:00 the next day in Kolkata.
    assert.equal(report.reportFileName({ code: "x", name: "Agri AI Summit 2026" }, 25, at("2026-11-27T18:30:00Z", "America/Los_Angeles")), "Agri_AI_Summit_2026_feedback_submission_2026-11-27_10-30_(25).pdf");
    assert.equal(report.reportFileName({ code: "x", name: "A/B: Café \"Expo\"" }, 0, at("2026-07-01T18:30:00Z", "America/Los_Angeles")), "AB_Cafe_Expo_feedback_submission_2026-07-01_11-30_(0).pdf");
    assert.equal(report.reportFileName({ code: "x", name: "Summit" }, 4, at("2026-11-27T18:30:00Z", "Asia/Kolkata")), "Summit_feedback_submission_2026-11-28_00-00_(4).pdf");
    // No zone known, or a bad one, gives UTC.
    assert.equal(report.reportFileName({ code: "evt1", name: "" }, 3, at("2026-11-27T09:05:00Z", null)), "evt1_feedback_submission_2026-11-27_09-05_(3).pdf");
    assert.equal(report.reportFileName({ code: "evt1", name: "" }, 3, at("2026-11-27T09:05:00Z", "Not/AZone")), "evt1_feedback_submission_2026-11-27_09-05_(3).pdf");
  });

  test("the file name of the download and the email follows the event's time zone", async () => {
    const token = await login("benny");
    const tail = (name) => name.slice(name.indexOf("_feedback_submission_"));
    const stamp = (timeZone) => tail(report.reportFileName({ code: "x", name: "" }, 0, { timeZone }));
    EVENT_A.timeZone = "Pacific/Kiritimati"; // UTC+14, never the same date and hour as UTC
    try {
      const before = stamp("Pacific/Kiritimati");
      const res = await fetch(`${root}/testa/admin/feedback-report/pdf/`, { headers: { Authorization: `Token ${token}` } });
      const after = stamp("Pacific/Kiritimati");
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition"))[1];
      assert.ok([before, after].includes(tail(name)), `${name} is not in the event's zone`);
      assert.notEqual(tail(name), stamp("UTC"));
    } finally {
      delete EVENT_A.timeZone;
    }
  });

  test("the event's logo is drawn in the report header, and a missing or bad logo changes nothing", async () => {
    const fs = require("fs");
    const path = require("path");
    const folder = path.join(config.uploadsDir, "testa");
    fs.mkdirSync(folder, { recursive: true });
    const png = await require("qrcode").toBuffer("logo", { width: 120 });
    fs.writeFileSync(path.join(folder, "logo-test.png"), png);
    fs.writeFileSync(path.join(folder, "logo-test.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const build = async (logo) => {
      const { pdf } = await db.withDatabase(EVENT_A.database, () => report.buildReportPdf({ ...EVENT_A, media: { logo } }));
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      return pdf.toString("latin1").includes("/Subtype /Image");
    };
    try {
      assert.equal(await build("/uploads/testa/logo-test.png"), true);
      assert.equal(await build(""), false);
      assert.equal(await build("/uploads/testa/logo-test.svg"), false); // not a PNG or JPEG
      assert.equal(await build("/uploads/testa/missing.png"), false); // file gone
      assert.equal(await build("/uploads/testb/logo-test.png"), false); // another event's folder
      assert.equal(await build("/uploads/testa/../logo-test.png"), false);
    } finally {
      fs.rmSync(path.join(folder, "logo-test.png"), { force: true });
      fs.rmSync(path.join(folder, "logo-test.svg"), { force: true });
    }
  });

  test("the email and the PDF give the attendee counts and the raffle winners", async () => {
    const registered = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await createAttendee("Not Yet", "noty@example.com", "BP"); // registered, no submission
    await createAttendee("Third Person", "third@example.com", "Esso"); // registered, no submission
    const sub1 = await createSubmission(registered);
    const walk = await query("INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES ('Walk In', 'walk@example.com', 'Acme', 1, UTC_TIMESTAMP(6))");
    const sub2 = await createSubmission(walk.insertId);
    await query("UPDATE feedback_submissions SET is_suspended = 1 WHERE id = ?", [sub2]);
    await query("INSERT INTO lucky_draw_winners (submission_id, attempt_number, drawn_at) VALUES (?, 1, UTC_TIMESTAMP(6))", [sub1]);
    const built = await db.withDatabase(EVENT_A.database, () => report.buildReportPdf({ ...EVENT_A, name: "Summit" }));
    const s = built.summary;
    assert.deepEqual(
      [s.total, s.registered, s.notRegistered, s.submissions, s.active, s.suspended, s.notSubmitted],
      [4, 3, 1, 2, 1, 1, 2]
    );
    assert.equal(s.winners.length, 1);
    assert.deepEqual([s.winners[0].name, s.winners[0].company, s.winners[0].draw], ["Priya Sharma", "Shell", 1]);
    assert.match(s.winners[0].entry, /^\d+$/);
    // The email carries them, as plain text and as HTML.
    const token = await login("benny");
    assert.equal((await api("POST", "/admin/feedback-report/send/", { token })).status, 200);
    const mail = sent[sent.length - 1];
    assert.match(mail.text, /Total attendees\s+4/);
    assert.match(mail.text, /Registered attendees\s+3/);
    assert.match(mail.text, /Not registered attendees\s+1/);
    assert.match(mail.text, /Submissions\s+2/);
    assert.match(mail.text, /Not submitted\s+2/);
    assert.match(mail.text, /Raffle draw winners\n1\. Priya Sharma, Shell, entry \d+, drawn /);
    assert.ok(!mail.text.includes("Attached are all"));
    assert.match(mail.html, /Raffle draw winners/);
    assert.match(mail.html, /<strong>4<\/strong>/);
    // No winner yet.
    await query("DELETE FROM lucky_draw_winners");
    assert.match((await db.withDatabase(EVENT_A.database, () => report.buildReportPdf(EVENT_A))).summary.winners.length === 0 ? "none" : "some", /none/);
    assert.equal((await api("POST", "/admin/feedback-report/send/", { token })).status, 200);
    assert.match(sent[sent.length - 1].text, /No winner has been drawn\./);
  });

  test("the day after the event ends it is emailed once, with the PDF", async () => {
    const a = await createAttendee("James Smith", "james@example.com", "BP");
    await createSubmission(a);
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventEndDate = day(2); // not over yet
    assert.equal(await sendIfDue(), false);
    EVENT_A.eventEndDate = day(-2); // over, within the week
    assert.equal(await sendIfDue(), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, config.feedbackReportTo.join(", "));
    assert.equal(sent[0].attachments[0].contentType, "application/pdf");
    assert.equal(sent[0].attachments[0].content.subarray(0, 5).toString(), "%PDF-");
    assert.match(sent[0].attachments[0].filename, /_feedback_submission_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_\(\d+\)\.pdf$/);
    const [row] = await query("SELECT report_sent_at, report_sent_count FROM form_settings WHERE id = 1");
    assert.ok(row.report_sent_at);
    assert.equal(row.report_sent_count, await count("feedback_submissions"));
    // Sent once only.
    assert.equal(await sendIfDue(), false);
    assert.equal(sent.length, 1);
  });

  test("an event that ended over a week ago is not emailed by itself, Send now sends it", async () => {
    const token = await login("benny");
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventEndDate = day(-10);
    assert.equal(await sendIfDue(), false);
    let status = (await api("GET", "/admin/feedback-report/", { token })).data;
    assert.deepEqual([status.auto, status.sent_at, status.mail_ready], [false, null, true]);
    const r = await api("POST", "/admin/feedback-report/send/", { token });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.ok(r.data.sent_at);
  });

  test("a failed send is let go, so the next check tries again", async () => {
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventEndDate = day(-2);
    report.setMailer({ sendMail: async () => { throw new Error("mail server down"); } });
    assert.equal(await sendIfDue(), false);
    const [row] = await query("SELECT report_sent_at FROM form_settings WHERE id = 1");
    assert.equal(row.report_sent_at, null);
    report.setMailer({ sendMail: async (message) => sent.push(message) });
    assert.equal(await sendIfDue(), true);
  });

  test("without SMTP set up nothing is emailed", async () => {
    config.smtpHost = "";
    try {
      EVENT_A.timeZone = "America/Los_Angeles";
      EVENT_A.eventEndDate = day(-2);
      assert.equal(await sendIfDue(), false);
      const token = await login("benny");
      assert.equal((await api("POST", "/admin/feedback-report/send/", { token })).status, 502);
    } finally {
      config.smtpHost = "smtp.test";
    }
  });
});

describe("feedback form default", () => {
  test("the automatic opening is off by default, the form is open before the first day", async () => {
    const token = await login("benny");
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventStartDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    try {
      const s = (await api("GET", "/admin/settings/", { token })).data;
      assert.deepEqual([s.form_open_auto, s.form_closed, s.feedback_open], [false, false, true]);
      assert.equal((await api("GET", "/attendees/")).status, 200);
    } finally {
      delete EVENT_A.eventStartDate;
      delete EVENT_A.timeZone;
    }
  });
});

describe("feedback form opening", () => {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  // These tests check the automatic opening, so it is turned on for them.
  beforeEach(async () => {
    await query("UPDATE form_settings SET form_open_auto = 1, form_closed = 0 WHERE id = 1");
  });

  after(async () => {
    delete EVENT_A.eventStartDate;
    delete EVENT_A.timeZone;
    await query("UPDATE form_settings SET form_open_auto = 0, form_closed = 0 WHERE id = 1");
  });

  test("before the first day the form is not open, from 12:00 AM there it is", async () => {
    const a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventStartDate = day(3);
    let config = (await api("GET", "/")).data;
    assert.equal(config.feedback_open, false);
    assert.equal(config.time_zone, "America/Los_Angeles");
    // 12:00 AM in Anaheim is 07:00 or 08:00 UTC, by daylight saving.
    assert.match(config.feedback_opens_at, new RegExp(`^${day(3)}T0[78]:00:00.000Z$`));
    const list = await api("GET", "/attendees/");
    assert.deepEqual([list.status, list.data.code, list.data.opens_at], [403, "not_open", config.feedback_opens_at]);
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } });
    assert.deepEqual([r.status, r.data.code], [403, "not_open"]);

    // On the first day, and every day after, it is open.
    EVENT_A.eventStartDate = day(-1);
    config = (await api("GET", "/")).data;
    assert.equal(config.feedback_open, true);
    assert.equal((await api("GET", "/attendees/")).status, 200);
    assert.equal((await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } })).status, 201);
  });

  test("with automatic opening off in the admin the form is open before the first day", async () => {
    const token = await login("benny");
    EVENT_A.timeZone = "America/Los_Angeles";
    EVENT_A.eventStartDate = day(3);
    let s = (await api("GET", "/admin/settings/", { token })).data;
    assert.deepEqual([s.form_open_auto, s.feedback_open], [true, false]);
    assert.equal((await api("PATCH", "/admin/settings/", { token, body: { form_open_auto: "maybe" } })).status, 400);

    s = (await api("PATCH", "/admin/settings/", { token, body: { form_open_auto: false } })).data;
    assert.deepEqual([s.form_open_auto, s.feedback_open, s.feedback_opens_at], [false, true, null]);
    const config = (await api("GET", "/")).data;
    assert.deepEqual([config.feedback_open, config.feedback_opens_at], [true, null]);
    assert.equal((await api("GET", "/attendees/")).status, 200);

    // Back on, the form waits for the first day again.
    s = (await api("PATCH", "/admin/settings/", { token, body: { form_open_auto: true } })).data;
    assert.deepEqual([s.form_open_auto, s.feedback_open], [true, false]);
    assert.equal((await api("GET", "/attendees/")).status, 403);
  });

  test("an admin closes the form and opens it again", async () => {
    const token = await login("benny");
    const a1 = await createAttendee("Closed Tester", "closed@example.com", "Shell");
    delete EVENT_A.eventStartDate; // open by date
    let s = (await api("PATCH", "/admin/settings/", { token, body: { form_closed: true } })).data;
    assert.deepEqual([s.form_closed, s.feedback_open, s.feedback_closed], [true, false, true]);
    let config = (await api("GET", "/")).data;
    assert.deepEqual([config.feedback_open, config.feedback_closed], [false, true]);
    const list = await api("GET", "/attendees/");
    assert.deepEqual([list.status, list.data.code], [403, "closed"]);
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } });
    assert.deepEqual([r.status, r.data.code], [403, "closed"]);
    // Closed wins over the automatic opening switched off.
    await api("PATCH", "/admin/settings/", { token, body: { form_open_auto: false } });
    assert.equal((await api("GET", "/attendees/")).status, 403);

    s = (await api("PATCH", "/admin/settings/", { token, body: { form_closed: false, form_open_auto: true } })).data;
    assert.deepEqual([s.form_closed, s.feedback_open], [false, true]);
    config = (await api("GET", "/")).data;
    assert.deepEqual([config.feedback_open, config.feedback_closed], [true, false]);
    assert.equal((await api("GET", "/attendees/")).status, 200);
  });

  test("with no first day known the form is open", async () => {
    delete EVENT_A.eventStartDate;
    const config = (await api("GET", "/")).data;
    assert.deepEqual([config.feedback_open, config.feedback_opens_at], [true, null]);
  });

  test("12:00 AM of a day is told in the zone where the event is held", () => {
    const { startOfDayIn } = require("../src/timeZones");
    const day9 = new Date(Date.UTC(2026, 10, 9));
    assert.equal(startOfDayIn(day9, "America/Los_Angeles").toISOString(), "2026-11-09T08:00:00.000Z");
    assert.equal(startOfDayIn(day9, "Asia/Kolkata").toISOString(), "2026-11-08T18:30:00.000Z");
  });
});

describe("CRM registered delegates", () => {
  let crmServer;
  let reply;
  let requests;
  let token;

  before(async () => {
    crmServer = http.createServer((req, res) => {
      requests.push({ url: req.url, key: req.headers["x-data-api-key"] });
      const [status, body] = typeof reply === "function" ? reply(req) : reply;
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
    await new Promise((resolve) => crmServer.listen(0, "127.0.0.1", resolve));
    config.crmDataApiUrl = `http://127.0.0.1:${crmServer.address().port}/api/data/registered_delegates/`;
  });

  after(() => {
    crmServer.close();
    config.crmDataApiKey = "";
    delete EVENT_A.event_code;
    delete EVENT_A.eventEndDate;
    delete EVENT_A.timeZone;
    crm.resetSyncState();
  });

  beforeEach(async () => {
    requests = [];
    reply = [200, []];
    EVENT_A.event_code = "AIU - AD";
    config.crmDataApiKey = "test-data-key";
    crm.resetSyncState();
    await query("UPDATE form_settings SET crm_synced_at = NULL, crm_synced_count = NULL");
    token = await login("benny");
  });

  test("sends the event code and key, and copies the delegates", async () => {
    reply = [
      200,
      [
        { full_name: "  Priya   Sharma ", company_name: "Shell", email: "Priya@Example.com" },
        { first_name: "James", last_name: "Smith", company: "BP" },
        { company_name: "No name" },
      ],
    ];
    const r = await api("POST", "/admin/attendees/sync/", { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.result, { fetched: 2, skipped: 1, created: 2, updated: 0, removed: 0, kept: 0 });
    assert.equal(requests[0].url, "/api/data/registered_delegates/?event_code=AIU+-+AD");
    assert.equal(requests[0].key, "test-data-key");
    const rows = await query("SELECT full_name, email, company_name, is_walk_in FROM attendees ORDER BY full_name");
    assert.deepEqual(
      rows.map((a) => [a.full_name, a.email, a.company_name, a.is_walk_in]),
      [
        ["James Smith", null, "BP", 0],
        ["Priya Sharma", "priya@example.com", "Shell", 0],
      ]
    );
    assert.equal((await api("GET", "/admin/attendees/sync/", { token })).data.result.created, 2);
  });

  test("updates, removes and keeps on a later sync", async () => {
    const gone = await createAttendee("Gone Person", "gone@example.com");
    const submitted = await createAttendee("Has Submitted", "sub@example.com");
    await createSubmission(submitted);
    const renamed = await createAttendee("Ana Lopes", "ana@example.com", "Total");
    await query(
      "INSERT INTO attendees (full_name, email, company_name, is_walk_in, created_at) VALUES ('Walk In', 'walk@example.com', 'X', 1, UTC_TIMESTAMP(6))"
    );
    reply = [200, { results: [{ name: "Ana Lopez", company: "TotalEnergies", email: "ANA@example.com" }] }];
    const r = await api("POST", "/admin/attendees/sync/", { token });
    assert.deepEqual(r.data.result, { fetched: 1, skipped: 0, created: 0, updated: 1, removed: 1, kept: 1 });
    assert.equal((await query("SELECT 1 FROM attendees WHERE attendee_id = ?", [gone])).length, 0);
    assert.equal((await query("SELECT 1 FROM attendees WHERE attendee_id = ?", [submitted])).length, 1);
    const [ana] = await query("SELECT full_name, company_name FROM attendees WHERE attendee_id = ?", [renamed]);
    assert.deepEqual([ana.full_name, ana.company_name], ["Ana Lopez", "TotalEnergies"]);
    assert.equal((await query("SELECT COUNT(*) AS n FROM attendees WHERE is_walk_in = 1"))[0].n, 1);

    // An empty list removes nobody.
    reply = [200, []];
    await api("POST", "/admin/attendees/sync/", { token });
    assert.equal((await query("SELECT COUNT(*) AS n FROM attendees"))[0].n, 3);
  });

  test("a CRM error leaves the list as it was", async () => {
    await createAttendee("Priya Sharma", "priya@example.com");
    reply = [401, { detail: "Invalid API key format." }];
    const r = await api("POST", "/admin/attendees/sync/", { token });
    assert.equal(r.status, 502);
    assert.equal(r.data.detail, "The CRM answered 401, Invalid API key format.");
    assert.equal(r.data.error, r.data.detail);
    assert.equal((await query("SELECT COUNT(*) AS n FROM attendees"))[0].n, 1);
    // The public page still answers from the saved list.
    assert.deepEqual((await api("GET", "/registered-attendees/")).data, [{ name: "Priya Sharma", company: "" }]);
  });

  test("the first visitor syncs once, and it is remembered", async () => {
    reply = [200, [{ full_name: "James Smith", company_name: "BP", email: "james@example.com" }]];
    assert.deepEqual((await api("GET", "/registered-attendees/")).data, [{ name: "James Smith", company: "BP" }]);
    assert.deepEqual((await api("GET", "/attendees/")).data.map((a) => a.full_name), ["James Smith"]);
    await api("GET", "/");
    assert.equal(requests.length, 1);
    const status = (await api("GET", "/admin/attendees/sync/", { token })).data;
    assert.equal(status.synced_count, 1);
    assert.ok(Math.abs(new Date(status.synced_at) - Date.now()) < 60000); // read back as UTC

    // A restart forgets the memory, the saved mark still stops a second fetch.
    crm.resetSyncState();
    await api("GET", "/registered-attendees/");
    assert.equal(requests.length, 1);

    // Sync now still fetches it again.
    await api("POST", "/admin/attendees/sync/", { token });
    assert.equal(requests.length, 2);
  });

  test("after the first sync, a visit syncs again every 24 hours until the event's last day", async () => {
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const waitForRequests = async (n) => {
      for (let i = 0; i < 50 && requests.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    };
    EVENT_A.eventEndDate = day(1);
    reply = [200, [{ full_name: "James Smith", company_name: "BP", email: "james@example.com" }]];
    await api("GET", "/registered-attendees/");
    assert.equal(requests.length, 1);

    // Less than 24 hours since the last sync, nothing is fetched.
    crm.resetSyncState();
    await api("GET", "/");
    await waitForRequests(2);
    assert.equal(requests.length, 1);

    // 25 hours later the visit starts the daily sync in the background, and a late registration is added.
    await query("UPDATE form_settings SET crm_synced_at = UTC_TIMESTAMP(6) - INTERVAL 25 HOUR");
    reply = [200, [{ full_name: "James Smith", company_name: "BP", email: "james@example.com" }, { full_name: "Late Comer", company_name: "Acme" }]];
    crm.resetSyncState();
    await api("GET", "/");
    await waitForRequests(2);
    assert.equal(requests.length, 2);
    for (let i = 0; i < 50 && (await query("SELECT COUNT(*) AS n FROM attendees"))[0].n < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual((await api("GET", "/registered-attendees/")).data.map((a) => a.name), ["Late Comer", "James Smith"]);
    const status = (await api("GET", "/admin/attendees/sync/", { token })).data;
    assert.equal(status.refresh_active, true);
    assert.equal(status.refresh_until.slice(0, 10), day(2));

    // Once the last day is over, it stops.
    EVENT_A.eventEndDate = day(-3);
    await query("UPDATE form_settings SET crm_synced_at = UTC_TIMESTAMP(6) - INTERVAL 25 HOUR");
    crm.resetSyncState();
    await api("GET", "/");
    await waitForRequests(3);
    assert.equal(requests.length, 2);
    assert.equal((await api("GET", "/admin/attendees/sync/", { token })).data.refresh_active, false);
  });

  test("the event's last day is read from the agenda's day headings", () => {
    const { dateFromHeading, endDateFromAgenda } = require("../src/eventDates");
    assert.equal(dateFromHeading("MONDAY, NOVEMBER 9, 2026").toISOString(), "2026-11-09T00:00:00.000Z");
    assert.equal(dateFromHeading("<p>Tuesday 10th Nov 2026</p>").toISOString(), "2026-11-10T00:00:00.000Z");
    assert.equal(dateFromHeading("Day one"), null);
    assert.equal(dateFromHeading("February 31, 2026"), null);
    const agenda = [
      { status: "day", heading: "MONDAY, NOVEMBER 9, 2026" },
      { status: "speaker", heading: "December 25, 2026 keynote" },
      { status: "day", heading: "TUESDAY, NOVEMBER 10, 2026" },
    ];
    assert.equal(endDateFromAgenda(agenda).toISOString(), "2026-11-10T00:00:00.000Z");
    assert.equal(endDateFromAgenda([]), null);
  });

  test("the daily sync stops at 11:59 PM of the last day where the event is held", async () => {
    EVENT_A.eventEndDate = "2026-11-25";
    EVENT_A.timeZone = "America/Los_Angeles";
    const status = (await api("GET", "/admin/attendees/sync/", { token })).data;
    assert.equal(status.time_zone, "America/Los_Angeles");
    // 25 November 23:59:59 in Anaheim is 26 November 07:59:59 UTC, India's 25 November ends 13.5 hours earlier.
    assert.equal(status.refresh_until, "2026-11-26T07:59:59.999Z");
    EVENT_A.timeZone = "Asia/Kolkata";
    assert.equal((await api("GET", "/admin/attendees/sync/", { token })).data.refresh_until, "2026-11-25T18:29:59.999Z");
  });

  test("the time zone comes from the event location", () => {
    const { timeZoneForLocation, endOfDayIn } = require("../src/timeZones");
    const { locationFromData } = require("../src/eventDates");
    const location = locationFromData({ eventDetails: [{ option: "event_Location", value: "Anaheim, California, USA" }] });
    assert.equal(location, "Anaheim, California, USA");
    assert.equal(timeZoneForLocation(location), "America/Los_Angeles");
    assert.equal(timeZoneForLocation("Anaheim, CA"), "America/Los_Angeles");
    assert.equal(timeZoneForLocation("Seattle, WA, USA"), "America/Los_Angeles");
    assert.equal(timeZoneForLocation("Perth, WA, Australia"), "Australia/Perth");
    assert.equal(timeZoneForLocation("Frankfurt, Germany"), "Europe/Berlin");
    assert.equal(timeZoneForLocation("Mumbai, India"), "Asia/Kolkata");
    assert.equal(timeZoneForLocation("Somewhere, Nowhere"), null);
    // A clock change on the day itself, 1 November 2026 in Anaheim.
    const end = endOfDayIn(new Date(Date.UTC(2026, 10, 1)), "America/Los_Angeles");
    assert.equal(end.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }), "11/1/2026, 11:59:59 PM");
  });

  test("an empty CRM list is tried again later", async () => {
    await api("GET", "/registered-attendees/");
    await api("GET", "/registered-attendees/"); // within the minute, not tried again
    assert.equal(requests.length, 1);
    assert.equal((await api("GET", "/admin/attendees/sync/", { token })).data.synced_at, null);

    crm.resetSyncState(); // as if the minute had passed
    reply = [200, [{ full_name: "James Smith", company_name: "BP" }]];
    assert.deepEqual((await api("GET", "/registered-attendees/")).data, [{ name: "James Smith", company: "BP" }]);
    assert.equal(requests.length, 2);
  });

  test("the home page config starts the sync without waiting", async () => {
    reply = [200, [{ full_name: "James Smith", company_name: "BP" }]];
    assert.equal((await api("GET", "/")).status, 200);
    // The attendee page waits for the sync the config started, it does not start a second one.
    assert.deepEqual((await api("GET", "/registered-attendees/")).data, [{ name: "James Smith", company: "BP" }]);
    assert.equal(requests.length, 1);
  });

  test("an event without a CRM code or a key does not sync", async () => {
    delete EVENT_A.event_code;
    let r = await api("POST", "/admin/attendees/sync/", { token });
    assert.equal(r.status, 502);
    assert.equal(r.data.enabled, false);
    EVENT_A.event_code = "AIU - AD";
    config.crmDataApiKey = "";
    r = await api("GET", "/admin/attendees/sync/", { token });
    assert.equal(r.data.reason, "CRM_DATA_API_KEY is not set in the backend .env.");
    await api("GET", "/registered-attendees/");
    assert.equal(requests.length, 0);
  });
});

describe("logbook", () => {
  const report = require("../src/feedbackReport");
  let hook;
  let hookStatus = 200;
  let token;
  const logOf = async (query_ = "") => (await api("GET", `/admin/logbook/${query_}`, { token })).data;

  before(async () => {
    hook = http.createServer((req, res) => {
      req.resume();
      res.writeHead(hookStatus, { "Content-Type": "application/json" }).end(JSON.stringify({ received: true }));
    });
    await new Promise((resolve) => hook.listen(0, "127.0.0.1", resolve));
    config.sendFeedbackSubmissionToCrm = true;
    config.crmWebhookUrl = `http://127.0.0.1:${hook.address().port}/webhook/`;
    config.crmApiKey = "secret-crm-key";
    config.smtpHost = "smtp.test";
  });

  after(() => {
    hook.close();
    config.sendFeedbackSubmissionToCrm = false;
    config.crmWebhookUrl = "";
    config.crmApiKey = "";
    config.smtpHost = "";
    report.setMailer(null);
  });

  beforeEach(async () => {
    token = await login("benny");
    hookStatus = 200;
  });

  test("the CRM post is logged with its status and reply, and never with the key", async () => {
    const a = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    await createSubmission(a);
    assert.equal((await api("POST", "/lucky-draw/send-to-crm/")).status, 200);
    hookStatus = 500;
    await api("POST", "/lucky-draw/send-to-crm/");
    const { results } = await logOf("?kind=crm_webhook");
    assert.equal(results.length, 2);
    const [failed, worked] = results; // newest first
    assert.deepEqual([worked.ok, worked.http_status, worked.method, worked.triggered_by], [true, 200, "POST", "lucky draw spin"]);
    assert.match(worked.summary, /^1 feedback response sent$/);
    assert.match(worked.response, /received/);
    assert.ok(worked.target.endsWith("/webhook/"));
    assert.ok(Number.isInteger(worked.duration_ms));
    assert.match(worked.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([failed.ok, failed.http_status], [false, 500]);
    // No key and no attendee answers in the log.
    const text = JSON.stringify(results);
    assert.ok(!text.includes("secret-crm-key"));
    assert.ok(!text.includes("priya@example.com"));
  });

  test("a CRM that cannot be reached is logged with the error", async () => {
    const saved = config.crmWebhookUrl;
    config.crmWebhookUrl = "http://127.0.0.1:1/webhook/";
    try {
      assert.equal((await api("POST", "/lucky-draw/send-to-crm/")).status, 502);
    } finally {
      config.crmWebhookUrl = saved;
    }
    const { results } = await logOf("?kind=crm_webhook&ok=0");
    assert.equal(results.length, 1);
    assert.equal(results[0].http_status, null);
    assert.ok(results[0].error.length > 0);
  });

  test("the report email is logged when sent and when it fails, with who started it", async () => {
    const sent = [];
    report.setMailer({ sendMail: async (message) => (sent.push(message), { messageId: "<id-1@test>", accepted: ["a@b.c"], rejected: [] }) });
    assert.equal((await api("POST", "/admin/feedback-report/send/", { token })).status, 200);
    report.setMailer({ sendMail: async () => { throw new Error("SMTP down"); } });
    assert.equal((await api("POST", "/admin/feedback-report/send/", { token })).status, 502);
    const { results } = await logOf("?kind=email");
    assert.equal(results.length, 2);
    const [failed, worked] = results;
    assert.deepEqual([worked.ok, worked.method, worked.triggered_by], [true, "SMTP", "admin benny"]);
    assert.match(worked.summary, /^Report with \d+ submissions? sent, .+_feedback_submission_.+\.pdf$/);
    assert.match(worked.response, /id-1@test/);
    assert.equal(worked.target, config.feedbackReportTo.join(", "));
    assert.deepEqual([failed.ok, failed.error], [false, "SMTP down"]);
  });

  test("the log is for admins, newest first, and can be filtered and paged", async () => {
    assert.equal((await api("GET", "/admin/logbook/")).status, 401);
    await api("POST", "/lucky-draw/send-to-crm/");
    await api("POST", "/lucky-draw/send-to-crm/");
    await api("POST", "/lucky-draw/send-to-crm/");
    const all = await logOf();
    assert.deepEqual(all.kinds, ["crm_webhook", "crm_sync", "email", "gemini", "event_dates"]);
    assert.ok(all.results.length >= 3);
    assert.deepEqual(all.results.map((r) => r.id), [...all.results.map((r) => r.id)].sort((x, y) => y - x));
    const first = await logOf("?limit=2");
    assert.equal(first.results.length, 2);
    assert.equal(first.has_more, true);
    const second = await logOf(`?limit=2&before=${first.next_before}`);
    assert.ok(second.results.every((r) => r.id < first.next_before));
    assert.equal((await logOf("?kind=gemini")).results.length, 0);
  });

  test("a CRM delegates sync is logged with how many delegates came, not who", async () => {
    const crm = require("../src/crmDelegates");
    const crmServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify([{ full_name: "Hidden Person", email: "hidden@example.com" }, { full_name: "Other" }]));
    });
    await new Promise((resolve) => crmServer.listen(0, "127.0.0.1", resolve));
    const saved = config.crmDataApiUrl;
    config.crmDataApiUrl = `http://127.0.0.1:${crmServer.address().port}/api/data/registered_delegates/`;
    config.crmDataApiKey = "data-key-1";
    EVENT_A.event_code = "AIU - AD";
    crm.resetSyncState();
    try {
      assert.equal((await api("POST", "/admin/attendees/sync/", { token })).status, 200);
    } finally {
      crmServer.close();
      config.crmDataApiUrl = saved;
      config.crmDataApiKey = "";
      delete EVENT_A.event_code;
      crm.resetSyncState();
    }
    const { results } = await logOf("?kind=crm_sync");
    assert.equal(results.length, 1);
    assert.deepEqual([results[0].ok, results[0].http_status, results[0].summary, results[0].triggered_by], [true, 200, "2 delegates received", "admin benny"]);
    assert.ok(!JSON.stringify(results).includes("hidden@example.com"));
    assert.ok(!JSON.stringify(results).includes("data-key-1"));
  });
});

describe("event dates refresh", () => {
  const dates = require("../src/eventDates");
  const crm = require("../src/crmDelegates");
  let site;
  let agenda;
  let agendaStatus = 200;
  let hits = 0;
  let token;

  const day = (heading) => ({ status: "day", heading });

  before(async () => {
    site = http.createServer((req, res) => {
      if (req.url.startsWith("/api/agenda")) {
        hits += 1;
        return res.writeHead(agendaStatus, { "Content-Type": "application/json" }).end(JSON.stringify(agenda));
      }
      if (req.url.startsWith("/api/data/")) return res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
      return res.writeHead(404).end();
    });
    await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  });

  after(() => {
    site.close();
    delete EVENT_A.links;
    delete EVENT_A.timeZone;
    delete EVENT_A.event_code;
    config.crmDataApiKey = "";
    dates.resetEventDates();
    crm.resetSyncState();
  });

  beforeEach(async () => {
    token = await login("benny");
    agendaStatus = 200;
    hits = 0;
    agenda = [day("MONDAY, NOVEMBER 9, 2026"), day("TUESDAY, NOVEMBER 10, 2026")];
    EVENT_A.links = { agendaApi: `http://127.0.0.1:${site.address().port}/api/agenda` };
    EVENT_A.timeZone = "America/Los_Angeles";
    dates.resetEventDates();
    crm.resetSyncState();
  });

  const info = async () => (await api("GET", "/admin/event-dates/", { token })).data;

  test("the admin panel gets the dates, where they came from and the times that follow", async () => {
    assert.equal((await api("GET", "/admin/event-dates/")).status, 401);
    const d = await info();
    assert.deepEqual([d.start, d.end, d.time_zone], ["2026-11-09", "2026-11-10", "America/Los_Angeles"]);
    assert.deepEqual(d.sources, { start: "website", end: "website", time_zone: "setting" });
    assert.equal(d.form_opens_at, "2026-11-09T08:00:00.000Z"); // 12:00 AM in Los Angeles
    assert.equal(d.sync_until, "2026-11-11T07:59:59.999Z"); // 11:59 PM on the last day
    assert.equal(d.report_due_at, "2026-11-11T08:00:00.000Z");
    assert.equal(d.readable, true);
    assert.ok(d.read_at && d.next_read_at && d.error === null);
    // The next read is a day after the last one.
    assert.ok(Math.abs(new Date(d.next_read_at) - new Date(d.read_at) - 24 * 3600 * 1000) < 5000);
  });

  test("the site config carries the event's time zone, which the admin panel shows every time in", async () => {
    const r = await api("GET", "/");
    assert.equal(r.status, 200);
    assert.equal(r.data.event_time_zone, "America/Los_Angeles");
    delete EVENT_A.timeZone;
    dates.resetEventDates();
    assert.equal((await api("GET", "/")).data.event_time_zone, null); // no website, nothing to take it from
  });

  test("the dates are read once a day, and again when refreshed", async () => {
    await info();
    await info();
    assert.equal(hits, 1);
    agenda = [day("MONDAY, NOVEMBER 9, 2026"), day("FRIDAY, NOVEMBER 13, 2026")];
    assert.equal((await info()).end, "2026-11-10"); // still the saved dates
    const r = await api("POST", "/admin/event-dates/refresh/", { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.end, "2026-11-13");
    assert.equal(hits, 2);
    assert.equal((await info()).sync_until, "2026-11-14T07:59:59.999Z");
  });

  test("the delegates sync reads the dates again with them, Sync now included", async () => {
    await info();
    agenda = [day("MONDAY, NOVEMBER 16, 2026"), day("TUESDAY, NOVEMBER 17, 2026")];
    config.crmDataApiUrl = `http://127.0.0.1:${site.address().port}/api/data/registered_delegates/`;
    config.crmDataApiKey = "key";
    EVENT_A.event_code = "AIU - AD";
    assert.equal((await api("POST", "/admin/attendees/sync/", { token })).status, 200);
    assert.deepEqual([(await info()).start, (await info()).end], ["2026-11-16", "2026-11-17"]);
    const { results } = (await api("GET", "/admin/logbook/?kind=event_dates", { token })).data;
    assert.ok(results.some((r) => r.triggered_by === "admin benny" && r.ok && /^Agenda dates 2026-11-16 to 2026-11-17$/.test(r.summary)));
  });

  test("a failed read keeps the dates last read and says why", async () => {
    await info();
    agendaStatus = 500;
    const r = (await api("POST", "/admin/event-dates/refresh/", { token })).data;
    assert.deepEqual([r.start, r.end], ["2026-11-09", "2026-11-10"]);
    assert.match(r.error, /answered 500/);
    const { results } = (await api("GET", "/admin/logbook/?kind=event_dates&ok=0", { token })).data;
    assert.equal(results.length, 1);
    assert.equal(results[0].http_status, 500);
    // The next read works and clears the error.
    agendaStatus = 200;
    assert.equal((await api("POST", "/admin/event-dates/refresh/", { token })).data.error, null);
  });

  test("saving a new website link reads the dates from that site at once", async () => {
    delete EVENT_A.links; // no agendaApi, the agenda is <website>/api/agenda
    dates.resetEventDates();
    assert.equal((await info()).readable, false);
    agenda = [day("MONDAY, NOVEMBER 23, 2026"), day("TUESDAY, NOVEMBER 24, 2026")];
    const r = await api("PATCH", "/admin/event-details/", { token, body: { website: `http://127.0.0.1:${site.address().port}/` } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await info();
    assert.deepEqual([d.start, d.end, d.readable], ["2026-11-23", "2026-11-24", true]);
    assert.ok(hits >= 1);
    await api("PATCH", "/admin/event-details/", { token, body: { website: "" } });
  });

  test("dates set in events.json are shown as settings, and an event without a website has nothing to read", async () => {
    EVENT_A.eventStartDate = "2026-12-01";
    EVENT_A.eventEndDate = "2026-12-02";
    try {
      const d = await info();
      assert.deepEqual([d.start, d.end, d.sources.start, d.sources.end], ["2026-12-01", "2026-12-02", "setting", "setting"]);
    } finally {
      delete EVENT_A.eventStartDate;
      delete EVENT_A.eventEndDate;
    }
    delete EVENT_A.links;
    dates.resetEventDates();
    const none = await info();
    assert.deepEqual([none.start, none.end, none.readable, none.read_at], [null, null, false, null]);
  });
});

describe("logbook table rename", () => {
  test("migrate renames a table made under the earlier name and keeps its rows", async () => {
    const [{ n: before }] = await query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_log'");
    assert.equal(before, 0);
    await query("DROP TABLE logbook");
    await query(`CREATE TABLE outbound_log (
      id bigint NOT NULL AUTO_INCREMENT, created_at datetime(6) NOT NULL, kind varchar(30) NOT NULL, target varchar(500) NOT NULL DEFAULT '',
      method varchar(10) NOT NULL DEFAULT '', ok tinyint(1) NOT NULL DEFAULT 0, http_status int DEFAULT NULL, duration_ms int unsigned DEFAULT NULL,
      summary varchar(500) NOT NULL DEFAULT '', response text, error varchar(1000) NOT NULL DEFAULT '', triggered_by varchar(150) NOT NULL DEFAULT '',
      PRIMARY KEY (id), KEY outbound_log_created_idx (created_at), KEY outbound_log_kind_idx (kind, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await query("INSERT INTO outbound_log (created_at, kind, summary, ok) VALUES (UTC_TIMESTAMP(6), 'email', 'kept row', 1)");
    await migrate(EVENT_A);
    const gone = await query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_log'");
    assert.equal(gone.length, 0);
    assert.deepEqual((await query("SELECT summary FROM logbook")).map((r) => r.summary), ["kept row"]);
    const indexes = (await query("SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logbook'")).map((r) => r.name).sort();
    assert.deepEqual(indexes, ["PRIMARY", "logbook_created_idx", "logbook_kind_idx"]);
    // A second run changes nothing.
    await migrate(EVENT_A);
    assert.equal((await query("SELECT COUNT(*) AS n FROM logbook"))[0].n, 1);
  });
});
