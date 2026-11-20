const cors = require("cors");
const express = require("express");

const { authenticate } = require("./auth");
const config = require("./config");
const { withDatabase } = require("./db");
const { withEventDetails } = require("./eventDetails");
const { getEvent } = require("./events");
const routes = require("./routes");
const { ValidationError } = require("./validation");

/**
 * Finds the event from the code in the address, and runs the rest of the request against its database.
 * req.event has the name, media, links and Wi-Fi saved on the admin Event Details page in place of events.json's.
 */
function resolveEvent(req, res, next) {
  const event = getEvent(req.params.eventCode);
  if (!event) return res.status(404).json({ detail: "Event not found." });
  return withDatabase(event.database, async () => {
    try {
      req.event = await withEventDetails(event);
    } catch (err) {
      return next(err);
    }
    return next();
  });
}

/** Files uploaded on the Event Details page. SVGs could hold scripts, so nothing on these responses may run. */
function serveUploads() {
  return express.static(config.uploadsDir, {
    index: false,
    dotfiles: "ignore",
    fallthrough: true,
    maxAge: "7d",
    setHeaders(res) {
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });
}

/** Rejects requests whose Host header is not in ALLOWED_HOSTS, as Django did. "*" allows any host. */
function hostMatches(host, pattern) {
  pattern = pattern.toLowerCase();
  if (pattern === "*") return true;
  if (pattern.startsWith(".")) return host === pattern.slice(1) || host.endsWith(pattern);
  return host === pattern;
}

function allowedHosts(req, res, next) {
  const patterns = config.allowedHosts.length || !config.debug ? config.allowedHosts : [".localhost", "127.0.0.1", "[::1]"];
  const host = (req.hostname || "").toLowerCase();
  if (patterns.some((p) => hostMatches(host, p))) return next();
  return res.status(400).json({ detail: "Bad Request (400)" });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ValidationError) return res.status(400).json(err.errors);
  if (err.type === "entity.parse.failed") return res.status(400).json({ detail: `JSON parse error - ${err.message}` });
  if (err.type === "entity.too.large") return res.status(413).json({ detail: "The request is too large." });
  if (err.name === "MulterError") return res.status(400).json({ detail: err.message });
  console.error(err);
  return res.status(500).json({ detail: config.debug ? String(err.stack || err) : "Server error, try again." });
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(allowedHosts);
  app.use(cors({ origin: config.corsAllowedOrigins, credentials: true }));
  app.use(express.json({ limit: "2.5mb" }));
  app.use("/api/uploads", serveUploads());
  app.use("/api/events/:eventCode", resolveEvent, authenticate, routes);
  app.use((req, res) => res.status(404).json({ detail: "Not found." }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
