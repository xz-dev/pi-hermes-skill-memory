import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("public stock resolver honors duplicates, exclusions, noSkills, trust and offline temporary-package manifests", async () => {
  const root = await mkdtemp("/var/tmp/hermes-stock-sources-");
  const home = join(root, "home"); await mkdir(home);
  const result = spawnSync(process.execPath, ["test/fixtures/source-resolver.ts", root], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { duplicateAllowed: 2, excluded: true, noSkills: 0,
    untrustedAllowed: 1, temporary: ["temporary-a"], missingInstalled: false });
});
