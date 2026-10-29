// API tests, run with: npm test
// They use the test events in test/events, each with its own database, created and dropped here.
// The test databases use the login of the first entry in databases.json, written to a temporary logins file.
// Most tests run against testa, the isolation tests also use testb.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, describe, test } = require("node:test");

process.env.EVENTS_DIR = path.join(__dirname, "events");
const testLogin = Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "databases.json"), "utf8")))[0];
const LOGINS_FILE = path.join(os.tmpdir(), `feedback-test-databases-${process.pid}.json`);
fs.writeFileSync(
  LOGINS_FILE,
  JSON.stringify({ feedback_testa_test: testLogin, feedback_testb_test: testLogin, feedback_off_test: testLogin })
);
process.env.DATABASES_FILE = LOGINS_FILE;

const { createApp } = require("../src/app");
const db = require("../src/db");
const { allEvents } = require("../src/events");
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
});

beforeEach(async () => {
  for (const q of [query, queryB]) {
    for (const table of ["lucky_draw_winners", "feedback_submissions", "attendees", "admin_tokens"]) {
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
  return (await api("POST", "/auth/login/", { body: { username, password: `${username}123` }, event })).data.token;
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

  test("attendee list is closed with the form", async () => {
    await query("UPDATE form_settings SET form_status = 'inactive'");
    assert.equal((await api("GET", "/attendees/")).status, 403);
  });

  test("submit and duplicate", async () => {
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { overall: 5 } } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("set-cookie"), null);
    const r2 = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { overall: 4 } } });
    assert.equal(r2.status, 400);
    assert.equal(r2.data.code, "already_submitted");
  });

  test("device check is left to the form", async () => {
    // Clearing the form site's cookies must open the form again, so the API keeps no device flag of its own.
    await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } });
    assert.ok(!("submission_status" in (await api("GET", "/form-status/")).data));
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a2, feedback_data: { x: 1 } } });
    assert.equal(r.status, 201);
  });

  test("submit with new attendee", async () => {
    const r = await api("POST", "/feedback/submit/", {
      body: { new_attendee: { full_name: "  Ana   Lopez ", company_name: "Total" }, feedback_data: { x: 1 } },
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
    const body = { new_attendee: { full_name: "priya  SHÁRMA", company_name: " shell " }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).data.code, "attendee_exists");
    await createSubmission(a1);
    assert.equal((await api("POST", "/feedback/submit/", { body })).data.code, "already_submitted");
    assert.equal(await count("attendees"), 2);
  });

  test("same name from another company is added", async () => {
    await createSubmission(a1);
    const body = { new_attendee: { full_name: "Priya Sharma", company_name: "BP" }, feedback_data: { x: 1 } };
    assert.equal((await api("POST", "/feedback/submit/", { body })).status, 201);
    assert.equal(await count("attendees", "full_name = 'Priya Sharma'"), 2);
  });

  test("new attendee email is optional and unique", async () => {
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
      const newAttendee = { full_name: "Ana Lopez" };
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

  test("inactive form", async () => {
    await query("UPDATE form_settings SET form_status = 'inactive'");
    const r = await api("POST", "/feedback/submit/", { body: { attendee_id: a1, feedback_data: { x: 1 } } });
    assert.equal(r.status, 403);
  });
});

describe("admin auth", () => {
  test("default admins exist and can sign in", async () => {
    for (const username of ["benny", "maxwell", "nolan", "ramon"]) {
      const r = await api("POST", "/auth/login/", { body: { username, password: `${username}123` } });
      assert.equal(r.status, 200, username);
      assert.equal(
        await count("admin_tokens t JOIN admin_users u ON u.id = t.user_id", "t.`key` = ? AND u.username = ?", [r.data.token, username]),
        1
      );
    }
  });

  test("username is matched without case", async () => {
    assert.equal((await api("POST", "/auth/login/", { body: { username: " Benny ", password: "benny123" } })).status, 200);
  });

  test("passwords are hashed in the Django format", async () => {
    const [user] = await query("SELECT password FROM admin_users WHERE username = 'benny'");
    assert.notEqual(user.password, "benny123");
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

  test("wrong password and unknown user", async () => {
    let r = await api("POST", "/auth/login/", { body: { username: "benny", password: "nope" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.detail, "Incorrect username or password.");
    r = await api("POST", "/auth/login/", { body: { username: "ghost", password: "ghost123" } });
    assert.equal(r.status, 400);
  });

  test("inactive admin is rejected", async () => {
    await query("UPDATE admin_users SET is_active = 0 WHERE username = 'nolan'");
    assert.equal((await api("POST", "/auth/login/", { body: { username: "nolan", password: "nolan123" } })).status, 400);
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
    const r = await api("PUT", "/form-status/");
    assert.equal(r.status, 405);
    assert.equal(r.data.detail, 'Method "PUT" not allowed.');
    assert.equal((await api("GET", "/nope/")).status, 404);
  });
});

describe("admin panel", () => {
  let token;
  beforeEach(async () => {
    token = await login("benny");
  });

  test("settings validation", async () => {
    let r = await api("PATCH", "/admin/settings/", { token, body: { form_status: "paused", max_spin_attempts: -1 } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, {
      form_status: ['"paused" is not a valid choice.'],
      max_spin_attempts: ["Ensure this value is greater than or equal to 0."],
    });
    r = await api("PATCH", "/admin/settings/", { token, body: { form_status: "inactive", max_spin_attempts: "3" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.form_status, "inactive");
    assert.equal(r.data.max_spin_attempts, 3);
    assert.match(r.data.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z$/);
    assert.equal((await api("GET", "/form-status/")).data.is_active, false);
  });

  test("submissions list, filters and suspend", async () => {
    const a1 = await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    const a2 = await createAttendee("James Smith", "james@example.com", "BP");
    const s1 = await createSubmission(a1);
    await createSubmission(a2, { suspended: true });
    let r = await api("GET", "/admin/submissions/", { token });
    assert.deepEqual(r.data.stats, { total: 2, active: 1, suspended: 1 });
    assert.equal(r.data.pad_length, 2);
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

  test("CSV import", async () => {
    await createAttendee("Priya Sharma", "priya@example.com", "Shell");
    const csv = "\ufeffName,Company,Email\nJames Smith,BP,james@example.com\n,,\nPriya Again,Shell,PRIYA@example.com\nAna Lopez,Total,\n";
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "attendees.csv");
    const r = await api("POST", "/admin/attendees/import/", { token, form });
    assert.deepEqual(r.data, { created: 2, skipped: 2, errors: [] });
    const [ana] = await query("SELECT email, company_name FROM attendees WHERE full_name = 'Ana Lopez'");
    assert.deepEqual([ana.email, ana.company_name], [null, "Total"]);

    const bad = new FormData();
    bad.append("file", new Blob(["email\nx@example.com\n"]), "a.csv");
    assert.equal((await api("POST", "/admin/attendees/import/", { token, form: bad })).status, 400);
    assert.equal((await api("POST", "/admin/attendees/import/", { token, form: new FormData() })).data.detail, "Choose a CSV file to import.");
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
    // clearing the history puts winners back in the pool
    await api("DELETE", "/lucky-draw/winners/");
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
    assert.equal((await api("DELETE", "/lucky-draw/winners/")).status, 204);
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
  });

  test("codes are matched without case", async () => {
    assert.equal((await api("GET", "/form-status/", { event: "TESTA" })).status, 200);
  });

  test("unknown and switched off events are not found", async () => {
    for (const event of ["nope", "off"]) {
      const r = await api("GET", "/form-status/", { event });
      assert.equal(r.status, 404, event);
      assert.equal(r.data.detail, "Event not found.");
    }
    const r = await fetch(`${root.replace(/\/events$/, "")}/form-status/`);
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
    // Still shown while the feedback form is closed.
    await query("UPDATE form_settings SET form_status = 'inactive'");
    const r = await api("GET", "/registered-attendees/");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, [{ name: "Priya Sharma", company: "Shell" }]);
    assert.deepEqual((await api("GET", "/registered-attendees/", { event: "testb" })).data, [{ name: "James Smith", company: "BP" }]);
  });

  test("settings belong to one event", async () => {
    const token = await login("benny");
    await api("PATCH", "/admin/settings/", { token, body: { form_status: "inactive" } });
    assert.equal((await api("GET", "/form-status/")).data.is_active, false);
    assert.equal((await api("GET", "/form-status/", { event: "testb" })).data.is_active, true);
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
