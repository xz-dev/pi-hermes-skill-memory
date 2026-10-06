import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { captureSnapshot } from "../src/context.ts";
import { contentHash, ManagedSkillStore } from "../src/store.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { ReviewLedger } from "../src/ledger.ts";

for (const installed of [false, true]) {
  test(`local rollback reverses exact ${installed ? "installed" : "managed"} bytes and introduced assets, preserving hand edits and accounting`, async () => {
    let sourceAllowed = async () => true;
    const f = await isolatedSession("unused", { projectRoot: cwd => cwd,
      restorePolicy: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, id: request.id,
        filePath: request.skill.filePath, allowed: true, reason: "Fixture host authorizes this path" }),
      skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
        skills: await sourceAllowed() ? loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills : [] }),
    });
    try {
      const statuses = new Map<string, string | undefined>();
      const notices: string[] = [], diffs: string[] = [], ui = f.session.extensionRunner.createCommandContext().ui;
      const confirmations: boolean[] = []; let acceptRollback = true;
      const tui = { ...ui, notify: (text: string) => notices.push(text), editor: async (_title: string, value?: string) => { diffs.push(value ?? ""); return value; },
        select: async () => "Allow this change once",
        confirm: async () => { confirmations.push(acceptRollback); return acceptRollback; }, setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); }, setWidget: () => {} };
      await f.session.bindExtensions({ mode: "tui", uiContext: tui });
      const command = async (text: string) => { notices.length = 0; await f.session.prompt(`/hermes-skills ${text}`); return JSON.parse(notices.at(-1)!); };
      const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Preserve the procedure", timestamp: 1 });
      const snapshot = captureSnapshot(f.session.extensionRunner.createContext()), evidence = [{ entryId, quote: "Preserve the procedure" }];
      const store = new ManagedSkillStore(f.agentDir, f.cwd);
      let path: string;
      if (installed) {
        path = join(f.cwd, ".pi/skills/manual/SKILL.md"); await mkdir(join(dirname(path), "references"), { recursive: true });
        await writeFile(path, '---\nname: rollback-rule\n# Keep this formatting\ndescription: Original procedure\ncustom: retained\n---\n\nExact old body.\n\n' + "Old paragraph.\n".repeat(2200));
        await writeFile(join(dirname(path), "references/check.txt"), "Original reference\n".repeat(2000));
      } else {
        const saved = await store.save({ action: "create", scope: "project", name: "rollback-rule", description: "Original procedure", body: "Exact old body.",
          files: [{ file: "references/check.txt", content: "Original reference\n" }], reason: "Fixture original", evidence }, snapshot, "original-version");
        path = saved.path;
      }
      await command("refresh");
      const hit = (await f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_search")!.execute("find", { query: "rollback-rule" })).details.items[0];
      const target = (await command(`inspect ${hit.id}`)).skill;
      const before = await readFile(path, "utf8"), reference = join(dirname(path), "references/check.txt"), added = join(dirname(path), "references/introduced.txt");
      const beforeReference = await readFile(reference, "utf8");
      const readSnapshot = { ...snapshot, skillReads: [{ id: hit.id, file: relative(target.baseDir, path), version: contentHash(before) },
        { id: hit.id, file: "references/check.txt", version: contentHash(beforeReference) }] };
      await store.save({ action: "update", id: hit.id, scope: "project", name: "rollback-rule", description: "Updated procedure", body: "Changed body.",
        baseVersion: contentHash(before), files: [{ file: "references/check.txt", content: "Changed reference", baseVersion: contentHash(beforeReference) },
          { file: "references/introduced.txt", content: "Retain this version in history" }], reason: "Fixture version to reverse", evidence }, readSnapshot, "edited-version",
        installed ? { installed: target, approveInstalled: async () => true } : undefined);
      const after = await readFile(path, "utf8");
      const history = await command(`history ${hit.id}`); assert.ok(history.items, JSON.stringify(history));
      const change = history.items.find((row: { requestId: string }) => row.requestId === "edited-version"); assert.ok(change);
      await writeFile(path, after + "Manual subsequent edit\n");
      const conflict = await command(`rollback ${hit.id} ${change.key}`); assert.equal(conflict.status, "conflict", JSON.stringify(conflict));
      assert.equal(await readFile(path, "utf8"), after + "Manual subsequent edit\n");
      await writeFile(path, after);
      await writeFile(reference, "A later reference edit");
      const assetConflict = await command(`rollback ${hit.id} ${change.key}`); assert.equal(assetConflict.status, "conflict");
      assert.equal(await readFile(path, "utf8"), after); assert.equal(await readFile(reference, "utf8"), "A later reference edit");
      await writeFile(reference, "Changed reference");
      await command(`pin ${hit.id}`);
      assert.equal((await command(`rollback ${hit.id} ${change.key}`)).status, "conflict"); assert.equal(await readFile(path, "utf8"), after);
      await command(`unpin ${hit.id}`);
      if (!installed) {
        acceptRollback = false;
        const cancelled = await command(`rollback ${hit.id} ${change.key}`);
        assert.equal(cancelled.status, "no-change"); assert.equal(confirmations.length, 1);
        assert.ok(diffs.at(-1)?.includes("introduced.txt") && diffs.at(-1)?.includes("removed"));
        assert.equal(await readFile(path, "utf8"), after); assert.equal(await readFile(reference, "utf8"), "Changed reference");
        assert.equal(await readFile(added, "utf8"), "Retain this version in history");
        assert.deepEqual(await store.inspectRecovery(), []); acceptRollback = true;
      }
      if (installed) await f.session.bindExtensions({ mode: "rpc", uiContext: tui });
      let reverted = await command(`rollback ${hit.id} ${change.key}`);
      if (installed) {
        assert.equal(reverted.status, "pending", JSON.stringify(reverted)); assert.equal(await readFile(path, "utf8"), after);
        const rpc = await command(`approve ${reverted.pendingId}`); assert.match(rpc.failed, /confirmation-required/);
        await f.session.bindExtensions({ mode: "tui", uiContext: tui });
        reverted = await command(`approve ${reverted.pendingId}`);
      }
      assert.equal(reverted.status, "changed", JSON.stringify(reverted)); assert.equal(await readFile(path, "utf8"), before);
      assert.equal(await readFile(reference, "utf8"), beforeReference); await assert.rejects(stat(added), /ENOENT/);
      const inspected = await command(`inspect ${hit.id}`); assert.equal(inspected.skill.owner, installed ? "user-owned" : "managed");
      assert.ok(JSON.stringify(await store.history(hit.id)).includes("edited-version"));
      const restoredHistory = await command(`history ${hit.id}`);
      const reversal = restoredHistory.items.find((row: { rollbackOf?: string }) => row.rollbackOf === change.key); assert.ok(reversal);
      const recoveryRows = JSON.parse(await readFile(join(f.agentDir, "hermes-skills/provenance/approved.json"), "utf8")).items;
      const reversalRecord = recoveryRows.find((row: { key: string }) => row.key === reversal.key);
      const state = installed ? join(f.agentDir, "hermes-skills/provenance/installed", contentHash(hit.id)) : join(f.cwd, ".pi/hermes-skills");
      assert.equal(await readFile(join(state, "history", `${reversalRecord.plan.record.requestId}-rollback-rule-removed/references/introduced.txt`), "utf8"), "Retain this version in history");
      // A second rollback reverses the removal too; history is usable, not merely a list of unreachable bytes.
      const reapplied = await command(`rollback ${hit.id} ${reversal.key}`); assert.equal(reapplied.status, "changed", JSON.stringify(reapplied));
      assert.equal(await readFile(path, "utf8"), after); assert.equal(await readFile(added, "utf8"), "Retain this version in history");
      const revertedAgain = await command(`rollback ${hit.id} ${change.key}`); assert.equal(revertedAgain.status, "changed", JSON.stringify(revertedAgain));
      assert.equal(await readFile(path, "utf8"), before); await assert.rejects(stat(added), /ENOENT/);
      assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
      if (installed) {
        assert.ok(diffs.some(diff => diff.includes("introduced.txt") && diff.includes("removed")));
        const permissions = new InstalledPermissions(f.agentDir), latest = (await command(`history ${hit.id}`)).items[0];
        await f.session.bindExtensions({ mode: "rpc", uiContext: tui }); await command("installed allow --acknowledge");
        sourceAllowed = async () => { if (await readFile(path, "utf8") === after) await permissions.setGlobalGrant(false); return true; };
        const interrupted = await command(`rollback ${hit.id} ${latest.key}`); assert.equal(interrupted.status, "failed");
        assert.equal(await readFile(path, "utf8"), after); assert.equal(await readFile(reference, "utf8"), beforeReference);
        const pending = (await store.inspectRecovery())[0]!; assert.equal(pending.state, "content-committed");
        sourceAllowed = async () => true;
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`);
        assert.equal(await readFile(reference, "utf8"), beforeReference, "revoked grant and an old intent cannot authorize unattended installed recovery");
        await assert.rejects(stat(added), /ENOENT/);
        await command("installed allow --acknowledge");
        sourceAllowed = async () => { if (await readFile(reference, "utf8") === "Changed reference") await permissions.setGlobalGrant(false); return true; };
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`);
        assert.equal(await readFile(reference, "utf8"), "Changed reference"); await assert.rejects(stat(added), /ENOENT/);
        assert.equal((await store.inspectRecovery())[0]!.state, "content-committed", "each recovery member must reauthorize after grant withdrawal");
        sourceAllowed = async () => false;
        await f.session.bindExtensions({ mode: "tui", uiContext: tui });
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`); await assert.rejects(stat(added), /ENOENT/);
        sourceAllowed = async () => true; await command(`pin ${hit.id}`);
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`); await assert.rejects(stat(added), /ENOENT/);
        await command(`unpin ${hit.id}`);
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`);
        assert.deepEqual(await store.inspectRecovery(), []); assert.equal(await readFile(added, "utf8"), "Retain this version in history");
        assert.equal((await command(`inspect ${hit.id}`)).skill.owner, "user-owned");
        assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
      }
      else {
        const latest = (await command(`history ${hit.id}`)).items[0];
        sourceAllowed = async () => await readFile(path, "utf8") !== after;
        const interrupted = await command(`rollback ${hit.id} ${latest.key}`); assert.equal(interrupted.status, "failed", JSON.stringify(interrupted));
        assert.equal(await readFile(path, "utf8"), after); assert.equal(await readFile(reference, "utf8"), beforeReference);
        await assert.rejects(stat(added), /ENOENT/);
        const pending = (await store.inspectRecovery())[0]!; assert.equal(pending.state, "content-committed");
        await assert.rejects(store.recover(pending.key, "abort"), /already committed/); await assert.rejects(store.assertReady(), /store-recovery-required/);
        await f.session.reload(); assert.equal((await command("status")).maintenance.length, 1);
        sourceAllowed = async () => true;
        await f.session.prompt(`/hermes-review recover ${pending.key} commit`);
        assert.deepEqual(await store.inspectRecovery(), []); assert.equal(await readFile(added, "utf8"), "Retain this version in history");
        assert.deepEqual((await command("status")).maintenance, []);
        assert.equal((await command(`rollback ${hit.id} ${change.key}`)).status, "changed");
        assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
        const original = history.items.find((row: { requestId: string }) => row.requestId === "original-version");
        const archived = await command(`rollback ${hit.id} ${original.key}`); assert.equal(archived.status, "changed", JSON.stringify(archived));
        assert.ok(archived.archiveId); await assert.rejects(stat(path), /ENOENT/);
        assert.equal((await command(`restore ${archived.archiveId}`)).status, "changed"); assert.equal(await readFile(path, "utf8"), before);
      }
    } finally { f.session.dispose(); }
  });
}
