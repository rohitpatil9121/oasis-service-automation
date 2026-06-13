// Minimal in-process job queue with the same shape you'd get from BullMQ /
// SQS, so Phase 2 can swap the implementation without touching callers.
// Jobs are processed asynchronously by registered handlers.
import { log } from "../lib/logger.js";

const handlers = new Map();
const buffer = [];
let draining = false;

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

export function enqueue(type, payload) {
  buffer.push({ type, payload, enqueuedAt: Date.now() });
  setImmediate(drain);
}

async function drain() {
  if (draining) return;
  draining = true;
  while (buffer.length) {
    const job = buffer.shift();
    const fn = handlers.get(job.type);
    if (!fn) { log.warn("No handler for job type", job.type); continue; }
    try {
      await fn(job.payload);
    } catch (e) {
      log.error(`Job ${job.type} failed:`, e.message);
      // Best-effort: outbox row stays PENDING and the worker retries it.
    }
  }
  draining = false;
}
