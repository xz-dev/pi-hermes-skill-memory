import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { automaticEnabled } from "../src/ledger.ts";
import { isolatedSession } from "./support.ts";

test("valid state without a saved choice defaults on; absent state stays blocked", () => {
  assert.equal(automaticEnabled(undefined), false);
});

test("TUI stays quiet across reload, review and faults; explicit status retains details", { timeout: 10000 }, async () => {
  let sourceFails = false;
  const f = await isolatedSession('{"skills":[]}', { projectRoot: cwd => cwd,
    skillSources: async request => {
      if (sourceFails) throw new Error("fixture-source-unavailable");
      return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, skills: [], diagnostics: [] };
    } });
  const persistent: unknown[] = [], notices: string[] = [];
  try {
    const ui = f.session.extensionRunner.createContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui,
      setStatus: (_key, value) => { if (value !== undefined) persistent.push(value); },
      setWidget: (_key, value) => { if (value !== undefined) persistent.push(value); },
      notify: value => { notices.push(value); } } });
    await f.session.reload();
    assert.deepEqual(persistent, []); assert.deepEqual(notices, []);
    await f.session.prompt("/hermes-review status");
    const review = JSON.parse(notices.at(-1)!);
    assert.equal(review.auto, "on"); assert.equal(review.latest, "idle");
    assert.deepEqual(review.targets, ["skills"]); assert.equal(review.limits.dailyInput, 256000);
    await f.session.prompt("/hermes-skills status");
    const skills = JSON.parse(notices.at(-1)!);
    assert.equal(skills.mode, "search"); assert.equal(skills.installed.allowAutoModifyInstalledSkills, false);
    assert.deepEqual(skills.maintenance, []); assert.equal(f.calls.length, 0);
    notices.length = 0;
    let stop = () => {};
    const done = new Promise<void>(resolve => { stop = f.onReviewState(state => { if (state.records.at(-1)?.status === "no-change") resolve(); }); });
    await f.session.prompt("/hermes-review run"); await done; stop();
    assert.deepEqual(persistent, []); assert.deepEqual(notices, []);
    await f.session.prompt("/hermes-review status");
    assert.equal(JSON.parse(notices.at(-1)!).latest, "no-change");
    assert.equal(f.calls.length, 1);
    sourceFails = true;
    await f.session.prompt("/hermes-skills status");
    assert.match(JSON.parse(notices.at(-1)!).sourceError, /fixture-source-unavailable/);
    await writeFile(join(f.agentDir, "hermes-review/ledger.json"), "corrupt fixture");
    notices.length = 0; await f.session.reload();
    assert.deepEqual(notices, []); assert.deepEqual(persistent, []);
    await f.session.prompt("/hermes-review status");
    assert.ok(JSON.parse(notices.at(-1)!).failed);
    assert.equal(f.calls.length, 1); assert.deepEqual(persistent, []);
  } finally { f.session.dispose(); }
});
