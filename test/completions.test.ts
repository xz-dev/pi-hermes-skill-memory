import assert from "node:assert/strict";
import { test } from "node:test";
import { isolatedSession } from "./support.ts";

test("registered skill commands complete fixed actions and scoped argument positions without running commands", async () => {
  let sourceRequests = 0;
  const f = await isolatedSession("fake", { skillSources: async request => {
    sourceRequests++;
    return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, skills: [], diagnostics: [] };
  } });
  try {
    const complete = f.session.extensionRunner!.getCommand("hermes-skills")?.getArgumentCompletions;
    assert.ok(complete, "hermes-skills must register its argument completion callback");
    const values = async (prefix: string) => (await complete(prefix))?.map(item => item.value) ?? [];
    assert.deepEqual(await values(""), ["history", "rollback", "archive", "archives", "archive-resume", "restore", "curate", "status", "refresh", "mode", "load", "pending", "approve", "reject", "settings", "installed", "inspect", "pin", "unpin", "use", "outcome", "migrate"]);
    assert.deepEqual(await values("ar"), ["archive", "archives", "archive-resume"]);
    assert.deepEqual(await values("curate "), ["curate list", "curate propose", "curate apply"]);
    assert.deepEqual(await values("mode s"), ["mode search"]);
    assert.deepEqual(await values("  mode  n"), ["mode native"]);
    assert.deepEqual(await values("installed "), ["installed allow", "installed deny"]);
    assert.deepEqual(await values("installed allow --a"), ["installed allow --acknowledge"]);
    assert.deepEqual(await values("outcome skill-id "), ["outcome skill-id success", "outcome skill-id failure"]);
    assert.deepEqual(await values("migrate skill-id g"), ["migrate skill-id global"]);
    for (const prefix of ["unknown", "status ", "mode unknown ", "installed deny ", "curate apply ", "outcome ", "outcome skill-id success ", "migrate skill-id global reason ", "load "]) {
      assert.equal(await complete(prefix), null, `no fixed candidate at ${JSON.stringify(prefix)}`);
    }
    assert.equal(sourceRequests, 0, "Tab must not refresh or scan skill sources");
    assert.equal(f.calls.length, 0, "Tab must not request a model");
  } finally { f.session.dispose(); }
});

test("registered review command completes recovery and acknowledgment without invoking review", async () => {
  const f = await isolatedSession();
  try {
    const complete = f.session.extensionRunner!.getCommand("hermes-review")?.getArgumentCompletions;
    assert.ok(complete, "hermes-review must register its argument completion callback");
    const values = async (prefix: string) => (await complete(prefix))?.map(item => item.value) ?? [];
    assert.deepEqual(await values(""), ["enable", "disable", "run", "status", "usage", "errors", "cancel", "retry", "pause", "resume", "recovery", "recover"]);
    assert.deepEqual(await values("reco"), ["recovery", "recover"]);
    assert.deepEqual(await values("resume "), ["resume --acknowledge"]);
    assert.deepEqual(await values("recover local-key "), ["recover local-key commit", "recover local-key abort"]);
    assert.deepEqual(await values(" recover   local-key a"), ["recover local-key abort"]);
    for (const prefix of ["unknown", "status ", "recover ", "recover local-key commit ", "retry ", "run "]) {
      assert.equal(await complete(prefix), null, `no fixed candidate at ${JSON.stringify(prefix)}`);
    }
    assert.equal(f.calls.length, 0, "Tab must not start a metered review");
  } finally { f.session.dispose(); }
});
