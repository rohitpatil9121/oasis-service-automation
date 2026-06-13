import { Router } from "express";
import { signToken } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import * as auth from "../services/auth.js";

const router = Router();

// Phone + password login.
router.post("/login", async (req, res, next) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password)
      return res.status(400).json({ error: "phone and password required" });
    const user = await auth.verifyPassword(phone, password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
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
    const { phone, code } = req.body || {};
    if (!phone || !code)
      return res.status(400).json({ error: "phone and code required" });
    const user = await auth.verifyOtp(phone, code);
    if (!user) return res.status(401).json({ error: "Invalid or expired code" });
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
