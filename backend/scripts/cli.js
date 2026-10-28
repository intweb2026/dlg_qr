// Small helpers shared by the command line scripts.
const { pool } = require("../src/db");

/** "--count 20 --name Ana" -> {count: "20", name: "Ana"}, a bare "--flag" -> {flag: true}, the rest -> _ */
function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) {
      args._.push(argv[i]);
      continue;
    }
    const [key, inline] = argv[i].slice(2).split("=", 2);
    if (inline !== undefined) args[key] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}

function intArg(args, name, fallback) {
  if (args[name] === undefined) return fallback;
  const n = Number(args[name]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number.`);
  return n;
}

function choice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function weightedChoice(list, weights) {
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return list[i];
  }
  return list[list.length - 1];
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Runs main, prints a failure without a stack trace, then closes the database pool. */
function run(main) {
  main()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { parseArgs, intArg, choice, weightedChoice, shuffle, run };
