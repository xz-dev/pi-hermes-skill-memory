import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { captureSnapshot } from "../src/context.ts";
import { isolatedSession } from "./support.ts";

function readMessage(id: string, version: string) {
  return { role: "toolResult" as const, toolCallId: "read", toolName: "hermes_skill_view", isError: false, timestamp: 1,
    content: [{ type: "text" as const, text: JSON.stringify({ id, file: "SKILL.md", version, content: "Read procedure", nextOffset: null }) }] };
}

test("snapshot uses only active branch, effective edits and retained compaction/read evidence", () => {
  const manager = SessionManager.inMemory("/var/tmp/hermes-snapshot-test");
  const root = manager.appendMessage({ role: "user", content: "Shared starting rule", timestamp: 1 });
  manager.appendMessage(readMessage("abandoned-global", "a".repeat(64)));
  manager.appendMessage({ role: "user", content: "Abandoned branch secret", timestamp: 2 });
  manager.branch(root);
  const old = manager.appendMessage({ role: "user", content: "Old summarized secret", timestamp: 3 });
  manager.appendMessage(readMessage("summarized-skill", "b".repeat(64)));
  const kept = manager.appendMessage({ role: "user", content: "Current complete retained task", timestamp: 4 });
  const compact = manager.appendCompaction("Summary: retain the reusable release constraint", kept, 5000);
  const read = manager.appendMessage(readMessage("project-stable-id", "c".repeat(64)));
  const tail = manager.appendMessage({ role: "user", content: "Old visible tail", timestamp: 5 });
  manager.appendContextEdit(tail, { content: "Effective replacement tail" });
  const snapshot = captureSnapshot({ cwd: manager.getCwd(), sessionManager: manager, model: undefined,
    getSystemPrompt: () => "Authoritative current system" });
  const text = JSON.stringify(snapshot.messages);
  assert.ok(text.includes("Authoritative current system")); assert.ok(text.includes("Summary: retain"));
  assert.ok(text.includes("Current complete retained task")); assert.ok(text.includes("Effective replacement tail"));
  for (const forbidden of ["Abandoned branch secret", "Old summarized secret", "Old visible tail", "summarized-skill", "abandoned-global"]) assert.ok(!text.includes(forbidden));
  assert.deepEqual(snapshot.skillReads, [{ id: "project-stable-id", file: "SKILL.md", version: "c".repeat(64) }]);
  assert.equal(snapshot.contextState.compaction?.id, compact); assert.equal(snapshot.contextState.compaction?.firstKeptEntryId, kept);
  assert.ok(snapshot.contextState.entryIds.includes(read)); assert.ok(!snapshot.contextState.entryIds.includes(old));
  assert.equal(snapshot.leafId, manager.getLeafId());
  manager.branch(root);
  const alternate = captureSnapshot({ cwd: manager.getCwd(), sessionManager: manager, model: undefined, getSystemPrompt: () => "Authoritative current system" });
  assert.equal(alternate.contextState.compaction, null); assert.deepEqual(alternate.skillReads, []); assert.notEqual(alternate.digest, snapshot.digest);
});

test("snapshot deep cloning preserves live model, entries, leaf, tools and main session persistence", async () => {
  const f = await isolatedSession();
  try {
    await f.session.prompt("Full current task");
    const manager = f.session.sessionManager, model = f.runtime.getModel("hermes-test", "fake")!;
    manager.appendMessage(readMessage("selected-skill", "d".repeat(64)));
    const leaf = manager.getLeafId(), entries = JSON.stringify(manager.getEntries()), tools = f.session.getActiveToolNames();
    const file = manager.getSessionFile(), originalModel = JSON.stringify(model);
    const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: manager, model, thinkingLevel: "off", getSystemPrompt: () => "Current system with rules" });
    assert.equal(snapshot.model?.id, model.id); assert.equal(snapshot.model?.provider, model.provider); assert.equal(snapshot.thinking, "off");
    snapshot.model!.cost.input = 999; snapshot.messages.length = 0; snapshot.skillReads[0]!.version = "e".repeat(64);
    snapshot.contextState.entryIds.length = 0; snapshot.evidence[0]!.text = "Mutated clone";
    assert.equal(JSON.stringify(model), originalModel); assert.equal(JSON.stringify(manager.getEntries()), entries);
    assert.equal(manager.getLeafId(), leaf); assert.deepEqual(f.session.getActiveToolNames(), tools);
    assert.equal(manager.getSessionFile(), file); assert.equal(f.calls.length, 1);
    const again = captureSnapshot({ cwd: f.cwd, sessionManager: manager, model, getSystemPrompt: () => "Current system with rules" });
    const assistant = manager.getEntries().find(entry => entry.type === "message" && entry.message.role === "assistant");
    assert.ok(assistant?.type === "message" && assistant.message.role === "assistant");
    const persisted = SessionManager.create(f.cwd, join(f.agentDir, "main-session-fixture"));
    persisted.appendMessage({ role: "user", content: "Persisted main task", timestamp: 1 }); persisted.appendMessage(assistant.message);
    const path = persisted.getSessionFile(); assert.ok(path);
    const bytes = await readFile(path), persistedLeaf = persisted.getLeafId();
    captureSnapshot({ cwd: f.cwd, sessionManager: persisted, model, getSystemPrompt: () => "Current persisted system" });
    assert.deepEqual(await readFile(path), bytes); assert.equal(persisted.getLeafId(), persistedLeaf);
    assert.equal(again.skillReads[0]!.version, "d".repeat(64)); assert.ok(again.messages.length > 0);
  } finally { f.session.dispose(); }
});
