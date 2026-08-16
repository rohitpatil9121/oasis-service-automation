import { createApp } from "./app.js";
import { env, checkEnv } from "./config/env.js";
import { log } from "./lib/logger.js";
import { sendDueRatingRequests } from "./services/tickets.js";
import { sendDuePayMessages } from "./services/techJobs.js";

checkEnv(log);
const app = createApp();

// Rating requests are queued with a delay when a job closes; this drains the ones
// that have come due. State lives in the DB, so a restart resumes rather than
// dropping pending asks — a sleeping server just sends them a little late.
const RATING_POLL_MS = 60 * 1000;
setInterval(() => {
  sendDueRatingRequests().catch((e) => log.error("rating poll:", e.message));
  // The "please pay" message waits for the technician to stop editing the bill;
  // this is what delivers it. Same tick, same reasoning — see sendDuePayMessages.
  sendDuePayMessages().catch((e) => log.error("pay message poll:", e.message));
}, RATING_POLL_MS).unref?.();

// Render's free tier spins the instance down after ~15 min without inbound
// HTTP; the next WhatsApp message then waits out a multi-minute cold start
// ("bot replies 2-3 minutes late"). Hitting our own PUBLIC url goes through
// Render's load balancer, counts as traffic, and keeps the instance warm.
// Only in production (https base URL); disable with KEEPALIVE_MS=0.
const KEEPALIVE_MS = parseInt(process.env.KEEPALIVE_MS || String(10 * 60 * 1000), 10);
if (KEEPALIVE_MS > 0 && /^https:/i.test(env.publicBaseUrl)) {
  setInterval(() => {
    fetch(`${env.publicBaseUrl.replace(/\/+$/, "")}/health`).catch(() => {});
  }, KEEPALIVE_MS).unref?.();
}

app.listen(env.port, () => {
  log.info(`Oasis Globe backend on :${env.port} (provider: ${env.whatsappProvider}, mock: ${env.whatsappMock})`);
  log.info(`Webhook URL: ${env.publicBaseUrl}/webhook/whatsapp`);
});
