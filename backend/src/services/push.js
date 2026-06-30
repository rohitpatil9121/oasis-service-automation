// Firebase Cloud Messaging push to the technician app. Initialised lazily from
// a service-account JSON in FIREBASE_SERVICE_ACCOUNT (stringified). If that env
// var is absent or invalid, push becomes a no-op so the rest of the app keeps
// working — exactly like WHATSAPP_MOCK keeps messaging working without creds.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { log } from "../lib/logger.js";

let app = null;
let tried = false;

function getApp() {
  if (app || tried) return app;
  tried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { log.warn("FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled."); return null; }
  try {
    const creds = JSON.parse(raw);
    app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(creds) });
    log.info("Firebase push initialised.");
    return app;
  } catch (e) {
    log.error("FIREBASE_SERVICE_ACCOUNT invalid — push disabled:", e.message);
    return null;
  }
}

// Send a push to one device token. Best-effort: never throws (a bad/expired
// token must not break the assignment flow that triggered it).
export async function sendPush(token, { title, body, data = {} }) {
  if (!token || !getApp()) return;
  try {
    await getMessaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: "high", notification: { sound: "default", channelId: "jobs" } },
    });
  } catch (e) {
    log.error("sendPush failed:", e.message);
  }
}
