// A photo Meta has deleted, and a photo Meta is merely rate-limiting, must not
// be treated the same.
//
// Meta answers a deleted media id with error subcode 33 — permanent. It answers
// too many requests with "(#4) Application request limit reached", which it
// marks is_transient. The first backfill run could not tell them apart, hit the
// rate limit after about 40 images, and recorded every remaining photograph as
// gone. Saying "Media not found" for one of those would have the office write
// off a picture that is still there.
//
// Run: node --test --experimental-test-module-mocks test/waMedia.test.mjs

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

let metaReply;          // what graph.facebook.com answers
let stored;             // what our own storage holds

function fakeFetch(url) {
  if (String(url).includes("graph.facebook.com")) return Promise.resolve(metaReply());
  // the binary download step
  return Promise.resolve({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode("JPEGDATA").buffer,
  });
}

const jsonError = (status, error) => () => ({
  ok: false, status,
  text: async () => JSON.stringify({ error }),
});

let fetchFromMeta;

before(async () => {
  const url = (p) => new URL(p, import.meta.url).href;
  mock.module(url("../src/config/supabase.js"), {
    namedExports: {
      supabase: {
        storage: {
          from: () => ({
            download: async () => (stored ? { data: { arrayBuffer: async () => stored, type: "image/jpeg" } } : { error: "no" }),
            upload: async () => ({ error: null }),
          }),
          createBucket: async () => ({}),
        },
      },
    },
  });
  mock.module(url("../src/config/env.js"), {
    namedExports: {
      env: { whatsappMock: false, whatsappProvider: "meta", metaGraphVersion: "v21.0", metaAccessToken: "x" },
      checkEnv: () => {},
    },
  });
  globalThis.fetch = fakeFetch;
  ({ fetchFromMeta } = await import(url("../src/services/waMedia.js")));
});

beforeEach(() => { stored = null; });

test("a photo Meta still has comes back", async () => {
  metaReply = () => ({ ok: true, json: async () => ({ url: "https://lookaside/x", mime_type: "image/jpeg" }) });
  const got = await fetchFromMeta("123");
  assert.ok(got.buffer, "the image");
  assert.equal(got.contentType, "image/jpeg");
});

test("a deleted photo is reported as gone, not retryable", async () => {
  metaReply = jsonError(400, {
    message: "Unsupported get request.", type: "GraphMethodException", code: 100, error_subcode: 33,
  });
  const got = await fetchFromMeta("123");
  assert.equal(got.gone, true);
  assert.notEqual(got.transient, true, "nothing to retry — the picture is deleted");
});

test("a rate limit is retryable, and never called gone", async () => {
  metaReply = jsonError(403, {
    message: "(#4) Application request limit reached", type: "OAuthException", code: 4, is_transient: true,
  });
  const got = await fetchFromMeta("123");
  assert.equal(got.transient, true, "this is the case that wrote off 400 good photos");
  assert.notEqual(got.gone, true);
});

test("a 429 is retryable too", async () => {
  metaReply = jsonError(429, { message: "rate limited" });
  assert.equal((await fetchFromMeta("123")).transient, true);
});

test("a network failure is retryable, not a deletion", async () => {
  globalThis.fetch = () => Promise.reject(new Error("socket hang up"));
  const got = await fetchFromMeta("123");
  assert.equal(got.transient, true);
  globalThis.fetch = fakeFetch;
});

test("an expired token is NOT called transient — it needs a human", async () => {
  // Subcode 33 is a dead photo; code 190 is our own token. Retrying either for
  // ever would hide the real problem.
  metaReply = jsonError(401, { message: "Session has expired", type: "OAuthException", code: 190 });
  const got = await fetchFromMeta("123");
  assert.equal(got.gone, true);
});
