import { supabase } from "../config/supabase.js";

/* Atomic top-level merge into tickets.tech_work (db/phase7_atomic_tech_work.sql).

   Pass ONLY the keys you are changing. Never spread a tech_work you read
   earlier — that is exactly the read-modify-write that let two concurrent
   requests erase each other's fields.

   Merge semantics differ from the old whole-object write in one way that
   matters: omitting a key LEAVES IT ALONE, it does not delete it. To clear a
   field, pass it explicitly as null. */
export async function mergeTechWork(ticketId, patch) {
  const { error } = await supabase.rpc("merge_tech_work", {
    p_ticket_id: ticketId,
    p_patch: patch,
  });
  if (error) throw new Error("mergeTechWork: " + error.message);
}
