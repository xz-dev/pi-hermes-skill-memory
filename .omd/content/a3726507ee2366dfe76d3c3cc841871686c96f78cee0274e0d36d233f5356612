import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, access, mkdir, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { captureSnapshot } from "../src/context.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { reviewSkills } from "../src/review.ts";
import { isolatedSession } from "./support.ts";

async function interrupted(unknownUsage = false) {
  const f = await isolatedSession("fake", {
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
      skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills, diagnostics: [] }),
    streamReply: context => {
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(m => m.role === "toolResult");
      if (!results.length) return { stopReason: "toolUse", content: [{ type: "toolCall", id: "recover-search", name: "hermes_skill_search", arguments: { query: "release ordering" } }] };
      if (results.at(-1)?.toolName === "hermes_skill_search") {
        const hits = JSON.parse(results.at(-1)!.content.filter(c => c.type === "text").map(c => c.text).join(""));
        assert.equal(hits.items.length, 1);
        return { stopReason: "toolUse", content: [{ type: "toolCall", id: "recover-view", name: "hermes_skill_view", arguments: { id: hits.items[0].id } }] };
      }
      assert.ok(JSON.stringify(results.at(-1)).includes("Build before manifest check"));
      return { stopReason: "stop", content: [{ type: "text", text: "Build before manifest check; use the recovered project rule." }] };
    },
  });
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 1 });
  const model = f.runtime.getModel("hermes-test", "fake")!;
  const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model, getSystemPrompt: () => "Fixture project rules" });
  const ledger = new ReviewLedger(f.agentDir), store = new ManagedSkillStore(f.agentDir, f.cwd);
  let calls = 0, current = true, checks = 0;
  let proposal = { action: "create" as "create" | "update", scope: "project", name: "release-check", description: "Release ordering",
    body: "Build before manifest check", reason: "Reusable project correction", id: undefined as string | undefined, baseVersion: undefined as string | undefined,
    evidence: [{ entryId, quote: "Build before manifest check" }] };
  const registry = { streamSimple: () => {
    calls++;
    const message: AssistantMessage = { role: "assistant", model: model.id, provider: model.provider, api: model.api, timestamp: 2, stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ skills: [proposal] }) }],
      usage: { input: unknownUsage ? 0 : 100, output: unknownUsage ? 0 : 10, cacheRead: 0, cacheWrite: 0, totalTokens: unknownUsage ? 0 : 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream(); stream.end(message); return stream;
  } };
  const cancelled = await reviewSkills({ snapshot, ledger, store, registry, isCurrent: () => current,
    authorizeCommit: async () => { if (++checks === 2) current = false; } });
  assert.equal(cancelled.status, "cancelled"); assert.equal(calls, 1);
  const pending = await store.inspectRecovery(); assert.equal(pending.length, 1); assert.equal(pending[0]!.state, "prepared");
  return { ...f, ledger, store, snapshot, registry, cancelled, key: pending[0]!.key, target: pending[0]!.path,
    analysisCalls: () => calls, update: (id: string, baseVersion: string) => { proposal = { ...proposal, action: "update", id, baseVersion, body: "Build before manifest check. Validate the built manifest." }; } };
}

// Interruption must be resolved locally, not discovered after spending another request.
test("cancelled initial creation blocks the next eligible analysis before admission", async () => {
  const f = await interrupted();
  try {
    const next = await reviewSkills({ snapshot: { ...f.snapshot, digest: f.snapshot.digest + "-next-task" }, ledger: f.ledger, store: f.store, registry: f.registry });
    assert.equal(f.analysisCalls(), 1, "unresolved local intent must not consume a second analysis");
    assert.equal(next.status, "skipped"); assert.match(next.reason!, /store-recovery/);
    assert.equal(f.cancelled.usage?.totalTokens, 110); assert.ok((await f.ledger.inspect()).paused);
  } finally { f.session.dispose(); }
});

test("explicit local commit reuses approved staging, then registered tools reuse the rule and the next analysis saves normally", async () => {
  const f = await interrupted();
  try {
    const blocked = await reviewSkills({ snapshot: { ...f.snapshot, digest: f.snapshot.digest + "-blocked-followup" }, ledger: f.ledger, store: f.store, registry: f.registry });
    assert.equal(blocked.status, "skipped"); assert.equal(f.analysisCalls(), 1);
    const before = JSON.stringify((await f.ledger.inspect()).records);
    const ui = f.session.extensionRunner.createCommandContext().ui;
    const details: unknown[] = [];
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd, notify: text => { details.push(JSON.parse(text)); } } });
    await f.session.prompt("/hermes-review recovery");
    await f.session.prompt(`/hermes-review recover ${f.key} commit`);
    assert.ok(JSON.stringify(details).includes('"state":"saved"'));
    assert.equal(f.analysisCalls(), 1); assert.equal(f.calls.length, 0);
    assert.equal(JSON.stringify((await f.ledger.inspect()).records), before, "local recovery must not reclassify usage or replay a request");
    assert.deepEqual(await f.store.inspectRecovery(), []);
    await f.ledger.resume(); // Explicit acknowledgment after local recovery, without resetting any usage.
    await f.session.prompt("Next task: use the recovered release ordering");
    assert.ok(f.session.getLastAssistantText()!.startsWith("Build before manifest check"));
    const saved = (await f.store.search("release ordering"))[0]!; const read = await f.store.view(saved.id);
    f.update(saved.id, read.record.version);
    const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture project rules" });
    const next = await reviewSkills({ snapshot, ledger: f.ledger, store: f.store, registry: f.registry });
    assert.equal(next.status, "saved"); assert.equal(f.analysisCalls(), 2);
    assert.match((await f.store.view(saved.id)).content, /release manifest against the built output/);
  } finally { f.session.dispose(); }
});

test("explicit abort archives prepared bytes, unblocks a fresh creation and never releases unknown usage", async () => {
  const f = await interrupted(true);
  try {
    const reservation = (await f.ledger.inspect()).records[0]!.reservation;
    const result = await f.store.recover(f.key, "abort"); assert.equal(result.state, "aborted");
    assert.equal(f.analysisCalls(), 1); assert.deepEqual(await f.store.inspectRecovery(), []);
    await assert.rejects(access(f.target), /ENOENT/);
    const archived = join(f.cwd, ".pi/hermes-skills/aborted", `${f.cancelled.id}-release-check`, `${f.cancelled.id}.new`);
    assert.match(await readFile(archived, "utf8"), /Build before manifest check/);
    const old = (await f.ledger.inspect()).records[0]!;
    assert.equal(old.status, "cancelled"); assert.equal(old.usageUnknown, true); assert.deepEqual(old.reservation, reservation);
    await f.ledger.resume(); // Explicit acknowledgment keeps the unresolved reservation.
    const next = await reviewSkills({ snapshot: { ...f.snapshot, digest: f.snapshot.digest + "-after-abort" }, ledger: f.ledger, store: f.store, registry: f.registry });
    assert.equal(next.status, "saved"); assert.equal(f.analysisCalls(), 2);
    assert.deepEqual((await f.ledger.inspect()).records[0]!.reservation, reservation);
  } finally { f.session.dispose(); }
});

test("recovery conflicts preserve a manual edit and block subsequent spending", async () => {
  const f = await interrupted();
  try {
    await writeFile(f.target, "New manual content; do not overwrite");
    assert.equal((await f.store.inspectRecovery())[0]!.state, "conflict");
    await assert.rejects(f.store.recover(f.key, "commit"), /version conflict/);
    await assert.rejects(f.store.recover(f.key, "abort"), /version conflict/);
    assert.equal(await readFile(f.target, "utf8"), "New manual content; do not overwrite");
    await reviewSkills({ snapshot: { ...f.snapshot, digest: "conflict-next" }, ledger: f.ledger, store: f.store, registry: f.registry });
    assert.equal(f.analysisCalls(), 1);
  } finally { f.session.dispose(); }
});

test("metadata failure after replacement reports committed content and local recovery finishes metadata, not the model", async () => {
  const f = await interrupted();
  try {
    await f.store.recover(f.key, "abort");
    const snapshot = { ...f.snapshot, digest: "disk-error-next" };
    const manifest = join(f.cwd, ".pi/hermes-skills/manifest.json");
    const savedManifest = join(f.cwd, ".pi/hermes-skills/old-manifest.json");
    await rename(manifest, savedManifest);
    // A valid empty manifest is restored for preflight and replaced with a directory only after preparation.
    await writeFile(manifest, "[]"); let checks = 0;
    const failed = await reviewSkills({ snapshot, ledger: f.ledger, store: f.store, registry: f.registry,
      authorizeCommit: async () => { if (++checks === 2) { await rename(manifest, savedManifest + "-second"); await mkdir(manifest); } } });
    assert.equal(failed.status, "failed"); assert.equal(f.analysisCalls(), 2);
    const pending = await f.store.inspectRecovery(); assert.equal(pending.length, 1); assert.equal(pending[0]!.state, "content-committed");
    const content = await readFile(f.target, "utf8"); assert.match(content, /Build before manifest check/);
    await rename(manifest, manifest + "-blocked-dir");
    await f.store.recover(pending[0]!.key, "commit");
    assert.equal(f.analysisCalls(), 2); assert.equal(await readFile(f.target, "utf8"), content);
    assert.deepEqual(await f.store.inspectRecovery(), []);
  } finally { f.session.dispose(); }
});

test("ignored authorization cancellation exits the writer and releases its lock before local recovery", async () => {
  const f = await interrupted();
  let release!: () => void, entered!: () => void;
  const ignored = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  try {
    await f.store.recover(f.key, "abort");
    let authorizations = 0;
    const pending = reviewSkills({ snapshot: { ...f.snapshot, digest: "ignored-authority" }, ledger: f.ledger, store: f.store, registry: f.registry,
      signal: controller.signal, authorizeCommit: async () => { if (++authorizations === 2) { entered(); await ignored; } },
    });
    await ready; controller.abort(new Error("new-input"));
    const record = await Promise.race([pending, delay(300).then(() => { throw new Error("cancelled review failed to settle"); })]);
    assert.equal(record.status, "cancelled"); assert.equal(record.usage?.totalTokens, 110);
    await assert.rejects(access(join(f.cwd, ".pi/hermes-skills/store.lock")), /ENOENT/, "settlement must not leave the old writer holding its lock");
    await assert.rejects(access(f.target), /ENOENT/);
    const unresolved = (await f.store.inspectRecovery())[0]!;
    const recovered = await Promise.race([f.store.recover(unresolved.key, "commit"), delay(300).then(() => { throw new Error("recovery remained queued behind a supposedly finished writer"); })]);
    assert.equal(recovered.state, "saved");
    assert.equal(f.analysisCalls(), 2, "recovery never replays either metered analysis");
    const current = await readFile(f.target, "utf8"); release(); await delay(20);
    assert.equal(await readFile(f.target, "utf8"), current, "late authorization must not resume the exited writer");
  } finally { release(); f.session.dispose(); }
});
