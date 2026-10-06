import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { captureSnapshot } from "../src/context.ts";
import { ManagedSkillStore } from "../src/store.ts";
import type { SkillProposal, ManagedSkill } from "../src/store.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { reviewSkills } from "../src/review.ts";
import { isolatedSession } from "./support.ts";

async function fixture() {
  let agentDir = "", global!: ManagedSkill, project!: ManagedSkill, proposal!: SkillProposal;
  let target: "wrong" | "right" | "pasted" = "wrong";
  const f = await isolatedSession("fixture", { projectRoot: cwd => cwd,
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [], skills: [
      ...loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills,
      ...loadSkillsFromDir({ dir: join(agentDir, "skills"), source: "user" }).skills,
    ] }),
    streamReply: context => {
      const lastUser = context.messages.findLastIndex(message => message.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(message => message.role === "toolResult");
      const update: SkillProposal = { ...proposal, action: "update", id: target === "right" ? global.id : project.id,
        scope: target === "right" ? "global" : "project", crossProject: "User-approved common npm procedure", baseVersion: global.version,
        body: "Build before manifest check. Then validate the build output." };
      if (!results.length && target !== "pasted") return { stopReason: "toolUse", content: [{ type: "toolCall", id: "read-global", name: "hermes_skill_view", arguments: { id: global.id } }] };
      if (!results.length || results.at(-1)?.toolName === "hermes_skill_view") return { stopReason: "toolUse", content: [{ type: "toolCall", id: "apply-proposal", name: "hermes_skill_manage", arguments: { proposal: JSON.parse(JSON.stringify(update)) } }] };
      const result = JSON.parse(results.at(-1)!.content.filter(part => part.type === "text").map(part => part.text).join(""));
      assert.equal(result.status, target === "right" ? "saved" : "conflict");
      assert.equal(result.auxiliaryModelCalled, false);
      return { stopReason: "stop", content: [{ type: "text", text: result.status }] };
    },
  }); agentDir = f.agentDir;
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 1 });
  const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.runtime.getModel("hermes-test", "fake"), getSystemPrompt: () => "Fixture" });
  const store = new ManagedSkillStore(f.agentDir, f.cwd);
  proposal = { action: "create", scope: "project", name: "release-check", description: "Release ordering", body: "Build before manifest check",
    reason: "Reusable user correction", evidence: [{ entryId, quote: "Build before manifest check" }] };
  project = await store.save(proposal, snapshot, "project-seed");
  global = await store.save({ ...proposal, scope: "global", crossProject: "Applies to user-approved npm projects" }, snapshot, "global-seed");
  assert.equal(project.version, global.version); assert.notEqual(project.id, global.id);
  return { ...f, store, project, global, proposal, snapshot, target: (value: typeof target) => { target = value; } };
}

test("registered read of global A never authorizes identical-hash project B; the actually read target can be updated", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.project.path, "utf8");
    await f.session.prompt("Read the global rule but attempt to modify the project rule");
    assert.equal(await readFile(f.project.path, "utf8"), before); assert.equal(await readFile(f.global.path, "utf8"), before);
    f.target("right"); await f.session.prompt("Update the global rule that was actually read");
    assert.equal(await readFile(f.project.path, "utf8"), before);
    assert.match(await readFile(f.global.path, "utf8"), /Then validate the build output/);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, [], "foreground commit must not start an auxiliary request");
  } finally { f.session.dispose(); }
});

test("pasted user hashes and a stable ID from another scope are not target read receipts", async () => {
  const f = await fixture();
  try {
    f.target("pasted");
    const before = await readFile(f.project.path, "utf8");
    await f.session.prompt(`Here is a pasted version ${f.project.version}; update the project rule`);
    assert.equal(await readFile(f.project.path, "utf8"), before);
    await assert.rejects(f.store.save({ ...f.proposal, action: "update", id: f.global.id, baseVersion: f.project.version },
      { ...f.snapshot, skillReads: [{ id: f.global.id, file: "SKILL.md", version: f.global.version }] }, "wrong-scope"), /identity conflict/);
    assert.equal(await readFile(f.global.path, "utf8"), before);
  } finally { f.session.dispose(); }
});

test("paid identity refusal settles the original request once, without correction or repair requests", async () => {
  const f = await fixture(); let calls = 0;
  try {
    await f.session.prompt("Read global A but attempt project B");
    const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture" });
    assert.ok(snapshot.skillReads.some(read => read.id === f.global.id));
    const ledger = new ReviewLedger(f.agentDir);
    const message: AssistantMessage = { role: "assistant", provider: f.snapshot.model!.provider, model: f.snapshot.model!.id, api: f.snapshot.model!.api,
      stopReason: "stop", timestamp: 1, content: [{ type: "text", text: JSON.stringify({ skills: [{ ...f.proposal, action: "update",
        id: f.project.id, baseVersion: f.project.version, body: "Model replacement" }] }) }],
      usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const before = await readFile(f.project.path, "utf8");
    const record = await reviewSkills({ snapshot, ledger, store: f.store, registry: { streamSimple: () => {
      calls++; const stream = createAssistantMessageEventStream(); stream.end(message); return stream;
    } } });
    assert.equal(record.status, "conflict"); assert.equal(record.usage?.totalTokens, 110); assert.equal(calls, 1);
    assert.equal((await ledger.inspect()).records.length, 1); assert.equal(await readFile(f.project.path, "utf8"), before);
  } finally { f.session.dispose(); }
});

test("supporting files require their own exact read identity, not an identical sibling hash", async () => {
  const f = await fixture();
  try {
    const asset = await f.store.save({ ...f.proposal, name: "asset-rule", files: [
      { file: "references/a.md", content: "Same bytes" }, { file: "references/b.md", content: "Same bytes" },
    ] }, f.snapshot, "asset-seed");
    const before = await readFile(join(f.cwd, ".pi/skills/hermes-managed/asset-rule/references/a.md"), "utf8");
    const snapshot = { ...f.snapshot, skillReads: [
      { id: asset.id, file: "SKILL.md", version: asset.version },
      { id: asset.id, file: "references/b.md", version: asset.files!["references/b.md"]! },
    ] };
    await assert.rejects(f.store.save({ ...f.proposal, name: asset.name, action: "update", id: asset.id, baseVersion: asset.version,
      files: [{ file: "references/a.md", content: "Never substitute", baseVersion: asset.files!["references/a.md"] }],
    }, snapshot, "unread-asset"), /target version not read/);
    assert.equal(await readFile(join(f.cwd, ".pi/skills/hermes-managed/asset-rule/references/a.md"), "utf8"), before);
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("central commit independently refuses missing provenance, pin races and read-only targets", async () => {
  for (const mode of ["provenance", "pin-race", "read-only"] as const) {
    const f = await fixture();
    try {
      const before = await readFile(f.project.path, "utf8");
      const update: SkillProposal = { ...f.proposal, action: "update", id: f.project.id, baseVersion: f.project.version, body: "Never overwrite protected content" };
      const snapshot = { ...f.snapshot, skillReads: [{ id: f.project.id, file: "SKILL.md", version: f.project.version }] };
      if (mode === "provenance") {
        await writeFile(join(f.agentDir, "hermes-skills/provenance/approved.json"), JSON.stringify({ version: 1, items: [] }));
      } else if (mode === "read-only") await chmod(f.project.path, 0o444);
      let calls = 0;
      await assert.rejects(f.store.save(update, snapshot, `protected-${mode}`, { authorize: async () => {
        if (mode === "pin-race" && ++calls === 2) {
          const manifest = join(f.cwd, ".pi/hermes-skills/manifest.json");
          const records = JSON.parse(await readFile(manifest, "utf8")); records[0].pinned = true;
          await writeFile(manifest, JSON.stringify(records));
        }
      } }), mode === "provenance" ? /provenance missing/ : mode === "pin-race" ? /pinned/ : /Read-only/);
      assert.equal(await readFile(f.project.path, "utf8"), before); assert.equal(f.calls.length, 0);
    } finally { f.session.dispose(); }
  }
});
