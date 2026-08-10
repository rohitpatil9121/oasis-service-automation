/* The strict login limiter must cover the credential endpoints and nothing else.

   It used to sit on all of /api/auth, which swept in GET /me — a read of the
   session the caller already has a valid token for, and the first call every
   app boot makes. Twenty per IP per fifteen minutes is right for guessing a
   password and far too tight for technicians sharing one office IP. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

test("the strict limiter is mounted on the credential paths only", () => {
  assert.match(src, /app\.use\(\["\/api\/auth\/login", "\/api\/auth\/otp"\], authLimiter\)/);
  assert.ok(
    !/app\.use\("\/api\/auth", authLimiter\)/.test(src),
    "must not cover the whole /api/auth tree — that catches GET /me",
  );
});

test("the general API limiter still covers everything under /api", () => {
  assert.match(src, /app\.use\("\/api", apiLimiter\)/);
});
