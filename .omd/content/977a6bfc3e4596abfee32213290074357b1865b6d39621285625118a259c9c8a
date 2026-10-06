import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { captureSnapshot } from "../src/context.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { reviewSkills } from "../src/review.ts";
import { reviewStatus } from "../src/ui.ts";
import { isolatedSession } from "./support.ts";

const usage: Usage = { input: 100, output: 10, cacheRead: 20, cacheWrite: 5, reasoning: 3, totalTokens: 135,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function fixture() {
  const f = await isolatedSession();
  const model = f.runtime.getModel("hermes-test", "fake")!;
  f.session.sessionManager.appendMessage({ role: "user", content: "Temporary task, no reusable finding", timestamp: 1 });
  const snapshot = captureSnapshot({ sessionManager: f.session.sessionManager, cwd: f.cwd, model,
    getSystemPrompt: () => "No permanent rule was learned" });
  const store = new ManagedSkillStore(f.agentDir, f.cwd);
  const ledger = new ReviewLedger(f.agentDir);
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text: '{"skills":[]}' }], stopReason: "stop", timestamp: 2, usage };
  return { ...f, snapshot, store, ledger, message };
}

test("foreign contention after real review admission blocks the provider, preserves reservation and later recovers unknown", async t => {
  const f = await fixture(); let calls = 0;
  let holder: ReturnType<typeof spawn> | undefined;
  const lockPath = join(f.ledger.root, "ledger.lock");
  class ContendedLedger extends ReviewLedger {
    override async admit(...args: Parameters<ReviewLedger["admit"]>) {
      const record = await super.admit(...args);
      const path = new URL("../src/files.ts", import.meta.url).href;
      // Hold a real foreign transaction between admission and running, not a synthetic thrown error.
      holder = spawn(process.execPath, ["--input-type=module", "-e", `import {withLock} from ${JSON.stringify(path)};
        await withLock(${JSON.stringify(lockPath)},async()=>{
          process.send('held'); await new Promise(resolve=>process.once('message',resolve)); process.disconnect();
        });`], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      await new Promise<void>((resolve, reject) => {
        holder!.once("message", () => resolve()); holder!.once("error", reject);
        holder!.once("exit", code => reject(new Error(`Foreign holder exited before release: ${code}`)));
      });
      return record;
    }
  }
  const release = async () => {
    const child = holder; holder = undefined;
    if (!child) return;
    const exited = new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
    child.send("release"); assert.equal(await exited, 0);
  };
  const registry = { streamSimple: () => { calls++; throw new Error("Provider must remain blocked"); } };
  try {
    await assert.rejects(reviewSkills({ ...f, ledger: new ContendedLedger(f.agentDir), registry }), /EEXIST.*ledger\.lock/);
    assert.equal(calls, 0); assert.equal(f.calls.length, 0);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).pid, holder!.pid, "Failed running cannot remove foreign lock");
    const reserved = JSON.parse(await readFile(join(f.ledger.root, "ledger.json"), "utf8")) as Awaited<ReturnType<ReviewLedger["inspect"]>>;
    assert.equal(reserved.records.length, 1); const record = reserved.records[0]!;
    assert.equal(record.status, "admitted"); assert.equal(record.usageUnknown, true);
    assert.ok(record.reservation.input > 0); assert.equal(record.reservation.output, 4096);
    assert.equal(record.usage, undefined); assert.deepEqual(record.saved, []);
    const status = reviewStatus(reserved, f.snapshot.sessionId);
    assert.equal(status.errors, 1); assert.equal(status.jobs, 1);
    assert.equal(status.unresolvedInput, record.reservation.input); assert.equal(status.unresolvedOutput, 4096);
    await release();
    await assert.rejects(reviewSkills({ ...f, registry }), /already running or unresolved/);
    assert.equal(calls, 0); assert.deepEqual(await f.store.catalog(), []);
    t.mock.timers.enable({ apis: ["Date"], now: record.started + 100001 });
    const recovered = await new ReviewLedger(f.agentDir).inspect();
    assert.equal(recovered.records.length, 1); assert.equal(recovered.records[0]!.id, record.id);
    assert.equal(recovered.records[0]!.status, "failed"); assert.equal(recovered.records[0]!.reason, "interrupted-usage-unknown");
    assert.equal(recovered.records[0]!.usageUnknown, true); assert.deepEqual(recovered.records[0]!.reservation, record.reservation);
    assert.equal(recovered.paused, "interrupted-usage-unknown");
    await assert.rejects(reviewSkills({ ...f, registry }), /already handled/);
    await assert.rejects(f.ledger.admit({ ...f.snapshot, digest: "later" }, f.snapshot.model!, 100), /paused/);
    assert.equal(calls, 0); assert.equal((await f.ledger.inspect()).records.length, 1);
  } finally { t.mock.timers.reset(); await release(); f.session.dispose(); }
});

test("empty, reasoning-only, malformed, incomplete and failed outputs never add a request", async () => {
  for (const kind of ["empty", "thinking", "json", "length", "error", "tool", "recursive", "evidence"] as const) {
    const f = await fixture(); let calls = 0;
    try {
      const message: AssistantMessage = { ...f.message,
        content: kind === "empty" ? [] : kind === "thinking" ? [{ type: "thinking", thinking: "No change" }]
          : kind === "tool" ? [{ type: "text", text: '{"skills":[]}' }, { type: "toolCall", id: "denied-tool", name: "hermes-review", arguments: { operation: "run" } }]
          : [{ type: "text", text: kind === "json" ? "not JSON" : kind === "recursive" ? '{"operation":"hermes-review run"}' :
            kind === "evidence" ? JSON.stringify({ skills: [{ action: "create", scope: "project", name: "unsupported", description: "Rule", body: "Tests passed",
              reason: "Model assertion", evidence: [{ entryId: "not-in-snapshot", quote: "Tests passed" }] }] }) : '{"skills":[]}' }],
        stopReason: kind === "length" ? "length" : kind === "error" ? "error" : "stop" };
      const result = await reviewSkills({ ...f, registry: { streamSimple: (_model, context, options) => {
        calls++; assert.equal(context.tools, undefined); assert.equal(options?.toolChoice, "none"); assert.equal(options?.maxRetries, 0); assert.equal(options?.maxTokens, 4096);
        const stream = createAssistantMessageEventStream(); stream.end(message); return stream;
      } } });
      assert.equal(calls, 1);
      assert.equal(result.status, ["empty", "thinking"].includes(kind) ? "no-proposal" : "failed");
      assert.deepEqual(result.reportedUsage, usage);
      assert.equal((await f.ledger.inspect()).records.length, 1); assert.deepEqual(await f.store.catalog(), []);
      assert.equal(f.calls.length, 0, "no executable foreground tool/model loop is entered");
    } finally { f.session.dispose(); }
  }
});

test("partial thrown usage is retained as unknown, reserved and paused", async () => {
  const f = await fixture(); let calls = 0;
  try {
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => {
      calls++; throw Object.assign(new Error("disconnect"), { usage: { input: 17 } });
    } } });
    assert.equal(calls, 1); assert.equal(result.status, "failed");
    assert.equal(result.usageUnknown, true);
    assert.deepEqual(result.reportedUsage, { input: 17 });
    assert.ok(result.reservation.input > 0);
    assert.ok((await f.ledger.inspect()).paused);
  } finally { f.session.dispose(); }
});

test("missing usage is not free and blocks a subsequent request", async () => {
  const f = await fixture(); let calls = 0;
  try {
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => {
      calls++; const stream = createAssistantMessageEventStream();
      stream.end({ ...f.message, usage: { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } });
      return stream;
    } } });
    assert.equal(result.usageUnknown, true); assert.ok(result.reservation.input > 0);
    await assert.rejects(f.ledger.admit({ ...f.snapshot, digest: "later" }, f.snapshot.model!, 100), /paused/);
    assert.equal(calls, 1);
  } finally { f.session.dispose(); }
});

test("provider ignoring abort is bounded; late usage updates only the old request", async () => {
  const f = await fixture(); const stream = createAssistantMessageEventStream(); let calls = 0;
  let resolveLate!: () => void;
  const late = new Promise<void>(resolve => { resolveLate = resolve; });
  class ObservedLedger extends ReviewLedger {
    override async finish(...args: Parameters<ReviewLedger["finish"]>) {
      const result = await super.finish(...args);
      if (args[4] === "late-usage-only") resolveLate();
      return result;
    }
  }
  const ledger = new ObservedLedger(f.agentDir);
  try {
    const result = await reviewSkills({ ...f, ledger, timeoutMs: 10,
      registry: { streamSimple: () => { calls++; return stream; } } });
    assert.equal(result.status, "failed"); assert.equal(result.usageUnknown, true);
    stream.end(f.message);
    await late;
    const record = (await ledger.inspect()).records[0]!;
    assert.equal(record.status, "failed", "late response does not revive the job");
    assert.equal(record.usageUnknown, false); assert.deepEqual(record.usage, usage);
    assert.deepEqual(record.saved, []); assert.deepEqual(await f.store.catalog(), []);
    assert.equal(calls, 1);
  } finally { f.session.dispose(); }
});

test("reasoning is an output subset; duplicate final callbacks do not double charge", async () => {
  const f = await fixture();
  try {
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => {
      const stream = createAssistantMessageEventStream(); stream.end(f.message); return stream;
    } } });
    assert.equal(result.usage?.output, 10); assert.equal(result.usage?.reasoning, 3);
    await f.ledger.finish(result.id, "saved", { ...usage, output: 999 }, ["phantom"]);
    const record = (await f.ledger.inspect()).records[0]!;
    assert.equal(record.status, "no-change"); assert.equal(record.usage?.output, 10);
    assert.deepEqual(record.saved, []);
  } finally { f.session.dispose(); }
});

test("large effective context is explicitly skipped by the conservative estimate", async () => {
  const f = await fixture(); let calls = 0;
  try {
    f.snapshot.messages.push({ role: "user", content: "release check context ".repeat(4000), timestamp: 3 });
    f.snapshot.digest = "large-effective-context";
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => { calls++; throw new Error("must not call"); } } });
    assert.equal(result.status, "skipped"); assert.equal(result.reason, "skipped-budget");
    assert.equal(result.estimateKind, "utf8-bytes-as-token-upper-estimate"); assert.equal(calls, 0);
  } finally { f.session.dispose(); }
});
