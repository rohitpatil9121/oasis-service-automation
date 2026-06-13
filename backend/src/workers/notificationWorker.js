// Standalone worker: drains the notifications outbox (PENDING/FAILED rows).
// Run alongside the API: `npm run worker`. The API also dispatches inline via
// the in-process queue, so this worker is a safety net / retry loop.
import { retryPending } from "../services/notifications.js";
import { log } from "../lib/logger.js";

const INTERVAL = parseInt(process.env.WORKER_INTERVAL_MS || "10000", 10);

async function tick() {
  try {
    const n = await retryPending(25);
    if (n) log.info(`worker processed ${n} notification(s)`);
  } catch (e) {
    log.error("worker tick error:", e.message);
  }
}

log.info(`Notification worker started (every ${INTERVAL}ms)`);
tick();
setInterval(tick, INTERVAL);
