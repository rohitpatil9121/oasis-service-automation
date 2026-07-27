import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import {
  listConversations, getConversationByPhone, sendMessageToPhone, setBotForPhone,
} from "../services/conversation.js";

const router = Router();
router.use(requireAuth);

// All customer WhatsApp threads for the "all chats" inbox — owners/managers only.
router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await listConversations()); }
  catch (e) { next(e); }
});

/* Phone-keyed thread endpoints. The ticket-keyed ones under /tickets/:id stay
   for opening a chat from a request; these cover conversations that have no
   ticket yet (WhatsApp intake still in progress, or a sender who never got
   as far as raising a request). Phone travels in the query/body, never the
   path, so "+" needs no escaping. */
router.get("/thread", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await getConversationByPhone(req.query.phone)); }
  catch (e) { next(e); }
});

router.post("/thread/message", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    res.json(await sendMessageToPhone({
      phone: req.body?.phone, body: req.body?.body, replyTo: req.body?.replyTo,
    }));
  } catch (e) { next(e); }
});

router.post("/thread/bot", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await setBotForPhone(req.body?.phone, !!req.body?.on)); }
  catch (e) { next(e); }
});

export default router;
