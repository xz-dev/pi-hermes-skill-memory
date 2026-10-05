import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ManagedSkillStore } from "../src/store.ts";
import { isolatedSession } from "./support.ts";

// Storage locking is separate from charging. No child here loads a provider or a Pi session.
test("two processes cannot replace one managed root concurrently or duplicate an approved commit", async () => {
  const f = await isolatedSession(); const store = new ManagedSkillStore(f.agentDir, f.cwd);
  const snapshot = { cwd: f.cwd, sessionId: "fixture", leafId: null, model: undefined, thinking: undefined, messages: [],
    evidence: [{ entryId: "user-1", text: "Use release checks" }], digest: "fixture" };
  const proposal = { action: "create" as const, scope: "project" as const, name: "release-check", description: "Release checks",
    body: "Use release checks", reason: "Reusable", evidence: [{ entryId: "user-1", quote: "Use release checks" }] };
  try {
    await store.save({ ...proposal, name: "seed" }, snapshot, "seed");
    const module = new URL("../src/store.ts", import.meta.url).href;
    const script = `import { ManagedSkillStore } from ${JSON.stringify(module)};
      const store = new ManagedSkillStore(${JSON.stringify(f.agentDir)}, ${JSON.stringify(f.cwd)});
      try { await store.save(${JSON.stringify(proposal)}, ${JSON.stringify(snapshot)}, 'competing-request', {
        authorize: () => new Promise(resolve => setTimeout(resolve, 40))
      }); console.log('COMMITTED'); } catch (error) { console.log('BLOCKED:' + String(error)); }`;
    function child(): Promise<string> {
      return new Promise((resolve, reject) => {
        const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        process.stdout.on("data", data => { output += data; }); process.stderr.on("data", data => { output += data; });
        process.on("error", reject); process.on("close", code => { if (code) reject(new Error(output)); else resolve(output); });
      });
    }
    const results = await Promise.all([child(), child()]);
    assert.equal(results.filter(result => result.includes("COMMITTED")).length, 1);
    assert.equal((await store.catalog()).filter(record => record.name === "release-check").length, 1);
    assert.deepEqual(await store.inspectRecovery(), []);
    assert.equal(f.calls.length, 0);
    assert.equal((await store.search("release checks")).find(record => record.name === "release-check")!.path,
      join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md"));
  } finally { f.session.dispose(); }
});
