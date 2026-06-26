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

  // AI intake (Groq). When AI_INTAKE=true the WhatsApp agent uses the LLM
  // for natural conversation instead of the deterministic state machine.
  aiIntake: bool(process.env.AI_INTAKE, false),
  // Tool-calling agent (Groq function calling). When AGENT_TOOLS=true the
  // WhatsApp intake runs the tool-calling agent (services/agent/) instead of the
  // single-prompt AI intake. Takes precedence over AI_INTAKE.
  agentTools: bool(process.env.AGENT_TOOLS, false),
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",

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
  if (env.aiIntake && !env.groqApiKey)
    log.warn("AI_INTAKE=true but GROQ_API_KEY missing - get a free key at console.groq.com.");
  if (env.jwtSecret === "dev-insecure-secret-change-me")
    log.warn("JWT_SECRET is using the insecure default - set it in .env.");
}
