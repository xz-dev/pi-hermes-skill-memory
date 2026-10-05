import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

test("official CLI default entry discovers same-name scopes and honors --no-skills without real model calls", async () => {
  const root = await mkdtemp("/var/tmp/hermes-cli-sources-");
  const home = join(root, "home"), agentDir = join(root, "agent"), cwd = join(root, "project");
  await mkdir(home); await mkdir(cwd);
  for (const d of [join(agentDir, "skills/release-check"), join(cwd, ".pi/skills/release-check")]) {
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "SKILL.md"), "---\nname: release-check\ndescription: Scoped CLI fixture\n---\nFixture.\n");
  }
  const repo = new URL("..", import.meta.url).pathname;
  const baseArgs = [join(getPackageDir(), "dist/bundle/cli.js"), "--offline", "--approve", "--no-session", "--no-context-files",
    "--no-prompt-templates", "--no-themes", "--no-extensions", "-e", join(repo, "src/index.ts"),
    "-e", join(repo, "test/fixtures/cli-sources.ts"), "--provider", "hermes-source-test", "--model", "fake",
    "--tools", "hermes_skill_search,hermes_skill_view", "--mode", "json", "-p", "Probe"];
  for (const noSkills of [false, true]) {
    const result = spawnSync(process.execPath, noSkills ? [...baseArgs, "--no-skills"] : baseArgs, {
      cwd, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
        HERMES_SOURCE_REPORT: join(root, "receipt.jsonl"), HERMES_EXPECT_COUNT: noSkills ? "0" : "2" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('"state":"source-error"'), result.stderr);
    assert.ok(result.stdout.includes("CLI fake only"));
  }
});
