import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ReviewLedger } from "../src/ledger.ts";
import type { Usage } from "@earendil-works/pi-ai";

const model = { provider: "fake", id: "fake" };
const snapshot = { sessionId: "fixture", cwd: "/var/tmp/fixture", digest: "same" };
const usage: Usage = { input: 30, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 37,
  cost: { input: .1, output: .1, cacheRead: 0, cacheWrite: 0, total: .2 } };

function child(agentDir: string, finish = false, digest = snapshot.digest, joint = false): Promise<{ output: string; code: number | null }> {
  const path = new URL("../src/ledger.ts", import.meta.url).href;
  const code = `import {ReviewLedger} from ${JSON.stringify(path)};
    import {appendFile} from 'node:fs/promises';
    const ledger=new ReviewLedger(${JSON.stringify(agentDir)});
    try { const r=await ledger.admit(${JSON.stringify({ ...snapshot, digest })},${JSON.stringify(model)},100,Date.now(),undefined,${joint ? JSON.stringify({ boundary: "shared-boundary", owner: "skills", targets: ["skills", "memory"] }) : "undefined"});
      await ledger.running(r.id); await appendFile(${JSON.stringify(join(agentDir, "calls"))},r.id+'\\n');
      ${finish ? `await ledger.finish(r.id,'no-change',${JSON.stringify(usage)},[],undefined,false);` : ""}
      console.log(JSON.stringify({admitted:r.id}));
    }catch(error){console.log(JSON.stringify({blocked:String(error)}));}`;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errors = "";
    p.stdout.on("data", data => { output += data; });
    p.stderr.on("data", data => { errors += data; });
    p.on("error", reject); p.on("close", code => resolve({ output: output + errors, code }));
  });
}

test("two processes cannot spend the same reservation or resend a finished snapshot", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-ledger-race-");
  const ledger = new ReviewLedger(dir); await ledger.inspect();
  const results = await Promise.all([child(dir, true), child(dir, true)]);
  assert.ok(results.every(r => r.code === 0));
  assert.equal(results.filter(r => r.output.includes('"admitted"')).length, 1);
  const calls = (await readFile(join(dir, "calls"), "utf8")).trim().split("\n");
  assert.equal(calls.length, 1);
  assert.equal((await ledger.inspect()).records.length, 1);
  await assert.rejects(new ReviewLedger(dir).admit(snapshot, model, 100), /already handled/);
});

test("joint boundary deduplicates different goal digests across processes and reload", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-joint-ledger-");
  const ledger = new ReviewLedger(dir); await ledger.inspect();
  const results = await Promise.all([child(dir, true, "goal-a", true), child(dir, true, "goal-b", true)]);
  assert.ok(results.every(row => row.code === 0)); assert.equal(results.filter(row => row.output.includes('"admitted"')).length, 1);
  assert.equal((await readFile(join(dir, "calls"), "utf8")).trim().split("\n").length, 1);
  const state = await new ReviewLedger(dir).inspect(); assert.equal(state.records.length, 1);
  assert.deepEqual(state.records[0]!.targets, ["skills", "memory"]);
  await assert.rejects(new ReviewLedger(dir).admit({ ...snapshot, digest: "late-goal" }, model, 100, Date.now(), undefined,
    { boundary: "shared-boundary", owner: "memory", targets: ["memory"] }), /already handled/);
});

test("dead request owner becomes unresolved usage; restart neither replays nor releases", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-ledger-crash-");
  const result = await child(dir);
  assert.equal(result.code, 0);
  assert.ok(result.output.includes('"admitted"'));
  const recovered = await new ReviewLedger(dir).inspect();
  assert.equal(recovered.records.length, 1);
  const record = recovered.records[0]!;
  assert.equal(record.status, "failed");
  assert.equal(record.usageUnknown, true);
  assert.equal(record.reservation.input, 100);
  assert.equal(record.reason, "interrupted-usage-unknown");
  assert.ok(recovered.paused);
  await assert.rejects(new ReviewLedger(dir).admit({ ...snapshot, digest: "next" }, model, 100), /paused/);
  assert.equal((await readFile(join(dir, "calls"), "utf8")).trim().split("\n").length, 1);
});

test("late over-reservation usage after explicit resume pauses again without another charge", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-ledger-late-over-");
  const ledger = new ReviewLedger(dir), admitted = await ledger.admit(snapshot, model, 100);
  await ledger.running(admitted.id); await ledger.finish(admitted.id, "cancelled", undefined, [], "cancelled");
  await ledger.resume(); assert.equal((await ledger.inspect()).paused, undefined);
  await ledger.finish(admitted.id, "cancelled", { ...usage, input: 200, totalTokens: 207 }, [], "late-usage-only", false);
  const state = await ledger.inspect(); assert.equal(state.records.length, 1);
  assert.equal(state.records[0]!.status, "cancelled"); assert.equal(state.records[0]!.reason, "cancelled");
  assert.equal(state.records[0]!.usage?.input, 200); assert.match(state.paused ?? "", /usage-over-reservation/);
  await assert.rejects(ledger.admit({ ...snapshot, digest: "next" }, model, 100), /paused/);
});

test("missing or corrupt ledger is not zero-cost initialization", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-ledger-corrupt-");
  const ledger = new ReviewLedger(dir); await ledger.inspect();
  const path = join(dir, "hermes-review/ledger.json");
  const initial = await readFile(path, "utf8");
  await writeFile(path, '{"version":1,"records":[]}');
  await assert.rejects(ledger.admit(snapshot, model, 100), /invalid/);
  assert.equal(await readFile(path, "utf8"), '{"version":1,"records":[]}');
  await writeFile(path, initial); await unlink(path);
  await assert.rejects(ledger.admit(snapshot, model, 100), /missing/);
});

test("dates cannot rewind quota and actual no-change usage stays charged", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-ledger-date-");
  const ledger = new ReviewLedger(dir);
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const r = await ledger.admit({ ...snapshot, digest: String(i) }, model, 100, now + 86400000);
    await ledger.running(r.id); await ledger.finish(r.id, "no-change", usage, [], undefined, false);
  }
  const rewind = await ledger.admit({ ...snapshot, digest: "rewind" }, model, 100, now);
  assert.equal(rewind.status, "skipped");
  assert.equal(rewind.reason, "skipped-budget");
  assert.equal((await ledger.inspect()).records.filter(r => r.status === "no-change").length, 4);
});
