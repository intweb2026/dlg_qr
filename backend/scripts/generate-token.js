// Prints a new random token for EXPORT_ACCESS_TOKEN, 64 characters. Run it when you want to set or rotate the token,
// then copy the value into the environment and redeploy. Nothing is saved or sent anywhere, and it needs no database.
// Usage: npm run token
const crypto = require("crypto");

console.log(crypto.randomBytes(32).toString("hex"));
