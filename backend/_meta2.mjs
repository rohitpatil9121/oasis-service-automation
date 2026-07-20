import "dotenv/config";
const V = process.env.META_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE = process.env.META_PHONE_NUMBER_ID;
const g = async (p) => { const r = await fetch(`https://graph.facebook.com/${V}/${p}${p.includes("?")?"&":"?"}access_token=${TOKEN}`); return { ok:r.ok, data: await r.json() }; };
for (const attempt of [
  `${PHONE}?fields=whatsapp_business_account{id,name}`,
  `${PHONE}/whatsapp_business_account`,
  `me?fields=id,name`,
  `debug_token?input_token=${TOKEN}`,
]) {
  const r = await g(attempt);
  console.log(`\n[${attempt.split("?")[0]}] ok=${r.ok}`);
  console.log("  " + JSON.stringify(r.data).slice(0, 380));
}
