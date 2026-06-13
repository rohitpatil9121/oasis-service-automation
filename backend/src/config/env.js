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
  twilioSid: process.env.TWILIO_ACCOUNT_SID,
  twilioToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",

  managerWhatsapp: process.env.MANAGER_WHATSAPP || "",
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || "+91",

  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
};

// Helpful boot-time warnings (non-fatal so the app still runs in mock mode).
export function checkEnv(log) {
  if (!env.supabaseUrl || !env.supabaseServiceKey)
    log.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - DB calls will fail.");
  if (!env.whatsappMock && (!env.twilioSid || !env.twilioToken))
    log.warn("WHATSAPP_MOCK=false but Twilio creds missing - messages will fail.");
  if (env.jwtSecret === "dev-insecure-secret-change-me")
    log.warn("JWT_SECRET is using the insecure default - set it in .env.");
}
