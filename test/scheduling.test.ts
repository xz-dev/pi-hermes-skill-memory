import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import type { TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { ReviewLedger } from "../src/ledger.ts";

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
      setStatus: (key, text) => { if (key === "hermes-review" && (text?.includes("| no-change") || text?.includes("| skipped"))) resolveReview(); },
    } });
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
