import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listConversations } from "../services/conversation.js";

const router = Router();
router.use(requireAuth);

// All customer WhatsApp threads for the "all chats" inbox — owners/managers only.
router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await listConversations()); }
  catch (e) { next(e); }
});

export default router;
