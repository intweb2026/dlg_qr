// Manage admin panel accounts, this replaces the Django admin screen for admin_users.
//
//   npm run admin-user -- --event aiu26 list
//   npm run admin-user -- --event aiu26 set <username> --password <new password> [--name "Full Name"] [--role admin|support]
//   npm run admin-user -- --event aiu26 disable <username>
//   npm run admin-user -- --event aiu26 enable <username>
//
// "set" creates the account when it does not exist. Disabling an account also signs it out everywhere.
const { query } = require("../src/db");
const { makePassword } = require("../src/passwords");
const roles = require("../src/roles");
const { inEvent, parseArgs, run } = require("./cli");

async function findUser(username) {
  const [user] = await query("SELECT * FROM admin_users WHERE username = ?", [username]);
  return user || null;
}

async function list() {
  const users = await query("SELECT username, full_name, role, is_active, last_login FROM admin_users ORDER BY username");
  console.table(users.map((u) => ({ ...u, is_active: Boolean(u.is_active) })));
}

async function set(username, args) {
  const user = await findUser(username);
  const password = typeof args.password === "string" ? args.password : null;
  const name = typeof args.name === "string" ? args.name.trim() : null;
  const role = typeof args.role === "string" ? args.role.trim() : null;
  if (role !== null && !roles.ROLES.includes(role)) throw new Error(`The role must be one of ${roles.ROLES.join(", ")}.`);
  if (!user) {
    if (!password) throw new Error("Set a password for the new account with --password.");
    await query(
      "INSERT INTO admin_users (username, password, full_name, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(6))",
      [username, await makePassword(password), name || "", role || roles.ADMIN]
    );
    console.log(`Created admin user ${username}.`);
    return;
  }
  if (!password && name === null && role === null) throw new Error("Nothing to change, pass --password, --name and/or --role.");
  if (role !== null) {
    // A new role signs the account out everywhere so it takes effect at once.
    await query("UPDATE admin_users SET role = ? WHERE id = ?", [role, user.id]);
    await query("DELETE FROM admin_tokens WHERE user_id = ?", [user.id]);
  }
  if (password) await query("UPDATE admin_users SET password = ? WHERE id = ?", [await makePassword(password), user.id]);
  if (name !== null) await query("UPDATE admin_users SET full_name = ? WHERE id = ?", [name, user.id]);
  console.log(`Updated admin user ${user.username}.`);
}

async function setActive(username, active) {
  const user = await findUser(username);
  if (!user) throw new Error(`No admin user called ${username}.`);
  await query("UPDATE admin_users SET is_active = ? WHERE id = ?", [active ? 1 : 0, user.id]);
  if (!active) await query("DELETE FROM admin_tokens WHERE user_id = ?", [user.id]);
  console.log(`${active ? "Enabled" : "Disabled"} admin user ${user.username}.`);
}

run(() => inEvent(parseArgs(), async () => {
  const args = parseArgs();
  const [command, username] = args._;
  if (command === "list") return list();
  if (!username || !["set", "disable", "enable"].includes(command)) {
    throw new Error("Usage: npm run admin-user -- --event <code> list | set <username> --password <pw> [--name <name>] [--role admin|support] | disable <username> | enable <username>");
  }
  if (command === "set") return set(username, args);
  return setActive(username, command === "enable");
}));
