import "dotenv/config";
const V = process.env.META_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const g = async (p) => { const r = await fetch(`https://graph.facebook.com/${V}/${p}${p.includes("?")?"&":"?"}access_token=${TOKEN}`); return { ok:r.ok, data: await r.json() }; };
const dt = await g(`debug_token?input_token=${TOKEN}`);
const gs = dt.data?.data?.granular_scopes || [];
const ids = [...new Set(gs.flatMap(s => s.target_ids || []))];
console.log("granular target ids:", ids.join(", ") || "koi nahi");
for (const id of ids) {
  const r = await g(`${id}/message_templates?limit=100&fields=name,status,category,components`);
  if (!r.ok) { console.log(`  ${id}: templates nahi (${JSON.stringify(r.data.error?.message||"").slice(0,60)})`); continue; }
  console.log(`\n=== WABA ${id} -> ${r.data.data.length} templates ===`);
  for (const t of r.data.data) {
    const body = (t.components||[]).find(c=>c.type==="BODY")?.text || "";
    const vars = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]));
    console.log(`  ${t.name.padEnd(34)} ${String(t.status).padEnd(9)} vars=${vars.size}`);
  }
}
