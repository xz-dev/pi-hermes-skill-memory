import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewLedger } from "../src/ledger.ts";
import { reviewStatus } from "../src/ui.ts";
import { isolatedSession } from "./support.ts";

test("non-TUI status/errors/resume preserve unresolved fees and never call the model", async () => {
  const f = await isolatedSession(); const ledger = new ReviewLedger(f.agentDir);
  try {
    const record = await ledger.admit({ digest: "unknown-failure", sessionId: f.session.sessionManager.getSessionId(), cwd: f.cwd },
      { provider: "hermes-test", id: "fake" }, 500);
    await ledger.running(record.id);
    await ledger.finish(record.id, "failed", undefined, [], "disconnect");
    const restored = await new ReviewLedger(f.agentDir).inspect();
    const status = reviewStatus(restored, f.session.sessionManager.getSessionId());
    assert.equal(status.errors, 1); assert.equal(status.unresolvedInput, 500);
    assert.equal(status.unresolvedOutput, 4096); assert.equal(status.paused, "disconnect");
    for (const action of ["status", "usage", "errors", "run", "resume"]) await f.session.prompt(`/hermes-review ${action}`);
    assert.ok((await ledger.inspect()).paused, "resume without acknowledgment cannot silently clear failures");
    await f.session.prompt("/hermes-review resume --acknowledge");
    const resumed = await ledger.inspect();
    assert.equal(resumed.paused, undefined);
    assert.equal(resumed.records[0]?.reservation.input, 500);
    assert.equal(resumed.records[0]?.usageUnknown, true);
    assert.ok(resumed.acknowledged?.includes(record.id));
    assert.equal(f.calls.length, 0);
    await f.session.prompt("/hermes-review pause");
    assert.equal((await ledger.inspect()).paused, "user-paused");
  } finally { f.session.dispose(); }
});

test("resume acknowledgment does not release unknown reservations and retry remains deliberate", async () => {
  const f = await isolatedSession(); const ledger = new ReviewLedger(f.agentDir);
  try {
    const record = await ledger.admit({ digest: "d", sessionId: "s", cwd: f.cwd }, { provider: "p", id: "m" }, 500);
    await ledger.running(record.id); await ledger.finish(record.id, "failed", undefined, [], "unknown");
    await ledger.resume();
    const retry = await ledger.admit({ digest: "d", sessionId: "s", cwd: f.cwd }, { provider: "p", id: "m" }, 500, Date.now(), record.id);
    assert.equal(retry.retryOf, record.id);
    assert.notEqual(retry.id, record.id);
    assert.equal((await ledger.inspect()).records.length, 2);
    assert.equal(reviewStatus(await ledger.inspect(), "s").unresolvedInput, 1000);
    await ledger.finish(retry.id, "cancelled", undefined, []);
  } finally { f.session.dispose(); }
});

test("broken UI subscriber cannot cause accounting loss", async () => {
  const f = await isolatedSession(); const ledger = new ReviewLedger(f.agentDir);
  try {
    ledger.subscribe(() => { throw new Error("UI closed"); });
    const record = await ledger.admit({ digest: "ui-closed", sessionId: "s", cwd: f.cwd }, { provider: "p", id: "m" }, 500);
    assert.equal(record.status, "admitted");
    assert.equal((await ledger.inspect()).records[0]?.id, record.id);
    await ledger.finish(record.id, "cancelled", undefined, []);
  } finally { f.session.dispose(); }
});
