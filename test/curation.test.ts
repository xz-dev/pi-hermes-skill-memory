import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { captureSnapshot } from "../src/context.ts";
import { ManagedSkillStore, contentHash } from "../src/store.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { SkillArchives } from "../src/archives.ts";
import { stat } from "node:fs/promises";
import { ReviewLedger } from "../src/ledger.ts";

test("explicit semantic curation pays once, requires exact local approval, and preserves absorbed members in a restorable archive", async () => {
  const f = await fixture();
  try {
    const keep = await f.store.save(f.proposal, f.snapshot, "keep-seed");
    const absorb = await f.store.save({ ...f.proposal, name: "release-assets", body: "Check the release artifact.",
      files: [{ file: "references/check.md", content: "Asset-specific checklist" }] }, f.snapshot, "absorb-seed");
    const before = await readFile(keep.path, "utf8"), absorbed = await readFile(absorb.path, "utf8");
    f.reply({ skills: [{ action: "update", id: keep.id, scope: "project", name: keep.name, description: "Combined release procedure",
      body: "Build first, then check the release artifact using the retained checklist.", baseVersion: keep.version,
      files: [{ file: "references/check.md", content: "Asset-specific checklist" }], reason: "Combine the two reviewed procedures", evidence: f.proposal.evidence }] });
    const ledger = new ReviewLedger(f.agentDir), done = f.terminal();
    const started = await f.command(`curate propose ${keep.id} ${absorb.id}`);
    assert.equal(started.status, "review-started", JSON.stringify(started)); await done;
    const recorded = await ledger.inspect(); assert.equal(recorded.records.length, 1); assert.equal(recorded.records[0]!.status, "pending");
    assert.equal(f.calls.length, 1); assert.equal(f.diffs.length, 0);
    assert.equal(await readFile(keep.path, "utf8"), before); assert.equal(await readFile(absorb.path, "utf8"), absorbed);
    const pending = (await new InstalledPermissions(f.agentDir).status()).pending[0]!; assert.ok(pending);
    const applied = await f.command(`curate apply ${pending.id}`); assert.equal(applied.status, "changed", JSON.stringify(applied));
    assert.ok(f.diffs[0]?.includes("Asset-specific checklist") && f.diffs[0]?.includes(absorb.id));
    await assert.rejects(stat(absorb.path), /ENOENT/); assert.match(await readFile(keep.path, "utf8"), /Build first/);
    const archive = await new SkillArchives(f.agentDir, f.cwd).get(applied.archiveId);
    assert.equal(archive.state, "archived"); assert.equal(archive.plan.target.id, absorb.id);
    assert.equal(Buffer.from(archive.plan.members.find(member => member.file === "SKILL.md")!.data, "base64").toString(), absorbed);
    assert.equal(archive.plan.members.length, 2); assert.equal((await f.store.catalog()).length, 1);
    assert.deepEqual((await new InstalledPermissions(f.agentDir).status()).pending, []);
    assert.equal((await f.command(`restore ${applied.archiveId}`)).status, "changed");
    assert.equal(await readFile(absorb.path, "utf8"), absorbed);
    assert.equal(await readFile(join(dirname(absorb.path), "references/check.md"), "utf8"), "Asset-specific checklist");
    assert.equal(f.calls.length, 1); assert.deepEqual((await ledger.inspect()).records, recorded.records);
  } finally { f.session.dispose(); }
});

async function fixture() {
  let excluded: string | undefined, response: unknown = { skills: [] }, gate: Promise<void> | undefined, onSources: (() => Promise<void>) | undefined, onProduced: (() => void) | undefined;
  const diffs: string[] = [], statuses = new Map<string, string | undefined>();
  let settled: (() => void) | undefined;
  const terminal = (needle?: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void new ReviewLedger(f.agentDir).inspect().then(state => reject(new Error(`Expected terminal ${needle ?? "any"}: ${JSON.stringify(state.records.map(row => ({ status: row.status, reason: row.reason, usage: row.usage })))}`)));
    }, 6000);
    wanted = needle;
    settled = () => { clearTimeout(timer); resolve(); settled = undefined; };
  });
  let wanted: string | undefined;
  const f = await isolatedSession("unused", { deferReply: () => gate, restorePolicy: async request => ({ version: 1, cwd: request.cwd,
    projectTrusted: request.projectTrusted, id: request.id, filePath: request.skill.filePath, allowed: true, reason: "Current fixture host allows this path" }),
    streamReply: () => { onProduced?.(); return { content: [{ type: "text", text: JSON.stringify(response) }], stopReason: "stop" }; }, projectRoot: cwd => cwd, skillSources: async request => {
    await onSources?.(); return {
    version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
    skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills.filter(skill => skill.filePath !== excluded),
  }; } });
  const notices: string[] = [], ui = f.session.extensionRunner.createCommandContext().ui;
  const tui: typeof ui = { ...ui, editor: async (_title, value) => { diffs.push(value ?? ""); return value?.trim(); }, confirm: async () => true, notify: text => notices.push(text),
    setStatus: (key, value) => { statuses.set(key, value); }, setWidget: () => {} };
  f.onReviewState(state => {
    const record = state.records.at(-1);
    const matched = wanted === "usage-known" ? !!record?.usage && !record.usageUnknown : !wanted || record?.reason?.includes(wanted) || record?.status === wanted;
    if (record && !["running", "admitted"].includes(record.status) && matched) settled?.();
  });
  await f.session.bindExtensions({ mode: "tui", uiContext: tui });
  const command = async (text: string) => { notices.length = 0; await f.session.prompt(`/hermes-skills ${text}`); return JSON.parse(notices.at(-1)!); };
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 1 });
  const snapshot = captureSnapshot(f.session.extensionRunner.createContext());
  const proposal = { action: "create" as const, scope: "project" as const, name: "build-order", description: "Build ordering", body: "Build before manifest check",
    reason: "Project release rule", evidence: [{ entryId, quote: "Build before manifest check" }], procedureTemplate: "build-before-manifest" as const };
  const store = new ManagedSkillStore(f.agentDir, f.cwd);
  return { ...f, statuses, terminal, tui, entered: (fn: () => void) => { if (f.calls.length) fn(); else onProduced = fn; }, onSources: (fn?: () => Promise<void>) => { onSources = fn; }, defer: (promise?: Promise<void>) => { gate = promise; }, notices, command, proposal, snapshot, store, diffs, reply: (value: unknown) => { response = value; }, exclude: (path?: string) => { excluded = path; } };
}

async function mergeFixture() {
  const f = await fixture();
  const keep = await f.store.save({ ...f.proposal, files: [{ file: "references/keep.md", content: "Original keep reference" }] }, f.snapshot, "keep-seed"), absorb = await f.store.save({ ...f.proposal, name: "secondary-rule", body: "Secondary procedure.",
    files: [{ file: "references/source.md", content: "Keep this secondary reference" }] }, f.snapshot, "absorb-seed");
  const proposal = { action: "update", id: keep.id, scope: "project", name: keep.name, description: "Merged procedure", body: "Merged keep procedure.",
    baseVersion: keep.version, reason: "Combine the supplied procedures", evidence: f.proposal.evidence };
  f.reply({ skills: [proposal] });
  return { ...f, keep, absorb, mergedProposal: proposal, propose: async () => {
    const done = f.terminal(); await f.command(`curate propose ${keep.id} ${absorb.id}`); await done;
    return (await new InstalledPermissions(f.agentDir).status()).pending[0]!;
  } };
}

test("curation never lets a global installed grant bypass content approval or overwrite a stale input", async () => {
  const f = await mergeFixture();
  try {
    const pending = await f.propose(), before = await readFile(f.keep.path, "utf8");
    await f.session.bindExtensions({ mode: "rpc", uiContext: f.tui }); await f.command("installed allow --acknowledge");
    assert.match((await f.command(`curate apply ${pending.id}`)).failed, /confirmation-required/);
    assert.equal(await readFile(f.keep.path, "utf8"), before);
    await f.session.bindExtensions({ mode: "tui", uiContext: f.tui });
    await writeFile(join(dirname(f.absorb.path), "references/source.md"), "Human reference edit");
    assert.equal((await f.command(`curate apply ${pending.id}`)).status, "conflict");
    assert.equal(await readFile(f.keep.path, "utf8"), before); assert.ok(await stat(f.absorb.path));
    assert.equal(f.calls.length, 1); assert.equal((await new ReviewLedger(f.agentDir).inspect()).records.length, 1);
  } finally { f.session.dispose(); }
});

test("curation resumes absorption after a committed keep update without replaying the model or overwriting the saved keep", async () => {
  const f = await mergeFixture();
  try {
    const pending = await f.propose();
    f.onSources(async () => { if ((await readFile(f.keep.path, "utf8")).includes("Merged keep procedure")) f.exclude(f.absorb.path); });
    const partial = await f.command(`curate apply ${pending.id}`); assert.equal(partial.status, "failed", JSON.stringify(partial));
    assert.match(await readFile(f.keep.path, "utf8"), /Merged keep/); assert.ok(await stat(f.absorb.path));
    const permissions = new InstalledPermissions(f.agentDir); assert.equal((await permissions.status()).pending[0]!.applying, true);
    await assert.rejects(f.store.assertReady(), /store-recovery-required.*curate apply/);
    assert.match((await f.command(`reject ${pending.id}`)).failed, /cannot be discarded/);
    await f.session.reload(); f.onSources(); f.exclude();
    const resumed = await f.command(`curate apply ${pending.id}`); assert.equal(resumed.status, "changed", JSON.stringify(resumed));
    await assert.rejects(stat(f.absorb.path), /ENOENT/); assert.deepEqual((await permissions.status()).pending, []);
    assert.equal((await f.store.history(f.keep.id)).items.filter(row => row.requestId === (resumed.requestId as string)).length, 1);
    assert.equal(f.calls.length, 1); assert.equal((await new ReviewLedger(f.agentDir).inspect()).records.length, 1);
    await f.store.assertReady();
  } finally { f.session.dispose(); }
});

for (const scenario of ["no-change", "invalid-target", "budget"] as const) test(`curation ${scenario} preserves both inputs without additional requests`, async () => {
  const f = await mergeFixture();
  try {
    const before = await Promise.all([f.keep.path, f.absorb.path].map(path => readFile(path, "utf8")));
    if (scenario === "no-change") f.reply({ skills: [] });
    if (scenario === "invalid-target") f.reply({ skills: [f.mergedProposal, { ...f.mergedProposal, id: f.absorb.id, name: f.absorb.name, baseVersion: f.absorb.version }] });
    if (scenario === "budget") f.session.sessionManager.appendMessage({ role: "user", content: "Large current context " + "x".repeat(70000), timestamp: 4 });
    await f.propose();
    const records = (await new ReviewLedger(f.agentDir).inspect()).records;
    assert.equal(records.length, 1); assert.equal(records[0]!.status, scenario === "budget" ? "skipped" : scenario === "invalid-target" ? "failed" : "no-change");
    assert.equal(f.calls.length, scenario === "budget" ? 0 : 1); assert.deepEqual((await new InstalledPermissions(f.agentDir).status()).pending, []);
    assert.deepEqual(await Promise.all([f.keep.path, f.absorb.path].map(path => readFile(path, "utf8"))), before);
  } finally { f.session.dispose(); }
});

test("protected, installed, excluded and cross-scope curation inputs are rejected before admission", async () => {
  const f = await mergeFixture();
  try {
    await f.command(`pin ${f.absorb.id}`);
    assert.equal((await f.command(`curate propose ${f.keep.id} ${f.absorb.id}`)).status, "failed");
    await f.command(`unpin ${f.absorb.id}`); f.exclude(f.absorb.path);
    assert.equal((await f.command(`curate propose ${f.keep.id} ${f.absorb.id}`)).status, "failed"); f.exclude();
    const global = await f.store.save({ ...f.proposal, name: "global-rule", scope: "global", crossProject: "Explicit isolated global fixture" }, f.snapshot, "global-seed");
    assert.equal((await f.command(`curate propose ${f.keep.id} ${global.id}`)).status, "failed");
    const manual = join(f.cwd, ".pi/skills/manual/SKILL.md"); await mkdir(dirname(manual), { recursive: true });
    await writeFile(manual, "---\nname: manual\ndescription: Hand-installed fixture\n---\nManual procedure.\n"); await f.command("refresh");
    const id = (await f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_search")!.execute("manual", { query: "manual" })).details.items[0].id;
    assert.equal((await f.command(`curate propose ${f.keep.id} ${id}`)).status, "failed");
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

for (const stage of ["keep-member", "archive-member"]) test(`curation resumes real ${stage} interruption with durable member state and no paid replay`, async () => {
  const f = await mergeFixture();
  try {
    const reference = join(dirname(f.keep.path), "references/keep.md"), absorbedReference = join(dirname(f.absorb.path), "references/source.md");
    if (stage === "keep-member") f.reply({ skills: [{ ...f.mergedProposal, files: [{ file: "references/keep.md", content: "Changed keep reference", baseVersion: contentHash("Original keep reference") }] }] });
    const pending = await f.propose(), ledger = new ReviewLedger(f.agentDir), prior = (await ledger.inspect()).records;
    f.onSources(async () => {
      if (stage === "keep-member" ? (await readFile(f.keep.path, "utf8")).includes("Merged keep procedure") : !await stat(absorbedReference).then(() => true, () => false)) f.exclude(f.absorb.path);
    });
    assert.equal((await f.command(`curate apply ${pending.id}`)).status, "failed");
    assert.match(await readFile(f.keep.path, "utf8"), /Merged keep/); assert.ok(await stat(f.absorb.path));
    const permissions = new InstalledPermissions(f.agentDir); assert.equal((await permissions.status()).pending[0]!.applying, true);
    const child = (await f.store.inspectRecovery())[0];
    if (stage === "keep-member") {
      assert.equal(child!.state, "content-committed"); assert.equal(await readFile(reference, "utf8"), "Original keep reference");
      await assert.rejects(f.store.recover(child!.key, "abort"), /already committed/);
    } else {
      assert.equal(child, undefined); await assert.rejects(stat(absorbedReference), /ENOENT/);
      assert.equal((await new SkillArchives(f.agentDir, f.cwd).list())[0]!.state, "archiving");
    }
    await f.session.reload(); assert.ok((await f.command("status")).maintenance.length > 0);
    await assert.rejects(f.store.assertReady(), /store-recovery-required/);
    f.onSources(); f.exclude();
    if (child) await f.session.prompt(`/hermes-review recover ${child.key} commit`);
    const resumed = await f.command(`curate apply ${pending.id}`); assert.equal(resumed.status, "changed", JSON.stringify(resumed));
    await assert.rejects(stat(f.absorb.path), /ENOENT/); await f.store.assertReady();
    if (stage === "keep-member") assert.equal(await readFile(reference, "utf8"), "Changed keep reference");
    assert.equal(f.calls.length, 1); assert.deepEqual((await ledger.inspect()).records, prior);
    assert.equal((await f.store.history(f.keep.id)).items.filter(row => row.requestId === resumed.requestId).length, 1);
    assert.deepEqual((await f.command("status")).maintenance, []);
  } finally { f.session.dispose(); }
});

test("cancelled curation accepts late usage only, without pending or source writes", async () => {
  const f = await mergeFixture(); let release!: () => void;
  try {
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    f.defer(new Promise<void>(resolve => { release = resolve; }));
    const before = await Promise.all([f.keep.path, f.absorb.path].map(path => readFile(path, "utf8")));
    const cancelled = f.terminal("cancelled"); await f.command(`curate propose ${f.keep.id} ${f.absorb.id}`);
    // Source admission has no model-side callbacks; wait for the fake producer's actual entry via fixture notification.
    f.entered(entered); await started;
    const ledger = new ReviewLedger(f.agentDir), requestId = (await ledger.inspect()).records[0]!.id;
    await f.session.prompt("/hermes-review cancel"); await cancelled;
    const cancelledRecord = (await ledger.inspect()).records[0]!;
    assert.equal(cancelledRecord.id, requestId); assert.equal(cancelledRecord.status, "cancelled"); assert.equal(cancelledRecord.usageUnknown, true);
    const late = f.terminal("usage-known"); release(); await late;
    const records = (await ledger.inspect()).records;
    assert.equal(records[0]!.id, requestId); assert.equal(records[0]!.reason, cancelledRecord.reason);
    assert.equal(records.length, 1); assert.equal(records[0]!.status, "cancelled"); assert.equal(records[0]!.usage?.totalTokens, 128);
    assert.equal(f.calls.length, 1); assert.deepEqual((await new InstalledPermissions(f.agentDir).status()).pending, []);
    assert.deepEqual(await Promise.all([f.keep.path, f.absorb.path].map(path => readFile(path, "utf8"))), before);
  } finally { release?.(); f.session.dispose(); }
});

test("curation lists exact-body and unused evidence only for eligible managed skills, without mutation or a model", async () => {
  const f = await fixture();
  try {
    const a = await f.store.save(f.proposal, f.snapshot, "seed-a");
    const b = await f.store.save({ ...f.proposal, name: "build-order-copy" }, f.snapshot, "seed-b");
    const protectedSkill = await f.store.save({ ...f.proposal, name: "pinned-order" }, f.snapshot, "seed-pin");
    const excluded = await f.store.save({ ...f.proposal, name: "excluded-order" }, f.snapshot, "seed-excluded");
    const manual = join(f.cwd, ".pi/skills/manual/SKILL.md"); await mkdir(dirname(manual), { recursive: true });
    await writeFile(manual, "---\nname: manual\ndescription: User procedure\n---\n\nBuild before manifest check\n");
    await f.command(`pin ${protectedSkill.id}`); f.exclude(excluded.path);
    const before = await Promise.all([a, b, protectedSkill, excluded].map(row => readFile(row.path, "utf8")));
    const result = await f.command("curate list");
    assert.ok(result.items, JSON.stringify(result)); assert.equal(result.status, "no-change"); assert.equal(result.modelCalled, false);
    assert.deepEqual(result.items.map((row: { id: string }) => row.id).sort(), [a.id, b.id].sort());
    assert.ok(result.items.every((row: { reasons: string[]; duplicateIds: string[] }) => row.reasons.includes("no-recorded-use") && row.reasons.includes("same-primary-body") && row.duplicateIds.length === 1));
    assert.match(result.notice, /not.*archive|not.*permission/i);
    assert.deepEqual(await Promise.all([a, b, protectedSkill, excluded].map(row => readFile(row.path, "utf8"))), before);
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

test("repeated known lesson points to the existing rule, then updates that read ID rather than creating another skill or reference", async () => {
  const f = await fixture();
  try {
    const manage = f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_manage")!;
    const first = (await manage.execute("first-rule", { proposal: f.proposal })).details;
    assert.equal(first.status, "saved");
    const duplicate = (await manage.execute("duplicate-rule", { proposal: { ...f.proposal, name: "build-order-again" } })).details;
    assert.equal(duplicate.status, "conflict"); assert.match(duplicate.reason, /existing|duplicate/i); assert.ok(duplicate.reason.includes(first.id));
    const view = f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_view")!;
    const read = (await view.execute("read-existing", { id: first.id })).details;
    f.session.sessionManager.appendMessage({ role: "toolResult", toolCallId: "read-existing", toolName: "hermes_skill_view", isError: false,
      content: [{ type: "text", text: JSON.stringify(read) }], timestamp: 2 });
    const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 3 });
    const updated = (await manage.execute("revise-existing", { proposal: { ...f.proposal, action: "update", id: first.id,
      baseVersion: first.version, evidence: [{ entryId, quote: "Build before manifest check" }] } })).details;
    assert.equal(updated.status, "saved"); assert.equal(updated.id, first.id);
    const records = await f.store.catalog(); assert.equal(records.length, 1); assert.equal(records[0]!.evidence[0]!.entryId, entryId);
    assert.deepEqual(Object.keys(records[0]!.files!), ["SKILL.md"]);
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});
