import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import apiRoutes from "./routes/index.js";
import webhookRoutes from "./routes/webhook.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

// Strict on auth (brute-force), generous on the polling dashboard API, moderate
// on the public webhook (LLM cost-abuse). standardHeaders -> 429 + Retry-After.
/* Brute-force protection for the endpoints that accept a credential. Kept tight
   on purpose: 20 attempts per IP per 15 minutes is generous for a real person
   and useless to someone guessing passwords or OTPs.

   It deliberately does NOT cover GET /api/auth/me, which only reads back the
   session the caller already holds a valid token for. That was inside the same
   bucket, and every app boot calls it — so a handful of technicians restarting
   their apps on one office wifi (they share an IP behind NAT) could exhaust the
   login budget between them and get 429s on a request that authenticates fine. */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

export function createApp() {
  const app = express();

  app.disable("x-powered-by");          // don't leak the framework
  app.set("trust proxy", 1);            // behind Render/Vercel proxy -> real client IP for rate limiting
  app.use(helmet({ frameguard: { action: "deny" } })); // CSP, HSTS, X-Frame-Options: DENY, nosniff, etc.
  app.use(cors({ origin: env.corsOrigin.split(",").map((s) => s.trim()) }));
  // Keep the raw JSON bytes so the Meta webhook can verify X-Hub-Signature-256
  // (the HMAC must be computed over exactly what Meta sent).
  // 6mb so technician-captured job photos (base64 data URLs) fit; webhooks are tiny.
  app.use(express.json({ limit: "6mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true, limit: "200kb" })); // Twilio webhooks

  app.get("/health", (req, res) =>
    res.json({ ok: true, service: "oasis-globe", mock: env.whatsappMock }));

  app.use(["/api/auth/login", "/api/auth/otp"], authLimiter);
  app.use("/api", apiLimiter);
  app.use("/webhook", webhookLimiter);

  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
