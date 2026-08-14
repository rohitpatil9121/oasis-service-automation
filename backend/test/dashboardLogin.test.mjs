// Who gets a session on the manager dashboard.
//
// The OTP endpoints are shared with the technician app — same code, same
// delivery — so before this a technician could sign in to the dashboard with
// the code he uses for his own app. Every route behind it answered 403, so he
// reached a full menu where every page failed to load: "the website is broken"
// rather than "this is not for you".
//
// The technician app must keep working exactly as it did, which is why the
// check keys off a `scope` the dashboard sends and the app does not.
//
// Run: node --test --experimental-test-module-mocks test/dashboardLogin.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const USERS = {
  owner: { id: "u-own", full_name: "Oasis Owner", role: "owner", phone: "+911111111111" },
  manager: { id: "u-man", full_name: "Service Manager", role: "manager", phone: "+912222222222" },
  technician: { id: "u-tec", full_name: "Shubham Jadhav", role: "technician", phone: "+913333333333" },
};

let app, whoIsLoggingIn;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/services/auth.js"), {
    namedExports: {
      verifyPassword: async () => whoIsLoggingIn,
      verifyOtp: async () => whoIsLoggingIn,
      requestOtp: async () => {},
    },
  });
  mock.module(url("../src/config/supabase.js"), { namedExports: { supabase: {} } });
  const { default: router } = await import(url("../src/routes/auth.js"));
  app = express();
  app.use(express.json());
  app.use("/api/auth", router);
});

beforeEach(() => { whoIsLoggingIn = USERS.owner; });

/** Call the running router without binding a port. */
async function post(path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

test("the owner signs in to the dashboard", async () => {
  const r = await post("/api/auth/login", { phone: "x", password: "y", scope: "dashboard" });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test("the manager signs in to the dashboard too", async () => {
  whoIsLoggingIn = USERS.manager;
  const r = await post("/api/auth/login", { phone: "x", password: "y", scope: "dashboard" });
  assert.equal(r.status, 200);
});

test("a technician is turned away, and told where to go instead", async () => {
  whoIsLoggingIn = USERS.technician;
  const r = await post("/api/auth/login", { phone: "x", password: "y", scope: "dashboard" });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Technician app/i, "it must name the app, not just refuse");
  assert.equal(r.body.token, undefined, "and no key is handed over");
});

test("a technician's own OTP does not open the dashboard either", async () => {
  // The code is right; the door is the wrong one.
  whoIsLoggingIn = USERS.technician;
  const r = await post("/api/auth/otp/verify", { phone: "x", code: "123456", scope: "dashboard" });
  assert.equal(r.status, 403);
  assert.equal(r.body.token, undefined);
});

test("the technician app is untouched: no scope, no refusal", async () => {
  // This is the app's own login. Breaking it would lock 16 technicians out of
  // their work, which is a far worse failure than the one being fixed.
  whoIsLoggingIn = USERS.technician;
  const r = await post("/api/auth/otp/verify", { phone: "x", code: "123456" });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});
