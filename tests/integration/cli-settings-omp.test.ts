/**
 * Integration tests for /api/cli-tools/omp-settings
 *
 * Oh My Pi (omp) reads its own local sqlite DB (~/.omp/agent/agent.db,
 * created by the omp CLI itself) via src/lib/db/omp.ts, plus a
 * ~/.omp/agent/models.yml file for provider/model discovery config. This
 * route is classified local-only in routeGuard.ts (it shells out to
 * `which omp`), so — unlike the pi/codewhale/jcode sibling routes in the
 * same PR — it does not call requireCliToolsAuth() itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const { GET, POST, DELETE } = await import("../../src/app/api/cli-tools/omp-settings/route.ts");

let tmpHome: string;
let origHome: string | undefined;

function getOmpDir() {
  return path.join(tmpHome, ".omp", "agent");
}

/** Simulate the omp CLI having already created its sqlite DB + schema. */
function seedOmpDb() {
  const dbPath = path.join(getOmpDir(), "agent.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      provider TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      data TEXT,
      disabled_cause TEXT,
      identity_key TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  db.close();
}

test.beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "omp-settings-home-"));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

test.afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ── Test 1: GET → 200 with installed:false when omp is not present ──────────

test("omp-settings GET: returns 200 installed:false when omp CLI and DB are both absent", async () => {
  const res = await GET();
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.installed, false);
  assert.equal(body.config, null);
});

// ── Test 2: GET → detects "installed" via the DB file even without the binary on PATH ──

test("omp-settings GET: treats an existing agent.db as installed", async () => {
  seedOmpDb();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.installed, true);
  assert.equal(body.hasOmniRoute, false);
});

// ── Test 3: POST with invalid body → 400 ─────────────────────────────────────

test("omp-settings POST: 400 when baseUrl is missing", async () => {
  const res = await POST(
    new Request("http://localhost/api/cli-tools/omp-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test" }),
    })
  );
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.error !== undefined);
});

// ── Test 4: POST with valid body → writes models.yml + persists credentials ──

test("omp-settings POST: writes models.yml and persists credentials for a seeded DB", async () => {
  seedOmpDb();

  const res = await POST(
    new Request("http://localhost/api/cli-tools/omp-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test-omp" }),
    })
  );
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);

  const modelsYmlPath = path.join(getOmpDir(), "models.yml");
  assert.ok(fs.existsSync(modelsYmlPath), "models.yml must be written");
  const content = fs.readFileSync(modelsYmlPath, "utf-8");
  assert.ok(content.includes("http://localhost:20128/v1"), "models.yml must contain the base URL");

  const getRes = await GET();
  const getBody = await getRes.json();
  assert.equal(getBody.hasOmniRoute, true);
});

// ── Test 5: DELETE → removes OmniRoute provider entry ────────────────────────

test("omp-settings DELETE: removes the OmniRoute provider from models.yml and credentials", async () => {
  seedOmpDb();
  await POST(
    new Request("http://localhost/api/cli-tools/omp-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test-omp" }),
    })
  );

  const res = await DELETE();
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.success, true);

  const getRes = await GET();
  const getBody = await getRes.json();
  assert.equal(getBody.hasOmniRoute, false);
});

// ── Test 6: Error sanitization (Hard Rule #12) ───────────────────────────────

test("omp-settings: error responses do not leak stack traces", async () => {
  const badReq = new Request("http://localhost/api/cli-tools/omp-settings", {
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
