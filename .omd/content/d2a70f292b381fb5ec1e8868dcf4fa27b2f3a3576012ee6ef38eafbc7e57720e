import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFile, readFile, stat } from "node:fs/promises";
import type { ReviewState } from "../src/ledger.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { isolatedSession } from "./support.ts";

async function observed(agentDir: string, predicate: (state: ReviewState) => boolean) {
  for (let i = 0; i < 300; i++) {
    const state = await new ReviewLedger(agentDir).inspect(); if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected durable billing state within 3s");
}

for (const scenario of ["no-change", "empty", "disconnect", "unknown-usage", "unknown-price", "cancel"] as const) test(`registered fee matrix ${scenario}: one request, durable usage and TUI across reload`, async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await isolatedSession("", { projectRoot: cwd => cwd, unknownPrice: scenario === "unknown-price",
    deferReply: () => scenario === "cancel" ? gate : undefined,
    streamReply: () => {
      if (scenario === "disconnect") throw Object.assign(new Error("fixture-disconnected"), { usage: { input: 17 } });
      return { stopReason: "stop", content: scenario === "empty" ? [] : [{ type: "text", text: '{"skills":[]}' }],
        ...(scenario === "unknown-usage" ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) };
    } });
  try {
    f.session.sessionManager.appendMessage({ role: "user", content: "Temporary isolated billing case", timestamp: 1 });
    const statuses = new Map<string, string | undefined>(), widgets = new Map<string, unknown>();
    const ui = f.session.extensionRunner.createContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, setStatus: (key, value) => { statuses.set(key, value); },
      setWidget: (key, value) => { widgets.set(key, value); } } });
    await f.session.prompt("/hermes-review run");
    if (scenario === "cancel") {
      await observed(f.agentDir, state => state.records[0]?.status === "running");
      await f.session.prompt("/hermes-review cancel");
    }
    const before = await observed(f.agentDir, state => state.records[0]?.ended !== undefined), record = before.records[0]!;
    assert.equal(f.calls.length, 1); assert.equal(before.records.length, 1);
    const expected = scenario === "empty" ? "no-proposal" : scenario === "disconnect" ? "failed" : scenario === "cancel" ? "cancelled" : "no-change";
    assert.equal(record.status, expected);
    const unknown = ["disconnect", "unknown-usage", "cancel"].includes(scenario);
    assert.equal(record.usageUnknown, unknown);
    if (unknown) { assert.ok(record.reservation.input > 0); assert.equal(record.reservation.output, 4096); assert.ok(before.paused); }
    else assert.equal(record.usage?.totalTokens, 128);
    if (scenario === "disconnect") {
      // The official ModelRegistry converts a throwing provider into an error AssistantMessage with zero/unknown usage.
      assert.equal(record.reportedUsage?.totalTokens, 0); assert.match(record.reason ?? "", /fixture-disconnected/);
    }
    if (scenario === "unknown-price") assert.equal(record.costUnknown, true);
    await f.session.reload(); await f.session.prompt("/hermes-review status");
    assert.match(statuses.get("hermes-review") ?? "", new RegExp(before.paused ? "PAUSED" : expected));
    if (unknown) assert.match(JSON.stringify(widgets.get("hermes-review")), /usage UNKNOWN reserved/);
    if (scenario === "unknown-price") assert.match(JSON.stringify(widgets.get("hermes-review")), /price UNKNOWN/);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, before.records);
    if (scenario === "cancel") {
      release(); const late = await observed(f.agentDir, state => state.records[0]?.usageUnknown === false);
      assert.equal(late.records[0]!.id, record.id); assert.equal(late.records[0]!.status, "cancelled"); assert.equal(late.records[0]!.usage?.totalTokens, 128);
    }
    assert.equal(f.calls.length, 1); await assert.rejects(stat(join(f.cwd, ".pi/skills/hermes-managed")), /ENOENT/);
  } finally { release(); f.session.dispose(); }
});

test("disabled compaction and shutdown never call the review provider", async () => {
  const f = await isolatedSession("must not be sent", { projectRoot: cwd => cwd });
  try {
    await f.session.prompt("/hermes-review enable"); await f.session.prompt("/hermes-review disable");
    // Exercise public lifecycle emission without requesting Pi's own foreground model compaction.
    await f.session.extensionRunner.emit({ type: "session_before_compact", customInstructions: undefined, signal: new AbortController().signal,
      branchEntries: [], reason: "manual", willRetry: false,
      preparation: { firstKeptEntryId: "isolated-empty", messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 0,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() }, settings: { enabled: false, reserveTokens: 16384, keepRecentTokens: 20000 } } });
    await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    assert.equal(f.calls.length, 0); const state = await new ReviewLedger(f.agentDir).inspect();
    assert.equal(state.autoEnabled, false); assert.deepEqual(state.records, []);
  } finally { f.session.dispose(); }
});

test("submitted request process killed before final usage remains reserved and visible after reload", async () => {
  const f = await isolatedSession("must not be sent", { projectRoot: cwd => cwd });
  try {
    const file = join(f.root, "crash-worker.mjs"), sent = join(f.root, "sent.json");
    await writeFile(file, `import {ReviewLedger} from ${JSON.stringify(new URL("../src/ledger.ts", import.meta.url).href)};
      import {writeFile} from 'node:fs/promises';
      const ledger=new ReviewLedger(${JSON.stringify(f.agentDir)});
      const r=await ledger.admit({digest:'crash',sessionId:'crash-fixture',cwd:${JSON.stringify(f.cwd)}},{provider:'fake',id:'fake'},300);
      await ledger.running(r.id); await writeFile(${JSON.stringify(sent)},JSON.stringify({requestId:r.id,simulatedRequests:1}));
      console.log('sent'); setInterval(()=>{},1000);`);
    const process = spawn(globalThis.process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => { process.once("error", reject); process.stdout.once("data", () => resolve()); process.once("exit", code => { if (code !== null) reject(new Error(`worker exited ${code}`)); }); });
    const exited = new Promise<void>(resolve => process.once("exit", () => resolve())); process.kill("SIGKILL"); await exited;
    const ledger = new ReviewLedger(f.agentDir), state = await ledger.inspect(), record = state.records[0]!;
    assert.equal(record.status, "failed"); assert.equal(record.reason, "interrupted-usage-unknown"); assert.equal(record.reservation.input, 300);
    assert.equal(record.usageUnknown, true); assert.ok(state.paused);
    const statuses = new Map<string, string | undefined>(), ui = f.session.extensionRunner.createContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, setStatus: (key, value) => { statuses.set(key, value); }, setWidget: () => {} } });
    await f.session.reload(); await f.session.prompt("/hermes-review run");
    assert.match(statuses.get("hermes-review") ?? "", /PAUSED/); assert.equal(f.calls.length, 0);
    assert.equal(JSON.parse(await readFile(sent, "utf8")).simulatedRequests, 1); assert.deepEqual((await ledger.inspect()).records, state.records);
  } finally { f.session.dispose(); }
});
