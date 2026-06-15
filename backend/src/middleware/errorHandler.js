import { log } from "../lib/logger.js";

export function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.path });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  // Full context server-side only.
  log.error("Unhandled:", status, req.method, req.path, "-", err.message, err.stack);
  // Intentional client errors (4xx) carry a safe, user-facing message. For 5xx
  // return a generic message so we never leak internals (DB schema, stack, etc.).
  const message = status < 500 ? err.message : "Something went wrong. Please try again.";
  res.status(status).json({ error: message });
}
