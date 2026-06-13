import { log } from "../lib/logger.js";

export function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.path });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  log.error("Unhandled:", err.message, err.stack);
  res.status(err.status || 500).json({ error: err.message || "Internal error" });
}
