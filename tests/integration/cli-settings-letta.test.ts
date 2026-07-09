/**
 * Integration tests for /api/cli-tools/letta-settings
 *
 * Letta configures OmniRoute as its "lmstudio" provider (localModelDiscovery:
 * openai-compatible auto-discovers models from /v1/models). This route is
 * classified local-only in routeGuard.ts (it shells out to `which letta`),
 * so — like omp-settings — it does not call requireCliToolsAuth() itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { GET, POST, DELETE } = await import(
  "../../src/app/api/cli-tools/letta-settings/route.ts"
);

let tmpHome: string;
let origHome: string | undefined;

function getAuthPath() {
  return path.join(tmpHome, ".letta", "lc-local-backend", "providers", "auth.json");
}

test.beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "letta-settings-home-"));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

test.afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ── Test 1: GET → 200 installed:false when the letta CLI is absent ──────────

test("letta-settings GET: returns 200 installed:false when Letta CLI is absent", async () => {
  const res = await GET();
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.installed, false);
  assert.equal(body.config, null);
});

// ── Test 2: GET → detects "installed" via an existing ~/.letta dir ──────────

test("letta-settings GET: treats an existing ~/.letta directory as installed", async () => {
  fs.mkdirSync(path.join(tmpHome, ".letta"), { recursive: true });
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.installed, true);
  assert.equal(body.hasOmniRoute, false);
});

// ── Test 3: POST with invalid body → 400 ─────────────────────────────────────

test("letta-settings POST: 400 when baseUrl is missing", async () => {
  const res = await POST(
    new Request("http://localhost/api/cli-tools/letta-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test" }),
    })
  );
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.error !== undefined);
});

// ── Test 4: POST with valid body → writes the lmstudio provider to auth.json ─

test("letta-settings POST: writes the lmstudio provider entry for a fresh install", async () => {
  const res = await POST(
    new Request("http://localhost/api/cli-tools/letta-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test-letta" }),
    })
  );
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);

  const authPath = getAuthPath();
  assert.ok(fs.existsSync(authPath), "auth.json must be written");
  const authFile = JSON.parse(fs.readFileSync(authPath, "utf-8"));
  assert.equal(authFile.providers.lmstudio.base_url, "http://localhost:20128/v1");
  assert.equal(authFile.providers.lmstudio.auth.key, "sk-test-letta");
});

// ── Test 5: POST refuses to overwrite an existing non-OmniRoute lmstudio config ──

test("letta-settings POST: 409 when lmstudio is already configured for real LM Studio", async () => {
  const providersDir = path.join(tmpHome, ".letta", "lc-local-backend", "providers");
  fs.mkdirSync(providersDir, { recursive: true });
  fs.writeFileSync(
    path.join(providersDir, "auth.json"),
    JSON.stringify({
      version: 1,
      providers: { lmstudio: { base_url: "http://localhost:1234/v1" } },
    })
  );

  const res = await POST(
    new Request("http://localhost/api/cli-tools/letta-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test-letta" }),
    })
  );
  assert.equal(res.status, 409, `Expected 409, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.conflict, true);
});

// ── Test 6: DELETE → removes the OmniRoute lmstudio config ──────────────────

test("letta-settings DELETE: removes the lmstudio provider written by POST", async () => {
  await POST(
    new Request("http://localhost/api/cli-tools/letta-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test-letta" }),
    })
  );

  const res = await DELETE();
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);

  const authFile = JSON.parse(fs.readFileSync(getAuthPath(), "utf-8"));
  assert.ok(!authFile.providers.lmstudio, "lmstudio provider must be removed");
});

// ── Test 7: Error sanitization (Hard Rule #12) ───────────────────────────────

test("letta-settings: error responses do not leak stack traces", async () => {
  const badReq = new Request("http://localhost/api/cli-tools/letta-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ bad json }",
  });
  const res = await POST(badReq);
  const bodyStr = JSON.stringify(await res.json());
  assert.ok(
    !bodyStr.match(/\s+at\s+\/[^\s]/),
    "Error response must not contain absolute-path stack traces"
  );
});
