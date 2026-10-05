import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ReviewLedger } from "../src/ledger.ts";
import { isolatedSession } from "./support.ts";

function reviewText(context: Context) {
  const last = context.messages.at(-1);
  return last?.role === "user" && typeof last.content === "string" && last.content.includes("Effective evidence:") ? last.content : undefined;
}
function correction(text: string) {
  const evidence = JSON.parse(text.split("Effective evidence: ")[1]!) as { entryId: string; text: string }[];
  const source = evidence.find(e => e.text.includes("build before checking the release manifest"))!;
  return JSON.stringify({ skills: [{ action: "create", scope: "project", name: "release-check",
    description: "Check release manifest after build", body: "Build this repo first, then check the release manifest. No deployment authorization.",
    reason: "Reusable project release ordering", evidence: [{ entryId: source.entryId, quote: "build before checking the release manifest" }] }] });
}

test("enabled learning after ten tool-bearing turns saves once, then a new task searches, reads and follows the correction", async () => {
  let reviewCalls = 0, resolveSaved!: () => void;
  const saved = new Promise<void>(resolve => { resolveSaved = resolve; });
  const trace: string[] = [];
  const f = await isolatedSession("fake", {
    setup: pi => pi.registerTool({ name: "project_check", label: "Check project", description: "Synthetic project check; no disk execution",
      parameters: Type.Object({}), annotations: { readOnlyHint: true },
      execute: async () => ({ content: [{ type: "text", text: "Synthetic observation" }], details: undefined }) }),
    observe: pi => pi.on("tool_execution_end", e => { trace.push(e.toolName); }),
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
      skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi", "skills"), source: "project" }).skills, diagnostics: [] }),
    streamReply: context => {
      const review = reviewText(context);
      if (review) { reviewCalls++; return { stopReason: "stop", content: [{ type: "text", text: correction(review) }] }; }
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const current = context.messages.slice(lastUser + 1);
      const results = current.filter(m => m.role === "toolResult");
      const nextTask = JSON.stringify(context.messages[lastUser]).includes("Next task");
      if (!nextTask && results.length < 10) return { stopReason: "toolUse", content: [{ type: "toolCall", id: `check-${results.length}`, name: "project_check", arguments: {} }] };
      if (nextTask && !results.length) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "search-next", name: "hermes_skill_search", arguments: { query: "release manifest" } }] };
      if (nextTask && results.at(-1)?.toolName === "hermes_skill_search") {
        const hits = JSON.parse(results.at(-1)!.content.filter(c => c.type === "text").map(c => c.text).join(""));
        assert.equal(hits.items.length, 1, "the next task must find the automatically saved rule");
        return { stopReason: "toolUse", content: [{ type: "toolCall", id: "read-next", name: "hermes_skill_view", arguments: { id: hits.items[0].id } }] };
      }
      if (nextTask) {
        assert.ok(JSON.stringify(results.at(-1)).includes("Build this repo first"));
        return { stopReason: "stop", content: [{ type: "text", text: "Build this repo first; check release manifest second. This does not authorize deployment." }] };
      }
      return { stopReason: "stop", content: [{ type: "text", text: "Task complete; no further work queued" }] };
    },
  });
  try {
    const ui = f.session.extensionRunner.createCommandContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd,
      setStatus: (key, text) => { if (key === "hermes-review" && text?.includes("| saved")) resolveSaved(); } } });
    await f.session.prompt("/hermes-review enable");
    await f.session.prompt("For this repo, build before checking the release manifest. Perform ten synthetic checks.");
    assert.equal(trace.filter(t => t === "project_check").length, 10);
    await Promise.race([saved, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("automatic learning did not save after eligible settled work")), 1000); timer.unref();
    })]);
    assert.equal(reviewCalls, 1);
    const ledger = new ReviewLedger(f.agentDir); const before = await ledger.inspect();
    assert.equal(before.records.length, 1); assert.equal(before.records[0]!.status, "saved");
    assert.equal(before.records[0]!.usageUnknown, false); assert.equal(before.records[0]!.usage?.totalTokens, 128);
    await f.session.prompt("Next task: What order should this project's release checks run in?");
    assert.deepEqual(trace.slice(-2), ["hermes_skill_search", "hermes_skill_view"]);
    assert.ok(f.session.getLastAssistantText()!.startsWith("Build this repo first"));
    assert.equal(reviewCalls, 1, "retrieval/reuse does not launch another review");
    const state = await ledger.inspect(); assert.equal(state.records.length, 1);
    assert.ok(!f.session.sessionManager.getSessionFile(), "background review does not create a main session file");
  } finally { f.session.dispose(); }
});


async function negativeScenario(kind: "budget" | "source" | "cancel") {
  let failedSource = false, reviews = 0;
  let started!: () => void, release!: () => void, settled!: () => void, reconciled!: () => void;
  const reviewStarted = new Promise<void>(resolve => { started = resolve; });
  const delay = new Promise<void>(resolve => { release = resolve; });
  const terminal = new Promise<void>(resolve => { settled = resolve; });
  const late = new Promise<void>(resolve => { reconciled = resolve; });
  let cancelled = false;
  const f = await isolatedSession("fake", {
    setup: pi => pi.registerTool({ name: "project_check", label: "Check project", description: "Synthetic check",
      parameters: Type.Object({}), annotations: { readOnlyHint: true },
      execute: async () => ({ content: [{ type: "text", text: "Observed" }], details: undefined }) }),
    observe: pi => { pi.on("agent_before_settle", () => { if (kind === "source") failedSource = true; }); },
    skillSources: async request => {
      if (failedSource) throw new Error("fixture-source-disconnect");
      return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
        skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi", "skills"), source: "project" }).skills, diagnostics: [] };
    },
    deferReply: context => {
      if (kind === "cancel" && reviewText(context)) { started(); return delay; }
    },
    streamReply: context => {
      const review = reviewText(context);
      if (review) { reviews++; return { stopReason: "stop", content: [{ type: "text", text: correction(review) }] }; }
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(m => m.role === "toolResult");
      if (!JSON.stringify(context.messages[lastUser]).includes("New task") && results.length < 10) {
        return { stopReason: "toolUse", content: [{ type: "toolCall", id: `check-${results.length}`, name: "project_check", arguments: {} }] };
      }
      return { stopReason: "stop", content: [{ type: "text", text: "Foreground done" }] };
    },
  });
  const ui = f.session.extensionRunner.createCommandContext().ui;
  await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd,
    setStatus: (key, value) => {
      if (key === "hermes-review" && (value?.includes("skipped-budget") || value?.includes("PAUSED source-unavailable") || value?.includes("cancelled"))) {
        if (value.includes("cancelled")) cancelled = true;
        settled();
      }
    },
    setWidget: (key, value) => {
      if (key === "hermes-review" && cancelled && Array.isArray(value) && !value.join().includes("usage UNKNOWN")) reconciled();
    },
  } });
  await f.session.prompt("/hermes-review enable");
  return { ...f, reviewStarted, release, terminal, late, reviewCalls: () => reviews };
}

async function bounded(promise: Promise<void>) {
  await Promise.race([promise, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("expected automatic terminal status was not delivered")), 2000); timer.unref();
  })]);
}

test("eligible over-budget snapshot skips visibly without sending an analysis or saving", async () => {
  const f = await negativeScenario("budget");
  try {
    await f.session.prompt("For this repo, build before checking the release manifest. " + "x".repeat(65000));
    await bounded(f.terminal);
    assert.equal(f.reviewCalls(), 0);
    const records = (await new ReviewLedger(f.agentDir).inspect()).records;
    assert.equal(records.length, 1); assert.equal(records[0]!.reason, "skipped-budget");
    assert.equal(records[0]!.status, "skipped"); assert.equal(records[0]!.reservation.input, 0);
    assert.equal(f.calls.length, 11, "only the foreground ten tool rounds and final reply");
    await assert.rejects(access(join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
  } finally { f.session.dispose(); }
});

test("source failure at eligible settlement blocks analysis and writing and preserves the visible pause", async () => {
  const f = await negativeScenario("source");
  try {
    await f.session.prompt("For this repo, build before checking the release manifest.");
    await bounded(f.terminal);
    assert.equal(f.reviewCalls(), 0);
    const state = await new ReviewLedger(f.agentDir).inspect();
    assert.equal(state.paused, "source-unavailable");
    assert.equal(state.records.length, 1); assert.equal(state.records[0]!.reason, "skipped-source-unavailable");
    const result = await f.session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", {});
    assert.equal(result.details.items.length, 0); assert.match(result.details.diagnostics.join(), /fixture-source-disconnect/);
    await f.session.reload(); await f.session.bindExtensions({ mode: "print" });
    assert.equal((await new ReviewLedger(f.agentDir).inspect()).paused, "source-unavailable");
    await assert.rejects(access(join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
  } finally { f.session.dispose(); }
});

test("new input revokes the active automatic review; ignored abort and late output settle only its original usage", async () => {
  const f = await negativeScenario("cancel");
  try {
    await f.session.prompt("For this repo, build before checking the release manifest.");
    await bounded(f.reviewStarted); assert.equal(f.reviewCalls(), 1);
    await f.session.prompt("New task: do unrelated foreground work without waiting for the old analysis.");
    assert.equal(f.session.getLastAssistantText(), "Foreground done");
    await bounded(f.terminal);
    const ledger = new ReviewLedger(f.agentDir); const cancelled = (await ledger.inspect()).records[0]!;
    assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.usageUnknown, true);
    assert.ok(cancelled.reservation.input > 0); assert.equal(cancelled.saved.length, 0);
    f.release(); await bounded(f.late);
    const state = await ledger.inspect(); assert.equal(state.records.length, 1);
    assert.equal(state.records[0]!.id, cancelled.id); assert.equal(state.records[0]!.status, "cancelled");
    assert.equal(state.records[0]!.usageUnknown, false); assert.equal(state.records[0]!.usage?.totalTokens, 128);
    assert.equal(f.reviewCalls(), 1); assert.deepEqual(state.records[0]!.saved, []);
    await assert.rejects(readFile(join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
  } finally { f.release(); f.session.dispose(); }
});
