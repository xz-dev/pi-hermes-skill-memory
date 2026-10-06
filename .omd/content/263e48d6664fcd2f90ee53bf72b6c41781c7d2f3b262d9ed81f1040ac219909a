import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import type { TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReviewLedger, automaticEnabled } from "../src/ledger.ts";
import type { ReviewState } from "../src/ledger.ts";

// Shared default contract: absent switch means enabled only after a valid state read.
test("automaticEnabled: unset is on, explicit choices retained, missing state is not unset", async () => {
  const blank: ReviewState = { version: 1, lastDay: "", records: [], reused: [] };
  assert.equal(automaticEnabled(blank), true);
  assert.equal(automaticEnabled({ ...blank, autoEnabled: false }), false);
  assert.equal(automaticEnabled({ ...blank, autoEnabled: true }), true);

  const dir = await mkdtemp("/var/tmp/hermes-default-auto-");
  const ledger = new ReviewLedger(dir);
  const initialized = await ledger.inspect();
  assert.equal(initialized.autoEnabled, undefined);
  assert.equal(automaticEnabled(initialized), true, "fresh install has no persisted choice and is enabled");
  const path = join(dir, "hermes-review/ledger.json");
  const saved = await readFile(path, "utf8");
  assert.ok(!JSON.parse(saved).autoEnabled, "reading the effective value never writes a default");

  const paused = JSON.parse(saved) as ReviewState;
  paused.paused = "user-paused";
  const pausedId = "00000000-0000-4000-8000-0000000000aa";
  paused.records.push({ id: pausedId, digest: "d", sessionId: "s", project: "/var/tmp/fixture",
    provider: "p", model: "m", day: "2000-01-01", started: 1, ended: 1, status: "failed",
    reservation: { input: 100, output: 4096 }, usageUnknown: true, costUnknown: true,
    estimateKind: "utf8-bytes-as-token-upper-estimate", saved: [], ownerPid: process.pid });
  await writeFile(path, JSON.stringify(paused));
  const loaded = await ledger.inspect();
  assert.equal(loaded.paused, "user-paused");
  assert.equal(loaded.records[0]!.usageUnknown, true, "unknown reservation stays charged");
  assert.equal(automaticEnabled(loaded), true, "pause and reservations do not disable the unset switch");
  await ledger.resume();
  const resumed = await ledger.inspect();
  assert.equal(resumed.paused, undefined);
  assert.equal(resumed.autoEnabled, undefined, "resume acknowledges failures without setting the switch");
  assert.equal(resumed.records[0]!.usageUnknown, true, "acknowledgment never releases the unknown reservation");
  await writeFile(path, "corrupt fixture");
  await assert.rejects(ledger.inspect(), "corrupt state never reads as unset");
});

// Shared review contract R1/R6: tools are model turns, never extra user requests.
test("three user requests and forty tool-bearing model turns count separately; duplicate events never redispatch", async () => {
  let analyses = 0, resolveReview!: () => void;
  const done = new Promise<void>(resolve => { resolveReview = resolve; });
  const events: TurnEndEvent[] = []; let report: { userTurns?: number; toolTurns?: number } = {};
  const f = await isolatedSession("fake", {
    setup: pi => pi.registerTool({ name: "project_check", label: "Synthetic check", description: "Synthetic check with no effects",
      parameters: Type.Object({}), annotations: { readOnlyHint: true },
      execute: async () => ({ content: [{ type: "text", text: "Observed" }], details: undefined }) }),
    observe: pi => { pi.on("turn_end", event => { if (event.message.role === "assistant" && event.message.content.some(c => c.type === "toolCall")) events.push(structuredClone(event)); }); },
    streamReply: context => {
      const last = context.messages.at(-1);
      if (last?.role === "user" && typeof last.content === "string" && last.content.includes("Effective evidence:")) {
        analyses++; return { stopReason: "stop", content: [{ type: "text", text: '{"skills":[]}' }] };
      }
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const count = context.messages.slice(lastUser + 1).filter(m => m.role === "toolResult").length;
      if (JSON.stringify(context.messages[lastUser]).includes("forty checks") && count < 40) {
        assert.equal(analyses, 0, "eligibility must not dispatch during the foreground tool loop");
        return { stopReason: "toolUse", content: [{ type: "toolCall", id: `check-${count}`, name: "project_check", arguments: {} }] };
      }
      return { stopReason: "stop", content: [{ type: "text", text: "Foreground stable" }] };
    },
  });
  try {
    const ui = f.session.extensionRunner.createCommandContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd,
      notify: text => { report = JSON.parse(text); },
    } });
    f.onReviewState(state => { if (["no-change", "skipped"].includes(state.records.at(-1)?.status ?? "")) resolveReview(); });
    await f.session.prompt("/hermes-review enable");
    await f.session.prompt("First user request, no tools needed");
    await f.session.prompt("Second user request, clarify the project task");
    await f.session.prompt("Third user request: run forty checks before finishing");
    await Promise.race([done, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("settled review did not complete")), 2000); timer.unref();
    })]);
    const diagnostic = await new ReviewLedger(f.agentDir).inspect();
    assert.equal(analyses, 1, JSON.stringify(diagnostic.records.map(r => ({ status: r.status, reason: r.reason, reservation: r.reservation })))); assert.equal(events.length, 40);
    const duplicate = structuredClone(events[0]!);
    await f.session.extensionRunner.emitBoundary(duplicate, () => duplicate.context);
    await f.session.extensionRunner.emitBoundary(duplicate, () => duplicate.context);
    await f.session.extensionRunner.emit({ type: "agent_settled" });
    await f.session.extensionRunner.emit({ type: "agent_settled" });
    await f.session.prompt("/hermes-review status");
    assert.equal(report.userTurns, 3); assert.equal(report.toolTurns, 40);
    assert.equal(analyses, 1);
    assert.equal((await new ReviewLedger(f.agentDir).inspect()).records.length, 1);
    assert.equal(f.session.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length, 3);
  } finally { f.session.dispose(); }
});
