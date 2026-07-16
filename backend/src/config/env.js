import dotenv from "dotenv";
dotenv.config();

const bool = (v, d = false) =>
  v === undefined ? d : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

export const env = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",

  jwtSecret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  otpTtlSeconds: parseInt(process.env.OTP_TTL_SECONDS || "300", 10),

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,

  whatsappMock: bool(process.env.WHATSAPP_MOCK, true),

  // Which provider sends/receives WhatsApp: "twilio" or "meta".
  whatsappProvider: (process.env.WHATSAPP_PROVIDER || "twilio").toLowerCase(),

  twilioSid: process.env.TWILIO_ACCOUNT_SID,
  twilioToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",

  // Meta WhatsApp Cloud API (developers.facebook.com > your app > WhatsApp)
  metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID,
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaVerifyToken: process.env.META_VERIFY_TOKEN || "oasis_verify_token",
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v21.0",
  // App secret (Meta app → Settings → Basic) — used to verify the X-Hub-Signature-256
  // on inbound webhooks so forged requests are rejected.
  metaAppSecret: process.env.META_APP_SECRET,

  // WhatsApp intake runs the Groq tool-calling agent (services/agent/). It needs
  // a GROQ_API_KEY to work — see checkEnv below.
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",

  // Fallback LLM (OpenRouter). Groq's free tier is tight (8K tokens/minute) and a
  // single intake message costs more than that across its tool steps, so a 429 is
  // routine. OpenRouter speaks the same OpenAI-compatible API, so the identical
  // messages/tools payload works — we just swap the model. Default is the same
  // GPT-OSS family as groqModel, so tool-calling behaves the same.
  // Leave OPENROUTER_API_KEY unset to disable the fallback.
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-oss-20b:free",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",

  // FAQ / company-info flow (Flow 3). OFF for now — the agent deflects general
  // questions ("team will confirm") instead of quoting areas/timings/AMC/pricing
  // that aren't verified yet. Set FAQ_ENABLED=true to turn it back on.
  faqEnabled: bool(process.env.FAQ_ENABLED, false),

  managerWhatsapp: process.env.MANAGER_WHATSAPP || "",
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || "+91",

  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
};

// Helpful boot-time warnings (non-fatal so the app still runs in mock mode).
export function checkEnv(log) {
  if (!env.supabaseUrl || !env.supabaseServiceKey)
    log.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - DB calls will fail.");
  if (!env.whatsappMock && env.whatsappProvider === "twilio" && (!env.twilioSid || !env.twilioToken))
    log.warn("WHATSAPP_MOCK=false but Twilio creds missing - messages will fail.");
  if (!env.whatsappMock && env.whatsappProvider === "meta" && (!env.metaAccessToken || !env.metaPhoneNumberId))
    log.warn("WHATSAPP_PROVIDER=meta but META_ACCESS_TOKEN / META_PHONE_NUMBER_ID missing - messages will fail.");
  if (!env.groqApiKey)
    log.warn("GROQ_API_KEY missing - the WhatsApp agent needs it; get a free key at console.groq.com.");
  if (env.jwtSecret === "dev-insecure-secret-change-me")
    log.warn("JWT_SECRET is using the insecure default - set it in .env.");
}
