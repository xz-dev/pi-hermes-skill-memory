import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { captureSnapshot } from "../src/context.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { SkillActivityStore } from "../src/activity.ts";
import { isolatedSession } from "./support.ts";

async function fixture(outcome?: "success" | "failure", withdrawSource = false) {
  let allowed = true, reviews = 0, finished!: () => void;
  const reviewed = new Promise<void>(resolve => { finished = resolve; });
  const f = await isolatedSession("fake", { projectRoot: cwd => cwd,
    streamReply: outcome ? context => {
      const last = context.messages.at(-1);
      if (last?.role === "user" && typeof last.content === "string" && last.content.includes("Effective evidence:")) {
        reviews++; if (withdrawSource) allowed = false;
        const evidence = JSON.parse(last.content.split("Effective evidence: ")[1]!) as { entryId: string; text: string }[];
        const source = evidence.find(entry => entry.text.includes(`The task ${outcome} after applying manual-run`))!;
        const message = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "hermes_skill_view")!;
        assert.equal(message.role, "toolResult");
        if (message.role !== "toolResult") throw new Error("Foreground skill read is required");
        const read = JSON.parse(message.content.filter(part => part.type === "text").map(part => part.text).join(""));
        return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ skills: [], feedback: [{ id: read.id, version: read.version, use: true,
          outcome, evidence: [{ entryId: source.entryId, quote: `The task ${outcome} after applying manual-run` }] }] }) }] };
      }
      const user = context.messages.findLastIndex(message => message.role === "user"), results = context.messages.slice(user + 1).filter(message => message.role === "toolResult");
      if (!results.length) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "search-task", name: "hermes_skill_search", arguments: {} }] };
      const result = JSON.parse(results.at(-1)!.content.filter(part => part.type === "text").map(part => part.text).join(""));
      if (results.at(-1)!.toolName === "hermes_skill_search") return { stopReason: "toolUse", content: [{ type: "toolCall", id: "read-task", name: "hermes_skill_view", arguments: { id: result.items[0].id } }] };
      return { stopReason: "stop", content: [{ type: "text", text: "Foreground task finished" }] };
    } : undefined,
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
      skills: allowed ? loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills : [] }) });
  const path = join(f.cwd, ".pi/skills/manual-run/SKILL.md"); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "---\nname: manual-run\ndescription: Manual project procedure\n---\n\nUse the documented procedure.\n");
  const notices: string[] = [], ui = f.session.extensionRunner.createCommandContext().ui;
  await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, notify: text => notices.push(text), setStatus: () => {}, setWidget: () => {} } });
  f.onReviewState(state => { if (state.paused || state.records.at(-1)?.reason?.includes("model-reports:1")) finished(); });
  await f.session.prompt("/hermes-skills refresh");
  const tools = f.session.agent.state.tools;
  const hit = (await tools.find(tool => tool.name === "hermes_skill_search")!.execute("search-main", {})).details.items[0]!;
  const inspect = async () => { notices.length = 0; await f.session.prompt(`/hermes-skills inspect ${hit.id}`); return JSON.parse(notices.at(-1)!); };
  return { ...f, path, notices, hit, inspect, reviewed, reviews: () => reviews, view: tools.find(tool => tool.name === "hermes_skill_view")! };
}

test("foreground viewing and explicit user outcomes are distinct; pin preserves user-owned bytes and searchability", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.path, "utf8");
    await f.view.execute("read-main", { id: f.hit.id });
    const viewed = await f.inspect();
    assert.ok(viewed.activity, JSON.stringify(viewed));
    assert.equal(viewed.activity.views, 1); assert.equal(viewed.activity.userUses, 0);
    assert.equal(viewed.activity.reportedSuccess, 0); assert.equal(viewed.activity.confirmedSuccess, 0);
    await f.session.prompt(`/hermes-skills use ${f.hit.id} Applied the documented procedure`);
    await f.session.prompt(`/hermes-skills outcome ${f.hit.id} failure The task failed despite using the skill`);
    const outcome = await f.inspect();
    assert.equal(outcome.activity.userUses, 1); assert.equal(outcome.activity.confirmedFailure, 1); assert.equal(outcome.activity.confirmedSuccess, 0);
    await f.session.prompt(`/hermes-skills pin ${f.hit.id}`);
    const pinned = await f.inspect(); assert.equal(pinned.skill.pinned, true); assert.equal(pinned.skill.owner, "user-owned");
    const hits = (await f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_search")!.execute("search-pinned", {})).details.items;
    assert.equal(hits[0]!.id, f.hit.id); assert.equal(await readFile(f.path, "utf8"), before); assert.equal(f.calls.length, 0);
    await f.session.prompt(`/hermes-skills unpin ${f.hit.id}`); assert.equal((await f.inspect()).skill.pinned, false);
  } finally { f.session.dispose(); }
});

test("model reports with read-version evidence remain unconfirmed and replay does not inflate counters", async () => {
  const f = await fixture();
  try {
    const read = (await f.view.execute("read-feedback", { id: f.hit.id })).details;
    const manager = f.session.sessionManager;
    manager.appendMessage({ role: "toolResult", toolCallId: "read-feedback", toolName: "hermes_skill_view", isError: false,
      content: [{ type: "text", text: JSON.stringify(read) }], timestamp: 1 });
    const entryId = manager.appendMessage({ role: "user", content: "The task failed after applying manual-run", timestamp: 2 });
    const snapshot = captureSnapshot(f.session.extensionRunner.createContext());
    const activity = new SkillActivityStore(f.agentDir);
    const feedback = { id: f.hit.id, version: read.version, use: true, outcome: "failure" as const,
      evidence: [{ entryId, quote: "The task failed after applying manual-run" }] };
    await activity.report(feedback, snapshot); await activity.report(feedback, snapshot);
    const path = join(f.agentDir, "hermes-skills/provenance/activity/state.json"), persisted = JSON.parse(await readFile(path, "utf8"));
    persisted.seen.push(...Array.from({ length: 5000 }, (_, index) => index.toString(16).padStart(64, "0")));
    await writeFile(path, JSON.stringify(persisted));
    const restarted = new SkillActivityStore(f.agentDir);
    await restarted.report({ ...feedback, evidence: [...feedback.evidence, ...feedback.evidence] }, snapshot);
    const failed = await f.inspect();
    assert.equal(failed.activity.views, 1); assert.ok(failed.activity.dedup.retained > 4096); assert.equal(failed.activity.dedup.complete, true);
    assert.equal(failed.activity.reportedUses, 1); assert.equal(failed.activity.reportedFailure, 1);
    assert.equal(failed.activity.confirmedSuccess, 0); assert.equal(failed.activity.confirmedFailure, 0);
    assert.equal(failed.activity.journal.at(-1).origin, "model-report");
    await assert.rejects(activity.report({ ...feedback, id: "different-skill" }, snapshot), /not read/);
    await assert.rejects(activity.report({ ...feedback, evidence: [{ entryId, quote: "Invented tests passed" }] }, snapshot), /not in effective/);
    const controller = new AbortController(); let entered!: () => void, release!: () => void;
    const authorization = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const cancelled = activity.report({ ...feedback, outcome: "success" }, snapshot, () => !controller.signal.aborted, "cancelled-feedback",
      () => { entered(); return authorization; }, controller.signal);
    await started; controller.abort(); await assert.rejects(cancelled);
    assert.equal((await activity.inspect(f.hit.id)).reportedSuccess, 0);
    await f.session.prompt(`/hermes-skills pin ${f.hit.id}`); assert.equal(await activity.pinned(f.hit.id), true, "cancelled controlled writer releases its lock");
    release(); await authorization; assert.equal((await activity.inspect(f.hit.id)).reportedSuccess, 0);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []); assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

for (const outcome of ["failure", "success"] as const) {
  test(`one registered SDK review publishes reported ${outcome}, not user-confirmed success; pin gates the actual writer`, { timeout: 10000 }, async () => {
    const f = await fixture(outcome);
    try {
      const before = await readFile(f.path, "utf8");
      await f.session.prompt(`Read and apply manual-run. The task ${outcome} after applying manual-run`);
      const viewed = await f.inspect(); assert.equal(viewed.activity.views, 1); assert.equal(viewed.activity.reportedUses, 0);
      const mainCalls = f.calls.length;
      await f.session.prompt("/hermes-review run"); await f.reviewed;
      const report = await f.inspect();
      assert.equal(report.activity.views, 1, "review self-read did not execute foreground view or inflate its count");
      assert.equal(report.activity.reportedUses, 1); assert.equal(report.activity[outcome === "success" ? "reportedSuccess" : "reportedFailure"], 1);
      assert.equal(report.activity.confirmedSuccess, 0); assert.equal(report.activity.confirmedFailure, 0);
      assert.equal(f.reviews(), 1); assert.equal(f.calls.length, mainCalls + 1);
      const ledger = new ReviewLedger(f.agentDir), records = (await ledger.inspect()).records;
      assert.equal(records.length, 1); assert.equal(report.activity.journal.find((event: { kind: string }) => event.kind === "report").requestId, records[0]!.id);
      assert.equal(records[0]!.usage?.totalTokens, 128); assert.match(records[0]!.reason!, /unconfirmed/);
      const accounting = JSON.stringify(records);
      await f.session.prompt(`/hermes-skills outcome ${f.hit.id} success User explicitly verified the task result`);
      assert.equal((await f.inspect()).activity.confirmedSuccess, 1);
      await f.session.prompt(`/hermes-skills pin ${f.hit.id}`);
      const snapshot = captureSnapshot(f.session.extensionRunner.createContext());
      const evidence = snapshot.evidence.find(entry => entry.text.includes(`The task ${outcome} after applying manual-run`))!;
      const proposal = { action: "update", scope: "project", id: f.hit.id, name: "manual-run", baseVersion: report.skill.version,
        description: "Manual project procedure", body: "Replacement", reason: "No automatic overwrite of pin",
        evidence: [{ entryId: evidence.entryId, quote: `The task ${outcome} after applying manual-run` }] };
      const managed = f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_manage")!;
      const denied = await managed.execute("pin-denied", { proposal }); assert.equal(denied.details.status, "conflict");
      assert.match(denied.details.reason, /pin/); assert.equal(await readFile(f.path, "utf8"), before);
      assert.equal((await f.inspect()).skill.owner, "user-owned"); assert.equal(f.calls.length, mainCalls + 1);
      assert.equal(JSON.stringify((await ledger.inspect()).records), accounting);
    } finally { f.session.dispose(); }
  });
}

test("paid feedback rechecks allowed sources; withdrawal changes neither success counters nor skill bytes", { timeout: 10000 }, async () => {
  const f = await fixture("success", true);
  try {
    const before = await readFile(f.path, "utf8");
    await f.session.prompt("Apply manual-run. The task success after applying manual-run");
    const calls = f.calls.length;
    await f.session.prompt("/hermes-review run"); await f.reviewed;
    const state = await new ReviewLedger(f.agentDir).inspect();
    assert.equal(state.records.length, 1); assert.equal(state.records[0]!.status, "failed"); assert.equal(state.records[0]!.usage?.totalTokens, 128);
    assert.equal(f.reviews(), 1); assert.equal(f.calls.length, calls + 1);
    const stats = await new SkillActivityStore(f.agentDir).inspect(f.hit.id);
    assert.equal(stats.views, 1); assert.equal(stats.reportedSuccess, 0); assert.equal(stats.confirmedSuccess, 0);
    assert.equal(await readFile(f.path, "utf8"), before);
  } finally { f.session.dispose(); }
});

test("managed pin is independent of ownership and blocks the common store writer until explicit unpin", async () => {
  const f = await fixture();
  try {
    const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Keep the existing project rule", timestamp: 1 });
    const snapshot = captureSnapshot(f.session.extensionRunner.createContext());
    const store = new ManagedSkillStore(f.agentDir, f.cwd);
    const proposal = { action: "create" as const, scope: "project" as const, name: "managed-rule", description: "Project procedure", body: "Existing rule",
      reason: "Fixture setup", evidence: [{ entryId, quote: "Keep the existing project rule" }] };
    const saved = await store.save(proposal, snapshot, "managed-setup"), before = await readFile(saved.path, "utf8");
    await f.session.prompt(`/hermes-skills pin ${saved.id}`);
    const readSnapshot = { ...snapshot, skillReads: [{ id: saved.id, version: saved.version, file: "SKILL.md" }] };
    const update = { ...proposal, action: "update" as const, id: saved.id, baseVersion: saved.version, body: "Never save while pinned" };
    await assert.rejects(store.save(update, readSnapshot, "pin-blocked"), /pinned/);
    assert.equal(await readFile(saved.path, "utf8"), before); assert.equal((await store.ownership(saved.path, "project"))!.pinned, true);
    await f.session.prompt(`/hermes-skills unpin ${saved.id}`);
    assert.equal((await store.ownership(saved.path, "project"))!.pinned, false);
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

test("saturated activity aggregates cannot block skill reading or explicit protection; loss/corruption of pin policy blocks writes", async () => {
  const f = await fixture();
  try {
    await f.view.execute("before-full", { id: f.hit.id });
    const activity = new SkillActivityStore(f.agentDir), directory = join(f.agentDir, "hermes-skills/provenance/activity"), path = join(directory, "state.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    const row = state.skills[f.hit.id];
    for (let i = 0; i < 4000; i++) state.skills[`retired-skill-${i}-${"x".repeat(200)}`] = row;
    await writeFile(path, JSON.stringify(state));
    const bytes = await readFile(path, "utf8"), result = await f.view.execute("still-readable", { id: f.hit.id });
    assert.ok(result.details.content.includes("documented procedure")); assert.equal(await readFile(path, "utf8"), bytes);
    await f.session.prompt("/hermes-skills status");
    assert.match(JSON.parse(f.notices.at(-1)!).activityWarning, /activity not recorded/, "read statistics failure stays queryable");
    await f.session.prompt(`/hermes-skills pin ${f.hit.id}`); assert.equal(await activity.pinned(f.hit.id), true);
    await f.session.prompt(`/hermes-skills unpin ${f.hit.id}`); assert.equal(await activity.pinned(f.hit.id), false);
    const policy = join(directory, "pins.json");
    await unlink(policy); await assert.rejects(activity.assertReady(), /Pin policy missing/);
    await writeFile(policy, "{broken"); await assert.rejects(activity.assertReady());
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("persistent receipts beyond 4096 do not impose a lifetime read or pin limit; counters are not reset", async () => {
  const f = await fixture();
  try {
    await f.view.execute("first-view", { id: f.hit.id });
    const path = join(f.agentDir, "hermes-skills/provenance/activity/state.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.seen = Array.from({ length: 4096 }, (_, i) => i.toString(16).padStart(64, "0"));
    state.skills[f.hit.id].views = 5000; state.skills[f.hit.id].confirmedSuccess = 3;
    await writeFile(path, JSON.stringify(state));
    const read = await f.view.execute("after-full-history", { id: f.hit.id }); assert.ok(read.details.content.includes("documented procedure"));
    await f.session.prompt(`/hermes-skills pin ${f.hit.id}`);
    const result = await f.inspect();
    assert.equal(result.activity.views, 5001); assert.equal(result.activity.confirmedSuccess, 3); assert.equal(result.skill.pinned, true);
    assert.equal(result.activity.dedup.retained, 4097); assert.equal(result.activity.dedup.evicted, 0); assert.equal(result.activity.dedup.complete, true);
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});
