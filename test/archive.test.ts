import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { captureSnapshot } from "../src/context.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { SkillArchives } from "../src/archives.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { ReviewLedger } from "../src/ledger.ts";

async function fixture() {
  let allowRestore = true, decisions = 0, withdrawAfterMember = false, recoveryPaused!: () => void;
  let excluded: string | undefined, onSources: (() => Promise<void>) | undefined;
  const paused = new Promise<void>(resolve => { recoveryPaused = resolve; });
  const f = await isolatedSession("unused", { projectRoot: cwd => cwd,
    restorePolicy: async request => { decisions++; return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
      id: request.id, filePath: request.skill.filePath, allowed: allowRestore, reason: allowRestore ? "Current host permits target" : "Currently excluded by host" }; },
    skillSources: async request => {
      await onSources?.();
      return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
        skills: withdrawAfterMember && !await stat(join(request.cwd, ".pi/skills/hermes-managed/release-rule/references/check.md")).then(() => true, () => false) ? [] :
          loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills.filter(skill => skill.filePath !== excluded) };
    },
  });
  const notices: string[] = [], diffs: string[] = [], statuses = new Map<string, string | undefined>(), ui = f.session.extensionRunner.createCommandContext().ui;
  const tui = { ...ui, notify: (text: string) => notices.push(text), editor: async (_title: string, initial?: string) => { diffs.push(initial ?? ""); return initial?.trim(); },
    select: async () => "Allow this change once",
    confirm: async () => true, setStatus: (key: string, text?: string) => { statuses.set(key, text); }, setWidget: () => {} };
  f.onReviewState(state => { if (state.paused?.includes("store-recovery-required")) recoveryPaused(); });
  await f.session.bindExtensions({ mode: "tui", uiContext: tui });
  const command = async (value: string) => { notices.length = 0; await f.session.prompt(`/hermes-skills ${value}`); return JSON.parse(notices.at(-1)!); };
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Keep the release procedure", timestamp: 1 });
  const store = new ManagedSkillStore(f.agentDir, f.cwd);
  const saved = await store.save({ action: "create", scope: "project", name: "release-rule", description: "Project release procedure", body: "Read the checklist.",
    files: [{ file: "references/check.md", content: "Preserved reference." }, { file: "scripts/check.sh", content: "#!/bin/sh\nexit 7\n" }],
    reason: "Fixture", evidence: [{ entryId, quote: "Keep the release procedure" }] }, captureSnapshot(f.session.extensionRunner.createContext()), "archive-fixture");
  const extra = join(dirname(saved.path), "neighbor.txt"); await writeFile(extra, "Unowned neighbor stays.");
  await command("refresh");
  return { ...f, store, saved, extra, command, paused, statuses, diffs, tui, exclude: (path?: string) => { excluded = path; }, onSources: (fn?: () => Promise<void>) => { onSources = fn; }, decisions: () => decisions, withdraw: (value: boolean) => { withdrawAfterMember = value; }, allow: (value: boolean) => { allowRestore = value; } };
}

async function installedFixture() {
  const f = await fixture(), root = join(f.cwd, ".pi/skills"), primary = join(root, "A.md"), neighbor = join(root, "B.md"), shared = join(root, "references/shared.txt");
  await mkdir(dirname(shared), { recursive: true });
  await writeFile(primary, "---\nname: installed-alpha\ndescription: Manual alpha\n---\nUse shared reference.\n");
  await writeFile(neighbor, "---\nname: installed-beta\ndescription: Manual beta\n---\nNeighbor also uses shared reference.\n");
  await writeFile(shared, "Shared bytes stay here.");
  const before = await readFile(primary, "utf8"), other = await readFile(neighbor, "utf8"); await f.command("refresh");
  const search = f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_search")!;
  const hit = (await search.execute("find-alpha", { query: "Manual alpha" })).details.items[0];
  const request = `archive ${hit.id} ${JSON.stringify({ reason: "Explicit archive of alpha only", files: ["references/shared.txt"] })}`;
  return { ...f, primary, neighbor, shared, before, other, search, hit, request, permissions: new InstalledPermissions(f.agentDir) };
}

test("registered managed archive removes only proven members from search, then current host authorization restores the same skill and assets", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.saved.path, "utf8");
    const result = await f.command(`archive ${f.saved.id} Superseded release procedure`);
    assert.equal(result.status, "changed", JSON.stringify(result)); assert.ok(result.archiveId);
    await assert.rejects(stat(f.saved.path), /ENOENT/); assert.equal(await readFile(f.extra, "utf8"), "Unowned neighbor stays.");
    const tools = f.session.agent.state.tools, search = tools.find(tool => tool.name === "hermes_skill_search")!;
    assert.equal((await search.execute("archived-search", {})).details.items.length, 0);
    assert.equal((await f.store.catalog()).length, 0);
    const archives = await f.command("archives"); assert.equal(archives.items[0].state, "archived");
    f.allow(false);
    const denied = await f.command(`restore ${result.archiveId}`); assert.match(denied.failed, /denied.*excluded/i);
    await assert.rejects(stat(f.saved.path), /ENOENT/);
    f.allow(true);
    const restored = await f.command(`restore ${result.archiveId}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
    const hit = (await search.execute("restored-search", {})).details.items[0]; assert.equal(hit.id, f.saved.id);
    assert.equal(await readFile(f.saved.path, "utf8"), before);
    assert.equal(await readFile(join(dirname(f.saved.path), "references/check.md"), "utf8"), "Preserved reference.");
    assert.equal(await readFile(f.extra, "utf8"), "Unowned neighbor stays.");
    const page = (await tools.find(tool => tool.name === "hermes_skill_view")!.execute("restored-read", { id: hit.id })).details;
    assert.ok(page.content.includes("Read the checklist")); assert.equal((await f.store.ownership(f.saved.path, "project"))!.id, f.saved.id);
    assert.ok(f.decisions() >= 3); assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

test("source withdrawal after a member move leaves visible recoverable state and blocks another paid admission until local completion", async () => {
  const f = await fixture();
  try {
    f.withdraw(true);
    const failed = await f.command(`archive ${f.saved.id} Interrupt after reference move`); assert.ok(failed.failed);
    const partial = (await f.command("archives")).items[0]; assert.equal(partial.state, "archiving"); assert.ok(partial.error);
    await assert.rejects(stat(join(dirname(f.saved.path), "references/check.md")), /ENOENT/);
    assert.ok(await readFile(f.saved.path, "utf8")); await assert.rejects(f.store.assertReady(), /store-recovery-required/);
    f.withdraw(false);
    await f.session.prompt("/hermes-review run"); await f.paused;
    const skip = (await new ReviewLedger(f.agentDir).inspect()).records;
    assert.equal(skip.length, 1); assert.equal(skip[0]!.status, "skipped"); assert.equal(skip[0]!.reservation.input, 0);
    const resumed = await f.command(`archive-resume ${partial.id}`); assert.equal(resumed.status, "changed", JSON.stringify(resumed));
    await f.store.assertReady();
    const archives = new SkillArchives(f.agentDir, f.cwd);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), authorization = new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    const cancelled = archives.restore(partial.id, { signal: controller.signal, isCurrent: () => !controller.signal.aborted, authorize: () => { entered(); return authorization; } });
    await started; controller.abort(); await assert.rejects(cancelled);
    await assert.rejects(stat(f.saved.path), /ENOENT/);
    const restored = await f.command(`restore ${partial.id}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
    release(); await authorization;
    assert.equal((await archives.list())[0]!.state, "restored"); assert.equal(await readFile(f.extra, "utf8"), "Unowned neighbor stays.");
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, skip);
  } finally { f.session.dispose(); }
});

test("installed loose-file archive approves an exact member list, backs up shared references without moving neighbors, and restores without ownership promotion", async () => {
  const f = await installedFixture();
  try {
    const { primary, neighbor, shared, before, other, search, hit } = f;
    const archived = await f.command(f.request);
    assert.equal(archived.status, "changed", JSON.stringify(archived)); await assert.rejects(stat(primary), /ENOENT/);
    assert.equal(await readFile(shared, "utf8"), "Shared bytes stay here."); assert.equal(await readFile(neighbor, "utf8"), other);
    assert.ok(f.diffs[0]!.includes("A.md") && f.diffs[0]!.includes("references/shared.txt") && f.diffs[0]!.includes("copy"));
    assert.equal((await search.execute("alpha-gone", { query: "Manual alpha" })).details.items.length, 0);
    const restored = await f.command(`restore ${archived.archiveId}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
    assert.equal(await readFile(primary, "utf8"), before); assert.equal((await f.command(`inspect ${hit.id}`)).skill.owner, "user-owned");
    assert.equal(f.diffs.length, 2); assert.equal(f.calls.length, 0); assert.equal((await f.store.catalog()).length, 1);
  } finally { f.session.dispose(); }
});

test("unattended installed archive and restore share bounded pending; RPC cannot approve and stale bytes invalidate approval", async () => {
  const f = await installedFixture();
  try {
    await f.session.bindExtensions({ mode: "rpc", uiContext: f.tui });
    const queued = await f.command(f.request); assert.equal(queued.status, "pending");
    assert.equal(await readFile(f.primary, "utf8"), f.before); assert.equal(f.diffs.length, 0);
    const rpcApproval = await f.command(`approve ${queued.pendingId}`); assert.match(rpcApproval.failed, /confirmation-required/);
    await f.session.bindExtensions({ mode: "tui", uiContext: f.tui });
    await writeFile(f.primary, f.before + "Human addition\n");
    const stale = await f.command(`approve ${queued.pendingId}`); assert.equal(stale.status, "conflict", JSON.stringify(stale));
    assert.equal(await readFile(f.primary, "utf8"), f.before + "Human addition\n");
    await f.command(`reject ${queued.pendingId}`);
    await f.session.bindExtensions({ mode: "print", uiContext: f.tui });
    await f.session.prompt(`/hermes-skills ${f.request}`);
    const row = (await f.permissions.status()).pending[0]!; assert.ok(row);
    await f.session.bindExtensions({ mode: "tui", uiContext: f.tui });
    const archived = await f.command(`approve ${row.id}`); assert.equal(archived.status, "changed", JSON.stringify(archived));
    assert.equal((await f.permissions.status()).pending.length, 0); await assert.rejects(stat(f.primary), /ENOENT/);
    await f.session.bindExtensions({ mode: "rpc", uiContext: f.tui });
    const pendingRestore = await f.command(`restore ${archived.archiveId}`); assert.equal(pendingRestore.status, "pending");
    await f.session.bindExtensions({ mode: "tui", uiContext: f.tui });
    const restored = await f.command(`approve ${pendingRestore.pendingId}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
    assert.equal(await readFile(f.primary, "utf8"), f.before + "Human addition\n");
    assert.equal(await readFile(f.shared, "utf8"), "Shared bytes stay here."); assert.equal(await readFile(f.neighbor, "utf8"), f.other);
    assert.equal((await f.command(`inspect ${f.hit.id}`)).skill.owner, "user-owned"); assert.equal(f.calls.length, 0);
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

test("installed archive rejects source withdrawal after approval and grant withdrawal during source authorization", async () => {
  const f = await installedFixture();
  try {
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...f.tui, select: async () => { f.exclude(f.primary); return "Allow this change once"; } } });
    const denied = await f.command(f.request); assert.notEqual(denied.status, "changed");
    assert.equal(await readFile(f.primary, "utf8"), f.before); assert.equal(await readFile(f.shared, "utf8"), "Shared bytes stay here.");
    f.exclude(); await f.session.bindExtensions({ mode: "rpc", uiContext: f.tui });
    await f.command("installed allow --acknowledge");
    f.onSources(async () => {
      if (await stat(join(f.agentDir, "hermes-skills/provenance/archives")).then(() => true, () => false)) await f.permissions.setGlobalGrant(false);
    });
    const revoked = await f.command(f.request); assert.match(revoked.failed, /grant revoked/);
    assert.equal(await readFile(f.primary, "utf8"), f.before);
    const rows = await new SkillArchives(f.agentDir, f.cwd).list(); assert.equal(rows[0]!.state, "archiving");
    await assert.rejects(stat(join(f.agentDir, "hermes-skills/provenance/archives", rows[0]!.id, "members/references/shared.txt")), /ENOENT/);
    f.onSources(); await f.command("installed allow --acknowledge");
    const resumed = await f.command(`archive-resume ${rows[0]!.id}`); assert.equal(resumed.status, "changed", JSON.stringify(resumed));
    const restored = await f.command(`restore ${rows[0]!.id}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
    assert.equal(await readFile(f.primary, "utf8"), f.before); assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("installed restore preserves shared-reference edits and rechecks grant withdrawal before publication", async () => {
  const f = await installedFixture();
  try {
    await f.session.bindExtensions({ mode: "rpc", uiContext: f.tui }); await f.command("installed allow --acknowledge");
    const archived = await f.command(f.request); assert.equal(archived.status, "changed");
    const archives = new SkillArchives(f.agentDir, f.cwd);
    await writeFile(f.shared, "A later shared-reference edit");
    assert.match((await f.command(`restore ${archived.archiveId}`)).failed, /conflict/);
    await assert.rejects(stat(f.primary), /ENOENT/); assert.equal(await readFile(f.shared, "utf8"), "A later shared-reference edit");
    assert.equal(await readFile(f.neighbor, "utf8"), f.other);
    await writeFile(f.shared, "Shared bytes stay here.");
    f.onSources(async () => {
      if ((await archives.get(archived.archiveId)).state === "restoring") await f.permissions.setGlobalGrant(false);
    });
    assert.match((await f.command(`restore ${archived.archiveId}`)).failed, /grant revoked/);
    await assert.rejects(stat(f.primary), /ENOENT/); assert.equal((await archives.get(archived.archiveId)).state, "restoring");
    await f.session.bindExtensions({ mode: "tui", uiContext: f.tui });
    await f.session.reload(); assert.ok((await f.command("status")).maintenance.length > 0);
    f.onSources();
    const restored = await f.command(`restore ${archived.archiveId}`); assert.equal(restored.status, "changed");
    assert.equal(await readFile(f.primary, "utf8"), f.before); assert.equal(await readFile(f.shared, "utf8"), "Shared bytes stay here.");
    assert.equal((await f.command(`inspect ${f.hit.id}`)).skill.owner, "user-owned");
    assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  } finally { f.session.dispose(); }
});

test("archive reports known reference-file impact without executing scripts, rewriting references or counting its own reads as use", async () => {
  const f = await fixture();
  try {
    const consumer = await f.store.save({ action: "create", scope: "project", name: "release-consumer", description: "Reference consumer", body: "See the local reference.",
      files: [{ file: "references/usage.md", content: "Use [the procedure](../../release-rule/SKILL.md)." }], reason: "Known reference fixture", evidence: f.saved.evidence },
      captureSnapshot(f.session.extensionRunner.createContext()), "reference-fixture");
    const ref = join(dirname(consumer.path), "references/usage.md"), before = await readFile(ref, "utf8");
    const result = await f.command(`archive ${f.saved.id} Check local impact`);
    assert.equal(result.status, "changed", JSON.stringify(result));
    assert.ok(result.impact.matches.some((row: { id: string; file: string }) => row.id === consumer.id && row.file === "references/usage.md"));
    assert.equal(result.impact.externalReferences, "unchecked"); assert.equal(await readFile(ref, "utf8"), before);
    assert.equal((await f.command(`inspect ${consumer.id}`)).activity.views, 0); assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("restore preserves a subsequent human file and archive bytes instead of overwriting it", async () => {
  const f = await fixture();
  try {
    const archived = await f.command(`archive ${f.saved.id} Safe preservation`);
    assert.equal(archived.status, "changed");
    await mkdir(dirname(f.saved.path), { recursive: true }); await writeFile(f.saved.path, "Human replacement");
    const result = await f.command(`restore ${archived.archiveId}`);
    assert.match(result.failed, /conflict/); assert.equal(await readFile(f.saved.path, "utf8"), "Human replacement");
    assert.ok((await f.command("status")).maintenance.length > 0);
    await f.session.reload();
    assert.ok((await f.command("status")).maintenance.length > 0, "maintenance conflict remains queryable after real SDK reload");
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});
