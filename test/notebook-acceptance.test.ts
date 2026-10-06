import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { SkillActivityStore } from "../src/activity.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { isolatedSession } from "./support.ts";

// Acceptance through PUBLIC registered tools and actual persisted files, not store-only receipts.
test("ordinary public save → metadata search → read → new-evidence revise preserves same identity and authored text", async () => {
  const results: { tool: string; data: any }[] = [];
  const description = "github-pr-workflow: a passed CI job is not enough to merge";
  const initial = "Do not infer merge readiness solely from CI.", revised = "CI plus required code review decide merge readiness.";
  let phase = 0;
  const f = await isolatedSession("fake", { projectRoot: cwd => cwd,
    observe: pi => pi.on("tool_execution_end", event => { results.push({ tool: event.toolName, data: event.result.details }); }),
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
      skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills }),
    streamReply: context => {
      const userIndex = context.messages.findLastIndex(m => m.role === "user");
      const current = context.messages.slice(userIndex + 1).filter(m => m.role === "toolResult"), last = current.at(-1);
      const entry = f.session.sessionManager.buildSessionProjection().entries.findLast(e => e.sourceEntry.type === "message" && e.sourceEntry.message.role === "user")!;
      const evidence = [{ entryId: entry.sourceEntry.id, quote: phase ? "required code review" : "Review code and CI together" }];
      if (!last && !phase) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "save", name: "hermes_skill_manage", arguments: { proposal: {
        action: "create", scope: "project", name: "ci-review-notes", description, body: initial, reason: "Reusable lesson", evidence,
        files: [{ file: "references/check.txt", content: "Review code and CI together.\n" }],
      } } }] };
      if (!last || last.toolName === "hermes_skill_manage" && !phase) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "find", name: "hermes_skill_search", arguments: { query: "github-pr-workflow", sourceKind: "managed", scope: "project" } }] };
      const data = JSON.parse(last.content.filter(p => p.type === "text").map(p => p.text).join(""));
      if (last.toolName === "hermes_skill_search") {
        assert.equal(data.items.length, 1);
        return { stopReason: "toolUse", content: [{ type: "toolCall", id: "read", name: "hermes_skill_view", arguments: { id: data.items[0].id } }] };
      }
      if (last.toolName === "hermes_skill_view" && phase) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "revise", name: "hermes_skill_manage", arguments: { proposal: {
        action: "update", scope: "project", id: data.id, baseVersion: data.version, name: "ci-review-notes", description,
        body: revised, reason: "New evidence corrects the same note", evidence,
      } } }] };
      return { stopReason: "stop", content: [{ type: "text", text: phase ? revised : initial }] };
    } });
  try {
    await f.session.prompt("Review code and CI together. Save the reusable lesson, find it and read it.");
    const first = results.find(r => r.tool === "hermes_skill_manage")!.data;
    assert.equal(first.status, "saved"); assert.equal(first.auxiliaryModelCalled, false);
    assert.equal(f.session.getLastAssistantText(), initial);
    phase = 1;
    await f.session.prompt("Correction: required code review is also needed. Find and revise the same note.");
    const last = results.filter(r => r.tool === "hermes_skill_manage").at(-1)!.data;
    assert.equal(last.status, "saved"); assert.equal(last.id, first.id); assert.notEqual(last.version, first.version);
    const store = new ManagedSkillStore(f.agentDir, f.cwd), notes = await store.catalog(); assert.equal(notes.length, 1);
    assert.equal(notes[0]!.description, description); assert.equal(notes[0]!.contentProof?.kind, "agent-notes");
    assert.equal(notes[0]!.contentProof?.sources[0]?.role, "user");
    const bytes = await readFile(notes[0]!.path, "utf8"); assert.equal(bytes, `---\nname: ci-review-notes\ndescription: ${JSON.stringify(description)}\n---\n\n${revised}\n`);
    assert.equal(await readFile(join(f.cwd, ".pi/skills/hermes-managed/ci-review-notes/references/check.txt"), "utf8"), "Review code and CI together.\n");
    assert.deepEqual((await new InstalledPermissions(f.agentDir).status()).pending, []);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
    const activity = await new SkillActivityStore(f.agentDir).inspect(first.id); assert.equal(activity.confirmedSuccess, 0); assert.equal(activity.reportedSuccess, 0);
    const history = await store.history(first.id); assert.equal(history.items.length, 2); assert.equal(history.items[0]!.beforeVersion, first.version);
    assert.deepEqual(await readdir(join(f.cwd, ".pi/skills/hermes-managed")), ["ci-review-notes"]);
    assert.ok(!JSON.stringify(notes).includes("relatedSkillId") && !JSON.stringify(notes).includes("parentId"));
    const report = process.env.HERMES_ACCEPTANCE_REPORT;
    if (report) {
      assert.ok(report.startsWith("/var/tmp/"));
      await writeFile(report, JSON.stringify({ root: f.root, id: first.id, beforeVersion: first.version, afterVersion: last.version, description,
        bytes, provenance: notes[0]!.contentProof, history, toolResults: results, providerCalls: f.calls.length,
        auxiliaryRecords: [], pending: [], confirmedSuccess: activity.confirmedSuccess, liveModel: false }, null, 2));
    }
  } finally { f.session.dispose(); }
});
