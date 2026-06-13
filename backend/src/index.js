import { createApp } from "./app.js";
import { env, checkEnv } from "./config/env.js";
import { log } from "./lib/logger.js";

checkEnv(log);
const app = createApp();

app.listen(env.port, () => {
  log.info(`Oasis Globe backend on :${env.port} (mock WhatsApp: ${env.whatsappMock})`);
  log.info(`Webhook URL for Twilio: ${env.publicBaseUrl}/webhook/whatsapp`);
});
