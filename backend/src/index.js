import { createApp } from "./app.js";
import { env, checkEnv } from "./config/env.js";
import { log } from "./lib/logger.js";
import { sendDueRatingRequests } from "./services/tickets.js";

checkEnv(log);
const app = createApp();

// Rating requests are queued with a delay when a job closes; this drains the ones
// that have come due. State lives in the DB, so a restart resumes rather than
// dropping pending asks — a sleeping server just sends them a little late.
const RATING_POLL_MS = 60 * 1000;
setInterval(() => {
  sendDueRatingRequests().catch((e) => log.error("rating poll:", e.message));
}, RATING_POLL_MS).unref?.();

app.listen(env.port, () => {
  log.info(`Oasis Globe backend on :${env.port} (provider: ${env.whatsappProvider}, mock: ${env.whatsappMock})`);
  log.info(`Webhook URL: ${env.publicBaseUrl}/webhook/whatsapp`);
});
