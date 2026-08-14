import { Router } from "express";
import { signToken } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import * as auth from "../services/auth.js";

const router = Router();

/* Who is allowed a session on the manager DASHBOARD.

   The OTP endpoints below are shared with the technician app — the same code,
   sent the same way — so a technician could sign in to the dashboard with the
   code he uses for his own app. Nothing broke, because every route behind it
   answers 403 to a technician; he simply arrived at a full menu where every
   page failed to load, which reads as "the website is broken" rather than "this
   is not for you".

   The check is here rather than in the browser because a token, once issued, is
   a real key: refusing to draw the menu would still leave one in his hands.

   `scope` is sent by the dashboard only. Without it nothing changes, which is
   what keeps the technician app — and any older build of it — working. */
const DASHBOARD_ROLES = new Set(["owner", "manager"]);

function dashboardRefusal(user, scope) {
  if (scope !== "dashboard" || DASHBOARD_ROLES.has(user.role)) return null;
  return user.role === "technician"
    ? "This is the office dashboard. Please use the Oasis Technician app on your phone."
    : "This account does not have access to the dashboard.";
}

// Phone + password login.
router.post("/login", async (req, res, next) => {
  try {
    const { phone, password, scope } = req.body || {};
    if (!phone || !password)
      return res.status(400).json({ error: "phone and password required" });
    const user = await auth.verifyPassword(phone, password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const refused = dashboardRefusal(user, scope);
    if (refused) return res.status(403).json({ error: refused });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

// Request an OTP via WhatsApp.
router.post("/otp/request", async (req, res, next) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone required" });
    await auth.requestOtp(phone);
    res.json({ message: "If the account exists, an OTP was sent via WhatsApp." });
  } catch (e) { next(e); }
});

// Verify OTP -> issue token.
router.post("/otp/verify", async (req, res, next) => {
  try {
    const { phone, code, scope } = req.body || {};
    if (!phone || !code)
      return res.status(400).json({ error: "phone and code required" });
    const user = await auth.verifyOtp(phone, code);
    if (!user) return res.status(401).json({ error: "Invalid or expired code" });
    // The code was right; the door is the wrong one. See dashboardRefusal().
    const refused = dashboardRefusal(user, scope);
    if (refused) return res.status(403).json({ error: refused });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await auth.getById(req.user.id);
    res.json({ user });
  } catch (e) { next(e); }
});

function publicUser(u) {
  return { id: u.id, full_name: u.full_name, phone: u.phone, role: u.role };
}

export default router;
