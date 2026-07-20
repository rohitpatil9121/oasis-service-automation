import "dotenv/config";
const V = process.env.META_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE = process.env.META_PHONE_NUMBER_ID;
const g = async (path) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}${path.includes("?")?"&":"?"}access_token=${TOKEN}`);
  return { ok: r.ok, status: r.status, data: await r.json() };
};
// WABA id nikalo
let waba = process.env.META_WABA_ID;
if (!waba) {
  const r = await g(`${PHONE}?fields=whatsapp_business_account`);
  waba = r.data?.whatsapp_business_account?.id;
  if (!waba) { const r2 = await g(`${PHONE}`); console.log("phone info:", JSON.stringify(r2.data).slice(0,200)); }
}
console.log("WABA id:", waba || "NAHI MILA");
if (waba) {
  const r = await g(`${waba}/message_templates?limit=100&fields=name,status,category,components`);
  if (!r.ok) { console.log("ERR:", JSON.stringify(r.data).slice(0,300)); process.exit(1); }
  console.log(`Meta par templates: ${r.data.data.length}\n`);
  for (const t of r.data.data) {
    const body = (t.components||[]).find(c=>c.type==="BODY")?.text || "";
    const vars = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]));
    console.log(`  ${t.name.padEnd(32)} ${String(t.status).padEnd(10)} vars=${vars.size}`);
  }
}
