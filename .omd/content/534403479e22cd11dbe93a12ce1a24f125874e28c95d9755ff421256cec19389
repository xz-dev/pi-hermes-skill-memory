import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isolatedSession } from "./support.ts";
import { REVIEW_CHANNEL, REVIEW_COMPATIBILITY, reviewBoundary, boundaryKey } from "../src/cooperation.ts";
import { ReviewLedger } from "../src/ledger.ts";
import type { ReviewOffer } from "../src/cooperation.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { captureSnapshot } from "../src/context.ts";
import { ManagedSkillStore } from "../src/store.ts";

async function terminal(agentDir: string) {
  for (let i = 0; i < 300; i++) {
    const state = await new ReviewLedger(agentDir).inspect();
    if (state.paused || state.records.some(r => r.ended !== undefined || r.status === "skipped")) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("No durable review terminal within 3s");
}

type Peer = "compatible" | "incompatible" | "absent" | "legacy" | "wrong-root" | "wrong-identity" | "wrong-version" | "inactive";
async function fixture(peer: Peer = "compatible", automatic = false) {
  let entryId = "", consumes = 0, gate: Promise<void> | undefined, fresh = true, instruction = 'Return memory:[{text:"Isolated memory peer result",entryId:"current user evidence ID"}].';
  let empty = false, failConsumer = false;
  let peerRequest: (context: ExtensionContext) => Promise<unknown>;
  const abort = new AbortController();
  const f = await isolatedSession("", { projectRoot: cwd => cwd,
    setup: pi => {
      const execute = async () => ({ content: [{ type: "text" as const, text: "Synthetic observation" }], details: undefined });
      pi.registerTool({ name: "joint_check", label: "Joint check", description: "Synthetic check only", parameters: Type.Object({}), execute });
      if (peer === "legacy") pi.registerTool({ name: "hermes_memory", label: "Uncooperative memory double", description: "No network or files", parameters: Type.Object({}), execute });
    },
    deferReply: context => JSON.stringify(context.messages.at(-1)).includes("Effective evidence:") ? gate : undefined,
    streamReply: context => {
      if (automatic && !JSON.stringify(context.messages.at(-1)).includes("Effective evidence:")) {
        const last = context.messages.findLastIndex(m => m.role === "user");
        const count = context.messages.slice(last + 1).filter(m => m.role === "toolResult").length;
        return count < 10 ? { stopReason: "toolUse", content: [{ type: "toolCall", id: `check-${count}`, name: "joint_check", arguments: {} }] } :
          { stopReason: "stop", content: [{ type: "text", text: "Foreground complete" }] };
      }
      return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify(empty ? { skills: [], memory: [] } : { skills: [{ action: "create", scope: "project", name: "build-order",
      description: "Build ordering", body: "Build before manifest check", reason: "Project release rule", procedureTemplate: "build-before-manifest",
      evidence: [{ entryId, quote: "Build before manifest check" }] }], memory: [{ text: "Isolated memory peer result", entryId }] }) }] }; },
    observe: pi => {
      if (peer === "absent" || peer === "legacy") return;
      pi.events.on(REVIEW_CHANNEL, (event: any) => {
        if (event?.type !== "collect" || event.offers.some((offer: ReviewOffer) => offer.target === "memory")) return;
        event.offers.push({ target: "memory", version: peer === "wrong-version" ? 2 : 1, compatibility: ["incompatible", "inactive"].includes(peer) ? "different-fee-policy" : REVIEW_COMPATIBILITY,
          boundary: peer === "wrong-identity" ? { ...event.boundary, cwd: "/var/tmp/unrelated-project" } : event.boundary,
          active: peer !== "inactive", ledgerRoot: join(f.agentDir, ["wrong-root", "inactive"].includes(peer) ? "different-ledger" : "hermes-review"),
          run: async () => {
            const prior = (await new ReviewLedger(f.agentDir).inspect()).records.find(row => row.boundary === boundaryKey(event.boundary));
            if (prior) return prior; // Protocol peer waits for the next boundary, not an independent paid fallback.
            throw new Error("The memory peer cannot start a second owner request");
          },
          memory: { instruction, signal: abort.signal, current: () => fresh && !abort.signal.aborted,
            consume: async (value: unknown, requestId: string, guard: { signal: AbortSignal; isCurrent: () => boolean }) => {
              guard.signal.throwIfAborted(); assert.ok(guard.isCurrent());
              if (failConsumer) throw new Error("fixture-memory-commit-failed");
              if (Array.isArray(value) && !value.length) return { saved: [] };
              assert.deepEqual(value, [{ text: "Isolated memory peer result", entryId }]); consumes++;
              await writeFile(join(f.root, "memory.json"), JSON.stringify({ value, requestId })); return { saved: ["memory:fixture"] };
            } },
        });
      });
      peerRequest = async context => {
        const event = { type: "collect", version: 1, boundary: reviewBoundary(captureSnapshot(context)), offers: [] as ReviewOffer[] };
        pi.events.emit(REVIEW_CHANNEL, event);
        const active = event.offers.filter(offer => offer.active).sort((a, b) => b.target.localeCompare(a.target));
        assert.ok(active.length); return active[0]!.run(active);
      };
      if (automatic) pi.on("agent_settled", async (_event, context) => { await Promise.all([peerRequest(context), peerRequest(context)]); });
    } });
  entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 1 });
  return { ...f, abort, consumes: () => consumes, defer: (value: Promise<void>) => { gate = value; }, stale: () => { fresh = false; },
    empty: () => { empty = true; }, failConsumer: () => { failConsumer = true; },
    instruction: (text: string) => { instruction = text; }, peerRequest: () => peerRequest!(f.session.extensionRunner.createContext()) };
}

for (const peer of ["compatible", "absent", "inactive"] as const) test(`registered review ${peer}: one durable charge and target-owned writes`, async () => {
  const f = await fixture(peer);
  try {
    await f.session.prompt("/hermes-review run"); const state = await terminal(f.agentDir);
    assert.equal(f.calls.length, 1); assert.equal(state.records.length, 1);
    const record = state.records[0]!; assert.equal(record.status, "saved", record.reason);
    assert.deepEqual(record.targets, peer === "compatible" ? ["skills", "memory"] : ["skills"]);
    assert.equal(record.usage?.totalTokens, 128);
    assert.equal((await new ManagedSkillStore(f.agentDir, f.cwd).catalog()).length, 1);
    if (peer === "compatible") {
      assert.equal(f.consumes(), 1); assert.equal(JSON.parse(await readFile(join(f.root, "memory.json"), "utf8")).requestId, record.id);
      assert.ok(record.saved.includes("memory:fixture"));
    } else { assert.equal(f.consumes(), 0); await assert.rejects(stat(join(f.root, "memory.json")), /ENOENT/); }
  } finally { f.session.dispose(); }
});

for (const outcome of ["empty", "consumer-failure"] as const) test(`joint ${outcome} is a single charged terminal, never a paid correction`, async () => {
  const f = await fixture();
  try {
    if (outcome === "empty") f.empty(); else f.failConsumer();
    await f.session.prompt("/hermes-review run"); const state = await terminal(f.agentDir), record = state.records[0]!;
    assert.equal(record.status, outcome === "empty" ? "no-change" : "failed");
    assert.equal(record.usage?.totalTokens, 128); assert.equal(state.records.length, 1); assert.equal(f.calls.length, 1);
    const skills = await new ManagedSkillStore(f.agentDir, f.cwd).catalog();
    assert.equal(skills.length, outcome === "empty" ? 0 : 1, "a failed peer does not falsely roll back the committed skill");
    assert.equal(record.saved.length, skills.length); if (outcome === "consumer-failure") assert.match(state.paused ?? "", /memory-commit-failed/);
    await assert.rejects(stat(join(f.root, "memory.json")), /ENOENT/);
  } finally { f.session.dispose(); }
});

for (const kind of ["cancel", "peer-abort", "peer-stale"] as const) test(`joint ${kind} revokes both consumers; late usage belongs to the original request`, async () => {
  const f = await fixture(); let release!: () => void;
  f.defer(new Promise<void>(resolve => { release = resolve; }));
  try {
    await f.session.prompt("/hermes-review run");
    for (let i = 0; i < 200 && !f.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.calls.length, 1);
    const ledger = new ReviewLedger(f.agentDir), id = (await ledger.inspect()).records[0]!.id;
    if (kind === "cancel") await f.session.prompt("/hermes-review cancel");
    else if (kind === "peer-abort") f.abort.abort(); else f.stale();
    if (kind !== "peer-stale") assert.equal((await terminal(f.agentDir)).records[0]!.status, "cancelled");
    release();
    for (let i = 0; i < 200 && (await ledger.inspect()).records[0]!.usageUnknown; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const state = await terminal(f.agentDir);
    assert.equal(state.records.length, 1); assert.equal(state.records[0]!.id, id); assert.equal(state.records[0]!.status, "cancelled");
    assert.equal(state.records[0]!.usage?.totalTokens, 128); assert.equal(state.records[0]!.usageUnknown, false);
    assert.equal(f.calls.length, 1); assert.equal(f.consumes(), 0);
    assert.equal((await new ManagedSkillStore(f.agentDir, f.cwd).catalog()).length, 0);
    await assert.rejects(stat(join(f.root, "memory.json")), /ENOENT/);
  } finally { release(); f.session.dispose(); }
});

test("both targets due via registered settled events: concurrent and late declarations keep one owner", async () => {
  const f = await fixture("compatible", true);
  try {
    await f.session.prompt("/hermes-review enable"); await f.session.prompt("Perform ten joint checks.");
    const state = await terminal(f.agentDir);
    assert.equal(state.records.length, 1); assert.equal(state.records[0]!.status, "saved", state.records[0]!.reason);
    assert.deepEqual(state.records[0]!.targets, ["skills", "memory"]); assert.equal(f.consumes(), 1);
    assert.equal(f.calls.filter(call => JSON.stringify(call.messages.at(-1)).includes("Effective evidence:")).length, 1);
    const before = await readFile(join(f.root, "memory.json"), "utf8");
    await f.peerRequest(); await f.session.reload(); await f.session.prompt("/hermes-review run");
    assert.equal(f.calls.length, 12); assert.equal(f.consumes(), 1);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, state.records);
    assert.equal(await readFile(join(f.root, "memory.json"), "utf8"), before);
  } finally { f.session.dispose(); }
});

test("joint evidence counts against the same admission budget without truncation", async () => {
  const f = await fixture();
  try {
    f.instruction("x".repeat(70000)); await f.session.prompt("/hermes-review run"); const state = await terminal(f.agentDir);
    assert.equal(state.records[0]!.reason, "skipped-budget"); assert.equal(f.calls.length, 0); assert.equal(f.consumes(), 0);
    assert.deepEqual(state.records[0]!.targets, ["skills", "memory"]);
    assert.equal((await new ManagedSkillStore(f.agentDir, f.cwd).catalog()).length, 0);
  } finally { f.session.dispose(); }
});

for (const peer of ["incompatible", "legacy", "wrong-root", "wrong-identity", "wrong-version"] as const) test(`registered ${peer} peer pauses without charging or either target write`, async () => {
  const f = await fixture(peer);
  try {
    await f.session.prompt("/hermes-review run"); const state = await terminal(f.agentDir);
    assert.match(state.paused ?? "", /protocol-incompatible/); assert.equal(state.records.length, 0); assert.equal(f.calls.length, 0);
    const statuses = new Map<string, string | undefined>(), ui = f.session.extensionRunner.createContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, setStatus: (key, text) => { statuses.set(key, text); }, setWidget: () => {} } });
    await f.session.reload(); await f.session.prompt("/hermes-review status");
    assert.match(statuses.get("hermes-review") ?? "", /PAUSED.*protocol-incompatible/);
    assert.equal((await new ReviewLedger(f.agentDir).inspect()).paused, state.paused);
    assert.equal((await new ManagedSkillStore(f.agentDir, f.cwd).catalog()).length, 0);
    await assert.rejects(stat(join(f.root, "memory.json")), /ENOENT/);
  } finally { f.session.dispose(); }
});
