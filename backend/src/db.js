const fs = require("fs");
const { AsyncLocalStorage } = require("async_hooks");
const mysql = require("mysql2/promise");

const config = require("./config");

// Every event has its own MySQL database, and every database has its own login in databases.json,
// { "feedback_db": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "..." } }.
// A request, script or test picks a database with withDatabase(), and query() and transaction()
// then run against it without it being passed around.
const current = new AsyncLocalStorage();
const pools = new Map();
let logins = null;

function readLogins() {
  if (!logins) {
    try {
      logins = JSON.parse(fs.readFileSync(config.databasesFile, "utf8"));
    } catch (err) {
      throw new Error(`Cannot read the database logins in ${config.databasesFile}, ${err.message}`);
    }
  }
  return logins;
}

/** Host, port, user and password for a database name, from databases.json. */
function loginFor(database) {
  const login = readLogins()[database];
  if (!login) throw new Error(`No login for database ${database} in ${config.databasesFile}`);
  const { host = "127.0.0.1", port = 3306, user, password = "" } = login;
  if (!user) throw new Error(`The login for database ${database} in ${config.databasesFile} has no user`);
  return { host, port: Number(port), user, password };
}

/** True when databases.json has a login for this database. */
function hasLogin(database) {
  return Boolean(readLogins()[database]);
}

function poolFor(database) {
  if (!pools.has(database)) {
    const pool = mysql.createPool({
      ...loginFor(database),
      database,
      charset: "utf8mb4",
      // Datetimes are stored in UTC, as Django did. They are read back as strings and formatted by utils.isoDate.
      timezone: "Z",
      dateStrings: true,
      connectionLimit: 10,
    });
    // Same strict mode as the Django settings, so values that do not fit fail instead of being cut short.
    pool.on("connection", (conn) => conn.query("SET sql_mode='STRICT_TRANS_TABLES'"));
    pools.set(database, pool);
  }
  return pools.get(database);
}

/** Runs fn with database as the target of query() and transaction(), including everything fn awaits. */
function withDatabase(database, fn) {
  return current.run({ database }, fn);
}

function currentPool() {
  const store = current.getStore();
  if (!store) throw new Error("No event database selected, call this inside withDatabase().");
  return poolFor(store.database);
}

async function query(sql, params = []) {
  const [rows] = await currentPool().query(sql, params);
  return rows;
}

/** Runs fn(q) inside a transaction, q has the same shape as query(). Rolled back if fn throws. */
async function transaction(fn) {
  const conn = await currentPool().getConnection();
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];
  try {
    await conn.beginTransaction();
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Connects with the login of database but without selecting it, for creating and dropping that database. */
function serverConnection(database) {
  return mysql.createConnection({ ...loginFor(database), charset: "utf8mb4" });
}

async function closeAll() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((p) => p.end()));
}

module.exports = { withDatabase, query, transaction, serverConnection, hasLogin, loginFor, closeAll };
