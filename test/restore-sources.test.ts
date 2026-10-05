import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("absent restore-path policy agrees with official present-file admission without writing a probe target", async () => {
  const root = await mkdtemp("/var/tmp/hermes-restore-policy-");
  const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/restore-source-policy.ts", root], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.observations.map((row: { allowed: boolean }) => row.allowed), [true, false, false, true, false]);
  assert.equal(report.targetWrittenDuringDecision, false); assert.equal(report.modelCalls, 0);
});

for (const mode of ["configured", "cli", "package", "temporary", "cached-npm", "cached-git"]) test(`${mode} local source restores through registered archive commands using the persisted plugin identity`, async () => {
  const root = await mkdtemp("/var/tmp/hermes-local-restore-");
  const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/local-restore.ts", mode], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.realArchiveInput && report.roundTrip && report.removed && report.rebound);
  assert.equal(report.exclusion, mode !== "cli"); assert.equal(report.explicitUnderNoSkills, !["configured", "package"].includes(mode));
  assert.equal(report.cached, mode.startsWith("cached-")); assert.equal(report.incompatibleVersionRejected, mode === "cached-npm");
  assert.ok(report.decisions >= 4); assert.equal(report.modelCalls, 0);
});

test("cached temporary locators match public npm/Git roots and authorize absent targets without probes", async () => {
  const root = await mkdtemp("/var/tmp/hermes-temp-root-probe-"); const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/temporary-root-probe.ts", root], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cachedNpmRestorable, true); assert.equal(report.gitCases, 5);
  assert.equal(report.archivedBytesPreserved, true); assert.equal(report.afterResources, 0); assert.equal(report.modelCalls, 0);
});

test("stock missing-path rules agree with forty official-loader decisions across configuration and package scopes", async () => {
  const root = await mkdtemp("/var/tmp/hermes-restore-matrix-"); const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/restore-source-matrix.ts", root], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []); assert.ok(report.observations.length >= 40);
  assert.equal(report.targetWrittenDuringDecision, false); assert.equal(report.modelCalls, 0);
});
