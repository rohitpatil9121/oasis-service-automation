// One-off: verify a ticket's rating shows up in technician reviews.
// Run: node scripts/check_review.js [ticket_number]
import { supabase } from "../src/config/supabase.js";
import { getMyReviews } from "../src/services/techJobs.js";
import { RATING_LABELS } from "../src/services/tickets.js";

const TN = process.argv[2] || "OG-070726-0013";

const { data: ticket, error: tErr } = await supabase
  .from("tickets")
  .select(
    "id, ticket_number, status, rating, rated_at, assigned_technician_id, " +
      "customer:customers(full_name, phone), " +
      "technician:users!tickets_assigned_technician_id_fkey(id, full_name, phone)"
  )
  .eq("ticket_number", TN)
  .maybeSingle();

if (tErr) {
  console.error("ticket query error:", tErr.message);
  process.exit(1);
}

if (!ticket) {
  console.log("TICKET_NOT_FOUND:", TN);
  const { data: recent } = await supabase
    .from("tickets")
    .select(
      "ticket_number, rating, rated_at, assigned_technician_id, " +
        "technician:users!tickets_assigned_technician_id_fkey(full_name)"
    )
    .not("rating", "is", null)
    .order("rated_at", { ascending: false })
    .limit(10);
  console.log("Recent rated tickets:", JSON.stringify(recent, null, 2));
  process.exit(0);
}

console.log("=== TICKET ===");
console.log({
  ticket_number: ticket.ticket_number,
  status: ticket.status,
  rating: ticket.rating,
  rating_label: ticket.rating != null ? RATING_LABELS[ticket.rating] : null,
  rated_at: ticket.rated_at,
  customer: ticket.customer?.full_name,
  technician: ticket.technician?.full_name || "(unassigned)",
  tech_id: ticket.assigned_technician_id,
});

if (!ticket.rating) {
  console.log("\nRESULT: Rating NOT saved on ticket — will NOT appear in Reviews.");
  process.exit(0);
}

if (!ticket.assigned_technician_id) {
  console.log("\nRESULT: Rating saved but NO technician assigned — will NOT appear in Reviews.");
  process.exit(0);
}

const reviews = await getMyReviews(ticket.assigned_technician_id);
console.log("\n=== TECH REVIEWS API OUTPUT ===");
console.log(JSON.stringify(reviews, null, 2));

const match = reviews.recent?.find(
  (r) => r.name === (ticket.customer?.full_name || "Customer") && r.stars === Number(ticket.rating)
);
console.log("\nRESULT:", match ? "YES — this rating IS in technician Reviews" : "PARTIAL — rating saved but not matched in recent list (check customer name / limit)");
