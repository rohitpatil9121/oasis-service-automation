// Generate a bcrypt hash for a password. Usage: node scripts/hash.js mypass
import bcrypt from "bcryptjs";
const pw = process.argv[2];
if (!pw) { console.error("usage: node scripts/hash.js <password>"); process.exit(1); }
console.log(await bcrypt.hash(pw, 10));
