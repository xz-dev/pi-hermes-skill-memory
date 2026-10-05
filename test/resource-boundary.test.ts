import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Characterize the official host boundary; not an acceptance claim for task 3.1. */
test("official enabled source resolution retains names that prompt skill loading deduplicates", async () => {
  const root = await mkdtemp("/var/tmp/hermes-source-boundary-");
  const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/resource-boundary.ts", root], {
    cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    configuredEnabled: 2, normalVisible: 1, collisionReported: true,
    disabledVisible: 0, configuredStillEnabled: 2, noSkillsInSettings: false,
  });
});
