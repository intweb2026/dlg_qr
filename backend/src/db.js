const mysql = require("mysql2/promise");

const config = require("./config");

const pool = mysql.createPool({
  ...config.db,
  charset: "utf8mb4",
  // Datetimes are stored in UTC, as Django did. They are read back as strings and formatted by utils.isoDate.
  timezone: "Z",
  dateStrings: true,
  connectionLimit: 10,
});

// Same strict mode as the Django settings, so values that do not fit fail instead of being cut short.
pool.on("connection", (conn) => conn.query("SET sql_mode='STRICT_TRANS_TABLES'"));

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Runs fn(q) inside a transaction, q has the same shape as query(). Rolled back if fn throws. */
async function transaction(fn) {
  const conn = await pool.getConnection();
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

module.exports = { pool, query, transaction };
