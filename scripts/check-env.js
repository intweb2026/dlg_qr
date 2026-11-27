// Stops `npm run build` when the API address is missing, so a site is never built that calls the wrong server.
// REACT_APP_API_URL comes from the deployment's environment, or from .env.production.local when building by hand.
const fs = require("fs");

const fromFiles = [".env.production.local", ".env.production", ".env.local", ".env"].some((f) => {
  try {
    return /^REACT_APP_API_URL=S+/m.test(fs.readFileSync(f, "utf8"));
  } catch {
    return false;
  }
});

if (!process.env.REACT_APP_API_URL && !fromFiles) {
  console.error("REACT_APP_API_URL is not set. Set it to the API address, for example https://api.your-domain.com/api, then build again.");
  process.exit(1);
}
