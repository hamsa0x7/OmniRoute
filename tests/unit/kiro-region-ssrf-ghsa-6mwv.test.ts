/**
 * Kiro region SSRF guard (GHSA-6mwv-4mrm-5p3m).
 *
 * The `region` parameter of every KiroService method is interpolated into the
 * upstream URL `https://oidc.${region}.amazonaws.com/...`. Without validation,
 * an attacker who can supply the region (via the OAuth provider params on the
 * Kiro auto-import path, or via providerSpecificData on a credential update)
 * can pivot the outbound request to an arbitrary host by injecting URL
 * delimiters (e.g. `evil.com/x?ignore=`), turning a token refresh into an
 * arbitrary `POST` to attacker-controlled infrastructure.
 *
 * Mirrors decolua/9router commit 126aa244c5b51b74ab8c7594e3418fcf4437bf6f
 * which added `assertValidAwsRegion` enforced by a strict AWS region regex.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AWS_REGION_PATTERN,
  assertValidAwsRegion,
} from "@/lib/oauth/constants/oauth";
import { KiroService } from "@/lib/oauth/services/kiro";

test("AWS_REGION_PATTERN accepts canonical AWS regions", () => {
  for (const region of [
    "us-east-1",
    "us-east-2",
    "eu-central-1",
    "ap-southeast-2",
    "eu-west-3",
    "ca-central-1",
  ]) {
    assert.ok(AWS_REGION_PATTERN.test(region), `should accept ${region}`);
  }
});

test("AWS_REGION_PATTERN rejects SSRF / URL-injection payloads", () => {
  for (const bad of [
    "evil.com",
    "us-east-1.evil.com",
    "us-east-1/x",
    "us-east-1?x=1",
    "us-east-1#frag",
    "us-east-1.attacker.example/path",
    "us-east-1:8080",
    "us-east-1 ",
    " us-east-1",
    "../us-east-1",
    "",
    "US-EAST-1",
    "us_east_1",
  ]) {
    assert.equal(AWS_REGION_PATTERN.test(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("assertValidAwsRegion throws on a non-string or invalid region", () => {
  assert.throws(() => assertValidAwsRegion("evil.com"), /Invalid region/);
  assert.throws(() => assertValidAwsRegion("us-east-1/x"), /Invalid region/);
  assert.throws(() => assertValidAwsRegion(""), /Invalid region/);
  assert.throws(
    () => assertValidAwsRegion(undefined as unknown as string),
    /Invalid region/
  );
  assert.throws(() => assertValidAwsRegion(null as unknown as string), /Invalid region/);
});

test("assertValidAwsRegion returns valid region unchanged", () => {
  assert.equal(assertValidAwsRegion("us-east-1"), "us-east-1");
  assert.equal(assertValidAwsRegion("eu-central-1"), "eu-central-1");
});

test("KiroService.registerClient rejects a malicious region before fetching", async () => {
  const svc = new KiroService();
  await assert.rejects(
    () => svc.registerClient("evil.com/x?ignore="),
    /Invalid region/
  );
});

test("KiroService.startDeviceAuthorization rejects a malicious region", async () => {
  const svc = new KiroService();
  await assert.rejects(
    () => svc.startDeviceAuthorization("cid", "secret", "https://example.com", "us-east-1.evil.com"),
    /Invalid region/
  );
});

test("KiroService.pollDeviceToken rejects a malicious region", async () => {
  const svc = new KiroService();
  await assert.rejects(
    () => svc.pollDeviceToken("cid", "secret", "device-code", "us-east-1/x"),
    /Invalid region/
  );
});

test("KiroService.refreshToken rejects a malicious region", async () => {
  const svc = new KiroService();
  await assert.rejects(
    () =>
      svc.refreshToken("refresh-token", {
        clientId: "cid",
        clientSecret: "secret",
        region: "evil.com",
      }),
    /Invalid region/
  );
});

test("KiroService.validateImportToken rejects a malicious region", async () => {
  const svc = new KiroService();
  await assert.rejects(
    () => svc.validateImportToken("aorAAAAAGfake", "evil.com"),
    /Invalid region/
  );
});
