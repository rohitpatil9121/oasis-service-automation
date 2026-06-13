// Quick DB-free sanity check of phone normalisation/validation helpers.
// For the full intake state-machine test, see README (run against a test DB).
import { normalizePhone, isValidPhone, toWhatsApp } from "../src/lib/phone.js";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)); };
ok(normalizePhone("whatsapp:+918668732890") === "+918668732890", "strip whatsapp: prefix");
ok(normalizePhone("8668732890") === "+918668732890", "prepend default country code");
ok(normalizePhone("00918668732890") === "+918668732890", "convert 00 prefix");
ok(isValidPhone("8668732890") === true, "accept valid local number");
ok(isValidPhone("123") === false, "reject too-short number");
ok(toWhatsApp("+918668732890") === "whatsapp:+918668732890", "toWhatsApp format");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
