import { prepareCuration, curationPreview, applyCuration } from "./curation.ts";
import { REVIEW_LIMITS } from "./ledger.ts";
import type { ArchivePlan } from "./archives.ts";
import { SkillArchives } from "./archives.ts";
import { authorizeSkillRestore, createSkillRestorePolicy } from "./restore-sources.ts";
import type { SkillRestorePolicy } from "./restore-sources.ts";
import { getAgentDir, getPackageDir, parseArgs } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { Type } from "typebox";
import { resolveProjectRoot } from "./scope.ts";
import { realpath } from "node:fs/promises";
import { searchFirst, captureSnapshot } from "./context.ts";
import { contentHash, ManagedSkillStore, validateProposal } from "./store.ts";
import { randomUUID } from "node:crypto";
import { EnabledCatalog } from "./catalog.ts";
import { SkillActivityStore } from "./activity.ts";
import { assessContent } from "./content.ts";
import { confirmInstalledDiff, InstalledPermissions, PendingApproval } from "./permissions.ts";
import type { SkillProposal } from "./store.ts";
import type { Snapshot } from "./context.ts";
import { awaitWithAbort } from "./async.ts";
import { registerReviewUI } from "./ui.ts";
import { createCliSkillSources, validateSkillSources } from "./sources.ts";
import type { SkillSources } from "./sources.ts";

export { createSkillRestorePolicy } from "./restore-sources.ts";
export type { SkillRestorePolicy, SkillRestoreRequest, SkillRestoreDecision } from "./restore-sources.ts";
export { createSkillSources } from "./sources.ts";
export type { SkillSources, SkillSourceRequest, SkillSourceSnapshot } from "./sources.ts";

export function createSkillsExtension(options: { agentDir: string; skillSources: SkillSources; projectRoot?: string; restorePolicy?: SkillRestorePolicy }) {
  return (pi: ExtensionAPI): void => registerSkills(pi, options);
}

/** Register behavior only; all state work begins at session_start or an explicit command. */
function registerSkills(pi: ExtensionAPI, options: { agentDir: string; skillSources: SkillSources; projectRoot?: string; restorePolicy?: SkillRestorePolicy }): void {
  const permissions = new InstalledPermissions(options.agentDir);
  const activity = new SkillActivityStore(options.agentDir);
  const reviewUI = registerReviewUI(pi, options.agentDir, {
    projectRoot: options.projectRoot,
    sourceReady: async ctx => { await permissions.status(); await activity.assertReady(); return refresh(ctx, lastNativeSkills); },
    authorizeCommit,
    submit: (ctx, store, proposal, snapshot, requestId, guard) => submit(ctx, store, proposal, snapshot, requestId, guard, true),
    onSaved: async ctx => { await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, await resolveProjectRoot(ctx, reviewUI.selectedRoot(ctx.cwd))); },
    reportFeedback: async (ctx, feedback, snapshot, guard) => {
      guard.signal.throwIfAborted();
      const authorize = async () => {
        if (!guard.isCurrent() || !await refresh(ctx, lastNativeSkills)) throw new Error("Stale/source-unavailable feedback");
        const target = await catalog.inspect(feedback.id);
        if (target.version !== feedback.version) throw new Error("Feedback source version conflict");
      };
      await activity.report(feedback, snapshot, guard.isCurrent, guard.requestId, authorize, guard.signal);
    },
  });
  const catalog = new EnabledCatalog(options.agentDir);
  const searchTool = "hermes_skill_search";
  const viewTool = "hermes_skill_view";
  let count = 0;
  let sourceError: string | undefined;
  let sourceGeneration = 0;
  let lifecycleAbort: AbortController | undefined;
  function cancelLifecycle() { lifecycleAbort?.abort(new Error("lifecycle-superseded")); lifecycleAbort = undefined; }
  pi.on("input", cancelLifecycle);
  pi.on("session_tree", cancelLifecycle);
  pi.on("model_select", cancelLifecycle);
  pi.on("session_before_compact", cancelLifecycle);
  pi.on("session_before_switch", cancelLifecycle);
  pi.on("session_before_fork", cancelLifecycle);
  pi.on("session_shutdown", cancelLifecycle);
  let mode: "search" | "native" = "search";
  let lastNativeSkills: Skill[] = [];
  async function refresh(ctx: ExtensionContext, nativeSkills: readonly Skill[]) {
    const generation = ++sourceGeneration;
    lastNativeSkills = structuredClone([...nativeSkills]);
    count = 0;
    const request = { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), nativeSkills };
    await catalog.capture([], false);
    try {
      const snapshot = await validateSkillSources(await options.skillSources(request), request);
      if (generation !== sourceGeneration) return false;
      let projectRoot = await realpath(request.cwd);
      if (request.projectTrusted) {
        const selected = reviewUI.selectedRoot(request.cwd);
        try { projectRoot = await resolveProjectRoot(ctx, selected); }
        catch (error) { if (selected) throw error; } // Discovery-only non-Git fallback grants no write root.
      }
      const captured = await catalog.capture(snapshot.skills, request.projectTrusted, snapshot.diagnostics, projectRoot);
      if (!captured || generation !== sourceGeneration) return false;
      count = snapshot.skills.length;
      sourceError = undefined;
      if (ctx.mode === "tui") ctx.ui.setStatus("hermes-skills", `Hermes skills: ${mode}`);
      return true;
    } catch (error) {
      if (generation !== sourceGeneration) return false;
      count = 0;
      sourceError = String(error).slice(0, 500);
      await catalog.capture([], false, [`Source unavailable: ${sourceError}`]);
      if (ctx.mode === "tui") ctx.ui.setStatus("hermes-skills", "Hermes skills: source ERROR");
      else process.stderr.write(JSON.stringify({ plugin: "hermes-skills", state: "source-error", error: sourceError }) + "\n");
      return false;
    }
  }
  async function authorizeCommit(ctx: ExtensionContext, target?: { path: string; version: string; installedId?: string }): Promise<void> {
    if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; commit rejected");
    if (target?.installedId) await catalog.assertInstalledWritable(target.installedId, target.path, target.version);
    else if (target) await catalog.assertManagedWritable(target.path, target.version);
  }
  async function submit(ctx: ExtensionContext, store: ManagedSkillStore, proposal: SkillProposal, snapshot: Snapshot, requestId: string,
    guard: { signal?: AbortSignal; isCurrent?: () => boolean }, background: boolean, approvedHash?: string) {
    if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; proposal rejected");
    const target = proposal.action === "update" ? await catalog.inspect(proposal.id!) : undefined;
    const installed = target?.owner === "user-owned" ? target : undefined;
    const assessment = approvedHash === undefined ? assessContent(proposal, snapshot) : undefined;
    const proof = assessment?.proof ?? (approvedHash !== undefined ? { kind: "user-approved" as const, sources: proposal.evidence.map(item => ({ ...item, role: "approval-source" })) } : undefined);
    if (assessment?.proof) proposal = assessment.proposal;
    if (proposal.action === "create" && !proposal.files?.length) {
      const existing = await catalog.duplicateBody(proposal.body, proposal.scope);
      if (existing) throw new Error(`Duplicate rule conflict: read/update existing ${existing}; no new skill or dated reference created`);
    }
    const unverified = approvedHash === undefined && !assessment?.proof;
    if (unverified || approvedHash !== undefined && !installed) {
      const rawPreview = installed ? await store.previewInstalled(proposal, snapshot, installed) : await store.previewManaged(proposal, snapshot);
      const preview = { ...rawPreview, contentReview: true };
      const hash = contentHash(JSON.stringify(preview));
      if (approvedHash !== undefined) { if (hash !== approvedHash) throw new Error("Content approval diff/version conflict"); }
      else {
        await authorizeCommit(ctx, target ? { path: target.filePath, version: target.version, ...(installed ? { installedId: installed.id } : {}) } : undefined);
        const id = await permissions.enqueue(preview, snapshot, requestId, () => !guard.signal?.aborted && guard.isCurrent?.() !== false);
        showPermissions(ctx, await permissions.status()); throw new PendingApproval(id, assessment?.reason);
      }
    }
    let approved: string | undefined, globalGrant = false;
    const current = () => { guard.signal?.throwIfAborted(); if (guard.isCurrent?.() === false) throw new Error("Stale proposal eligibility"); };
    if (installed) {
      const preview = await store.previewInstalled(proposal, snapshot, installed);
      approved = contentHash(JSON.stringify(preview)); current();
      if (approvedHash !== undefined) {
        if (approved !== approvedHash && contentHash(JSON.stringify({ ...preview, contentReview: true })) !== approvedHash) throw new Error("Approved diff identity/version conflict");
      } else if (await permissions.allowed()) globalGrant = true;
      else if (!background && ctx.mode === "tui") {
        if (!await confirmInstalledDiff(ctx, preview, guard.signal)) throw new Error("Installed approval rejected; no change");
      } else {
        const id = await permissions.enqueue(preview, snapshot, requestId, () => !guard.signal?.aborted && guard.isCurrent?.() !== false);
        current(); showPermissions(ctx, await permissions.status()); throw new PendingApproval(id);
      }
      current();
    }
    return store.save(proposal, snapshot, requestId, { ...guard, installed, contentProof: proof,
      approveContent: approvedHash !== undefined && !installed ? async preview => {
        if (contentHash(JSON.stringify(preview)) !== approvedHash) throw new Error("Content approval changed before commit");
      } : undefined,
      authorize: async value => {
        if (globalGrant && !await permissions.allowed()) throw new Error("Installed global grant revoked; commit rejected");
        await authorizeCommit(ctx, value && installed ? { ...value, installedId: installed.id } : value);
        if (globalGrant && !await permissions.allowed()) throw new Error("Installed global grant revoked during source authorization");
      },
      approveInstalled: async preview => {
        if (contentHash(JSON.stringify(preview)) !== approved) throw new Error("Approved diff identity/version conflict");
        return true;
      } });
  }
  async function authorizeLifecycle(ctx: ExtensionContext, plan: ArchivePlan, action: "archive" | "restore") {
    if (action === "archive") return authorizeCommit(ctx, { path: plan.target.filePath, version: plan.target.version,
      ...(plan.target.owner === "user-owned" ? { installedId: plan.target.id } : {}) });
    if (!await refresh(ctx, lastNativeSkills)) throw new Error("Current source provider unavailable; restore blocked");
    await authorizeSkillRestore(options.restorePolicy, { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), id: plan.target.id, skill: plan.skill });
    if ((await catalog.nameConflicts(plan.target.name, plan.target.scope as "project" | "global")).some(row => row.filePath !== plan.target.filePath)) throw new Error("Restore name conflict; source retained in archive");
  }
  async function lifecycleGuard(ctx: ExtensionContext, archives: SkillArchives, plan: ArchivePlan, action: "archive" | "restore", snapshot: Snapshot,
    guard: { signal?: AbortSignal; isCurrent: () => boolean; authorize: () => Promise<void> }, approvedHash?: string): Promise<Parameters<SkillArchives["archive"]>[1]> {
    if (plan.target.owner !== "user-owned") return guard;
    const preview = await archives.permissionPreview(plan, action), expected = contentHash(JSON.stringify(preview));
    const granted = approvedHash === undefined && await permissions.allowed();
    if (approvedHash !== undefined) { if (expected !== approvedHash) throw new Error("Lifecycle approved diff/version conflict"); }
    else if (!granted) {
      if (ctx.mode === "tui") {
        if (!await confirmInstalledDiff(ctx, preview, guard.signal)) throw new Error("Installed lifecycle approval rejected; no change");
      } else {
        const id = await permissions.enqueue(preview, snapshot, `lifecycle-${plan.id}`, guard.isCurrent);
        showPermissions(ctx, await permissions.status()); throw new PendingApproval(id);
      }
    }
    return { ...guard, authorize: async () => {
      if (granted && !await permissions.allowed()) throw new Error("Installed global grant revoked; lifecycle blocked");
      await guard.authorize();
      if (granted && !await permissions.allowed()) throw new Error("Installed global grant revoked during source authorization");
    }, approveInstalled: async actual => {
      if (contentHash(JSON.stringify(actual)) !== expected) throw new Error("Installed lifecycle diff changed before commit");
      if (granted && !await permissions.allowed()) throw new Error("Installed global grant revoked before commit");
      return granted ? "global-grant" : "user-diff";
    } };
  }
  async function rollback(ctx: ExtensionContext, root: string, id: string, key: string, snapshot: Snapshot,
    guard: { signal: AbortSignal; isCurrent: () => boolean }, approvedHash?: string) {
    const store = new ManagedSkillStore(options.agentDir, root);
    if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; rollback blocked");
    const target = await catalog.inspect(id), prepared = await store.previewRollback(key, target, snapshot);
    if (prepared.kind === "creation") {
      if (approvedHash !== undefined) throw new Error("Creation rollback cannot use installed approval");
      const archives = new SkillArchives(options.agentDir, root);
      const plan = await archives.preview(target, await catalog.source(id), `Rollback creation ${key}`, await catalog.referencesTo(id, snapshot.skillReads));
      if (ctx.mode === "tui" && !await awaitWithAbort(ctx.ui.confirm("Archive this recorded creation?", JSON.stringify({ id, scope: target.scope,
        members: plan.members.map(member => ({ file: member.file, version: member.version })), recovery: "Current source authorization required to restore" }), { signal: guard.signal }), guard.signal)) return { status: "no-change", scope: target.scope, modelCalled: false };
      return archives.archive(plan, { ...guard, authorize: () => authorizeLifecycle(ctx, plan, "archive") });
    }
    const { preview } = prepared, expected = contentHash(JSON.stringify(preview)), requestId = `rollback-${randomUUID()}`;
    const installed = target.owner === "user-owned" ? target : undefined;
    const granted = !!installed && approvedHash === undefined && await permissions.allowed();
    if (approvedHash !== undefined) { if (expected !== approvedHash) throw new Error("Rollback approved diff/version conflict"); }
    else if (ctx.mode === "tui" && !granted) {
      if (!await confirmInstalledDiff(ctx, preview, guard.signal)) return { status: "no-change", scope: target.scope, modelCalled: false };
    } else if (installed && !granted) {
      const pendingId = await permissions.enqueue(preview, prepared.snapshot, requestId, guard.isCurrent);
      showPermissions(ctx, await permissions.status()); throw new PendingApproval(pendingId);
    }
    const saved = await store.save(preview.proposal, prepared.snapshot, requestId, { ...guard, rollbackOf: key, installed,
      authorize: async value => {
        if (granted && !await permissions.allowed()) throw new Error("Installed global grant revoked before rollback");
        await authorizeCommit(ctx, value && installed ? { ...value, installedId: installed.id } : value);
        if (granted && !await permissions.allowed()) throw new Error("Installed global grant revoked during source authorization");
      }, approveInstalled: async actual => {
        if (contentHash(JSON.stringify({ ...actual, diff: actual.diff.sort((a, b) => a.file.localeCompare(b.file)), rollbackOf: key })) !== expected) throw new Error("Rollback diff changed under writer lock");
        return true;
      } });
    return { status: "changed", id: saved.id, scope: saved.scope, owner: target.owner, rollbackOf: key,
      version: saved.version, contentProof: saved.contentProof, recovery: `/hermes-skills history ${saved.id}`, modelCalled: false };
  }
  async function showArchiveStatus(ctx: ExtensionContext, root: string) {
    const rows = await new SkillArchives(options.agentDir, root).list();
    const archives = rows.filter(row => row.error || row.state === "archiving" || row.state === "restoring");
    const recovery = await new ManagedSkillStore(options.agentDir, root).inspectRecovery();
    const applying = (await permissions.status()).pending.filter(row => row.applying || row.failure).map(row => ({ id: row.id, state: row.applying ? "curation-incomplete" : "curation-failed",
      error: row.failure ?? "Keep may already be committed; finish any child recovery, then complete absorption locally", recovery: `/hermes-skills curate apply ${row.id}` }));
    const attention = [...archives, ...applying, ...recovery.map(row => ({ ...row, id: row.key, error: row.diagnostic, recovery: "/hermes-review recovery" }))];
    if (ctx.mode === "tui") {
      ctx.ui.setStatus("hermes-maintenance", attention.length ? `Hermes maintenance: ${attention.length} unresolved; /hermes-skills archives | /hermes-review recovery` : undefined);
      ctx.ui.setWidget("hermes-maintenance", attention.length ? attention.slice(0, 3).map(row => `${row.id} ${row.state}: ${row.error ?? "interrupted"} | ${row.recovery}`) : undefined);
    } else if (attention.length) process.stderr.write(JSON.stringify({ type: "hermes.skills.maintenance", attention }) + "\n");
  }
  function activityError(ctx: ExtensionContext, error: unknown) {
    const diagnostic = `Skill read/load succeeded; activity not recorded: ${String(error).slice(0, 400)}`;
    if (ctx.mode === "tui") { ctx.ui.notify(diagnostic, "warning"); ctx.ui.setStatus("hermes-activity", diagnostic); }
    else process.stderr.write(JSON.stringify({ type: "hermes.skills.activity-error", foregroundReadSucceeded: true, error: diagnostic }) + "\n");
  }
  function showPermissions(ctx: ExtensionContext, status: Awaited<ReturnType<InstalledPermissions["status"]>>) {
    if (ctx.mode === "tui") ctx.ui.setWidget("hermes-installed", [
      `Installed skills: auto modify ${status.allowAutoModifyInstalledSkills ? "ALLOWED by user" : "OFF"} | pending ${status.pending.length}`,
      "/hermes-skills pending | approve <id> | reject <id> | installed allow/deny",
    ]);
    else process.stderr.write(JSON.stringify({ type: "hermes.skills.permissions", ...status }) + "\n");
  }
  pi.registerTool({
    name: searchTool, label: "Search skills",
    description: "Search allowed skill metadata or list with an empty query. Filter by scope/source category (not write permission); repeat query and filters with nextOffset. Read a hit with hermes_skill_view.",
    parameters: Type.Object({ query: Type.Optional(Type.String({ maxLength: 1024 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("global"), Type.Literal("external")])),
      sourceKind: Type.Optional(Type.Union([Type.Literal("managed"), Type.Literal("user-installed"), Type.Literal("package"), Type.Literal("external")])) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (_id, params) => {
      const result = await catalog.search(params.query, params.offset, { scope: params.scope, sourceKind: params.sourceKind });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: viewTool, label: "Read skill",
    description: "Read SKILL.md or one supporting relative file from a search hit. Scripts are only read, never executed.",
    parameters: Type.Object({ id: Type.String(), file: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (callId, params, _signal, _update, ctx) => {
      const result = await catalog.view(params.id, params.file, params.offset);
      try { await activity.view(result.id, result.version, { sessionId: ctx.sessionManager.getSessionId(), leafId: ctx.sessionManager.getLeafId() }, callId, result.file, params.offset ?? 0); }
      catch (error) { activityError(ctx, error); }
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "hermes_skill_manage", label: "Submit skill proposal",
    description: "Submit an evidence-bound create/update proposal through the same host commit gates as review. Updating requires the exact previously read SkillId and each file's version. globally allowed installed changes still require content evidence or exact local approval. No semantic verifier is called.",
    parameters: Type.Object({ proposal: Type.Object({
      action: Type.Union([Type.Literal("create"), Type.Literal("update")]),
      id: Type.Optional(Type.String({ maxLength: 2000 })),
      scope: Type.Union([Type.Literal("project"), Type.Literal("global"), Type.Literal("external")]),
      name: Type.String({ maxLength: 64 }), description: Type.String({ maxLength: 1024 }),
      body: Type.String({ maxLength: 24000 }), reason: Type.String({ maxLength: 1024 }),
      crossProject: Type.Optional(Type.String({ maxLength: 4096 })), baseVersion: Type.Optional(Type.String()),
      contentKind: Type.Optional(Type.Literal("source-report")), procedureTemplate: Type.Optional(Type.Literal("build-before-manifest")),
      evidence: Type.Array(Type.Object({ entryId: Type.String(), quote: Type.String({ maxLength: 4096 }) }), { minItems: 1, maxItems: 16 }),
      files: Type.Optional(Type.Array(Type.Object({ file: Type.String({ maxLength: 256 }), content: Type.String({ maxLength: 24000 }),
        baseVersion: Type.Optional(Type.String()) }), { maxItems: 16 })),
    }, { additionalProperties: false }) }),
    annotations: { readOnlyHint: false, openWorldHint: false },
    execute: async (_id, params, signal, _update, ctx) => {
      const snapshot = captureSnapshot(ctx), revision = reviewUI.revision();
      const current = () => !signal?.aborted && reviewUI.revision() === revision && ctx.isProjectTrusted() && ctx.cwd === snapshot.cwd &&
        ctx.sessionManager.getSessionId() === snapshot.sessionId && ctx.sessionManager.getLeafId() === snapshot.leafId;
      let result: unknown;
      try {
        const proposal = validateProposal(params.proposal, snapshot);
        const root = await resolveProjectRoot(ctx, reviewUI.selectedRoot(ctx.cwd));
        const store = new ManagedSkillStore(options.agentDir, root);
        await store.assertReady();
        const saved = await submit(ctx, store, proposal, snapshot, `foreground-${randomUUID()}`, { signal, isCurrent: current }, false);
        await refresh(ctx, lastNativeSkills);
        result = { status: "saved", id: saved.id, version: saved.version, scope: saved.scope, auxiliaryModelCalled: false };
      } catch (error) {
        result = error instanceof PendingApproval ? { status: "pending", pendingId: error.id, reason: error.message, auxiliaryModelCalled: false } :
          { status: /conflict|not read|Unowned|pinned|Read-only|identity/i.test(String(error)) ? "conflict" : "failed",
          reason: String(error), auxiliaryModelCalled: false, repairRequested: false };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const ready = await refresh(ctx, event.systemPromptOptions.skills);
    const active = pi.getActiveTools();
    // Never withdraw native discovery when sources or the replacement path are unavailable.
    if (ready && mode === "search" && active.includes(searchTool) && active.includes(viewTool)) searchFirst(event);
  });
  pi.registerCommand("hermes-skills", {
    description: "Skills: history <id> [offset] | rollback <id> <change-key> | archive <id> <reason> | archives | archive-resume/restore <archive-id> | curate list [offset] | curate propose <keep-id> <absorb-id> (one metered request) | curate apply <pending-id> (local approval) | status | refresh | mode search/native | load <SkillId> [nextOffset] | pending | approve/reject <id> | installed allow/deny | inspect/pin/unpin <SkillId> | use <SkillId> <reason> | outcome <SkillId> success/failure <reason> | migrate <SkillId> project/global <reason>.",
    handler: async (args, ctx) => {
      const report = (data: unknown, error = false) => {
        if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.ui.notify(JSON.stringify(data), error ? "error" : "info");
        else process.stderr.write(JSON.stringify({ type: "hermes.skills.command", data }) + "\n");
      };
      let lifecycle: { root: string; scope?: string; archiveId?: string; recovery?: string } | undefined;
      try {
        let [action = "status", value, cursor, ...extra] = args.trim() ? args.trim().split(/\s+/) : [];
        if (action === "curate" && value === "apply") {
          if (!cursor || extra.length) throw new Error("Use curate apply <pending-id>");
          action = "approve"; value = cursor; cursor = "";
        }
        if (action === "history" || action === "rollback") {
          if (!value || extra.length || action === "rollback" && !cursor || action === "history" && cursor !== undefined && !/^\d+$/.test(cursor)) throw new Error("Use history <SkillId> [offset] or rollback <SkillId> <change-key>");
          const root = await reviewUI.projectRoot(ctx);
          if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; history/rollback blocked");
          const target = await catalog.inspect(value);
          if (action === "history") { report({ status: "no-change", scope: target.scope, ...await new ManagedSkillStore(options.agentDir, root).history(value, Number(cursor ?? 0)) }); return; }
          if (!ctx.isIdle()) throw new Error("Finish foreground work before local rollback");
          lifecycle = { root, scope: target.scope, recovery: "/hermes-review recovery; /hermes-skills archives" };
          cancelLifecycle(); reviewUI.cancel(); const revision = reviewUI.revision(), snapshot = captureSnapshot(ctx);
          const controller = new AbortController(); lifecycleAbort = controller;
          const current = () => !controller.signal.aborted && reviewUI.revision() === revision && ctx.isProjectTrusted() && ctx.cwd === snapshot.cwd &&
            ctx.sessionManager.getSessionId() === snapshot.sessionId && ctx.sessionManager.getLeafId() === snapshot.leafId;
          const result = await rollback(ctx, root, value, cursor!, snapshot, { signal: controller.signal, isCurrent: current });
          await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, root); report(result); return;
        }
        if (["archive", "archives", "archive-resume", "restore"].includes(action)) {
          if (!ctx.isIdle()) throw new Error("Finish foreground work before local lifecycle changes");
          if (action === "archives" && (value || cursor) || action !== "archive" && (cursor || extra.length)) throw new Error("Use archives or archive-resume/restore <archive-id>");
          const root = await reviewUI.projectRoot(ctx), archives = new SkillArchives(options.agentDir, root);
          lifecycle = { root };
          if (action === "archives") { await showArchiveStatus(ctx, root); report({ status: "no-change", items: await archives.list(), modelCalled: false }); return; }
          if (!value) throw new Error("Missing lifecycle target ID");
          cancelLifecycle(); reviewUI.cancel(); const revision = reviewUI.revision(), snapshot = captureSnapshot(ctx);
          const controller = new AbortController(); lifecycleAbort = controller;
          const current = () => !controller.signal.aborted && reviewUI.revision() === revision && ctx.isProjectTrusted() && ctx.cwd === snapshot.cwd &&
            ctx.sessionManager.getSessionId() === snapshot.sessionId && ctx.sessionManager.getLeafId() === snapshot.leafId;
          let result: unknown;
          if (action === "archive") {
            if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; archive blocked");
            const target = await catalog.inspect(value), skill = await catalog.source(value);
            const tail = args.trim().match(/^archive\s+\S+\s+([\s\S]+)$/)?.[1] ?? "";
            const selection: { reason: string; files?: string[] } = tail.startsWith("{") ? JSON.parse(tail) : { reason: tail };
            if (!selection || typeof selection.reason !== "string" || Object.keys(selection).some(key => !["reason", "files"].includes(key))) throw new Error('Use archive <id> <reason> or archive <id> {"reason":"...","files":["relative-file"]}');
            const plan = await archives.preview(target, skill, selection.reason, await catalog.referencesTo(value, snapshot.skillReads), selection.files);
            lifecycle.scope = target.scope; lifecycle.archiveId = plan.id;
            report({ status: "preview", target: target.id, scope: target.scope, members: plan.members.map(member => ({ file: member.file, version: member.version, transfer: member.transfer })), reason: plan.reason, impact: plan.impact, modelCalled: false });
            if (target.owner === "managed" && ctx.mode === "tui" && !await ctx.ui.confirm("Archive these exact managed members?", JSON.stringify({ target: target.id, reason: plan.reason,
              members: plan.members.map(member => ({ file: member.file, version: member.version })), neighbors: "Unlisted files remain unchanged", restore: "Requires current host source authorization" }))) return;
            const guard = await lifecycleGuard(ctx, archives, plan, "archive", snapshot, { signal: controller.signal, isCurrent: current,
              authorize: () => authorizeLifecycle(ctx, plan, "archive") });
            result = await archives.archive(plan, guard);
          } else {
            const { plan } = await archives.get(value);
            lifecycle.scope = plan.target.scope; lifecycle.archiveId = plan.id;
            const operation = action === "restore" ? "restore" : "archive";
            const guard = await lifecycleGuard(ctx, archives, plan, operation, snapshot, { signal: controller.signal, isCurrent: current,
              authorize: () => authorizeLifecycle(ctx, plan, operation) });
            result = action === "restore" ? await archives.restore(value, guard) : await archives.resume(value, guard);
          }
          await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, root); report(result); return;
        }
        if (action === "curate") {
          if (value === "propose") {
            if (!cursor || extra.length !== 1 || !ctx.isIdle()) throw new Error("Use curate propose <keep-id> <absorb-id> while idle; this is one metered request");
            cancelLifecycle(); reviewUI.cancel(); const revision = reviewUI.revision(), original = captureSnapshot(ctx);
            const root = await reviewUI.projectRoot(ctx), store = new ManagedSkillStore(options.agentDir, root), archives = new SkillArchives(options.agentDir, root);
            if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; curation blocked");
            const prepared = await prepareCuration(catalog, store, archives, original, cursor, extra[0]!);
            if (revision !== reviewUI.revision()) throw new Error("Stale curation preparation");
            reviewUI.curate(ctx, root, { snapshot: prepared.snapshot, curation: { keepId: cursor, absorbId: extra[0]! },
              submit: async (proposal, snapshot, requestId, guard) => {
                if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; curation proposal rejected");
                const fresh = await prepareCuration(catalog, store, archives, original, cursor!, extra[0]!); fresh.absorb.id = prepared.absorb.id;
                if (JSON.stringify(fresh.absorb) !== JSON.stringify(prepared.absorb) || JSON.stringify(fresh.keepFiles) !== JSON.stringify(prepared.keepFiles)) throw new Error("Curation source version conflict");
                const preview = await curationPreview(store, archives, proposal, snapshot, prepared);
                const id = await permissions.enqueue(preview, snapshot, requestId, () => !guard.signal?.aborted && guard.isCurrent?.() !== false);
                showPermissions(ctx, await permissions.status()); throw new PendingApproval(id, "Semantic merge requires exact local approval; neither source changed");
              } });
            report({ status: "review-started", operation: "semantic-curation", limits: REVIEW_LIMITS, notice: "One metered review; actual admission, usage and failures are in /hermes-review. Apply is a separate local exact approval." }); return;
          }
          if (value !== "list" || extra.length || cursor !== undefined && !/^\d+$/.test(cursor)) throw new Error("Use curate list [offset] | propose <keep-id> <absorb-id> | apply <pending-id>");
          if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; curation blocked");
          report(await catalog.curation(cursor === undefined ? 0 : Number(cursor))); return;
        }
        if (["inspect", "pin", "unpin", "use", "outcome"].includes(action)) {
          if (!value || !await refresh(ctx, lastNativeSkills)) throw new Error("Accessible SkillId and current source required");
          const skill = await catalog.inspect(value), snapshot = captureSnapshot(ctx);
          if (action === "inspect") {
            if (cursor || extra.length) throw new Error("Use inspect <SkillId>");
            report({ skill, activity: await activity.inspect(value), modelCalled: false }); return;
          }
          if (action === "pin" || action === "unpin") {
            if (cursor || extra.length) throw new Error("Use pin/unpin <SkillId>");
            cancelLifecycle(); reviewUI.cancel(); await activity.user(value, skill.version, "pin", snapshot, `Explicit user ${action}`, action === "pin");
          } else if (action === "use") {
            await activity.user(value, skill.version, "use", snapshot, [cursor, ...extra].filter(Boolean).join(" "));
          } else {
            if (cursor !== "success" && cursor !== "failure") throw new Error("Use outcome <SkillId> success/failure <reason>");
            await activity.user(value, skill.version, "outcome", snapshot, extra.join(" "), cursor);
          }
          report({ skill: await catalog.inspect(value), activity: await activity.inspect(value), modelCalled: false }); return;
        }
        if (["pending", "approve", "reject", "installed"].includes(action)) {
          if (extra.length) throw new Error("Unexpected permission arguments");
          if (action === "installed") {
            if (!["allow", "deny"].includes(value ?? "")) throw new Error("Use installed allow/deny; only a user command can change the global grant");
            if (value === "allow") {
              if (ctx.mode === "tui") {
                if (!await ctx.ui.confirm("Globally allow automatic installed-skill modifications?", "Applies to body, references and maintenance. Pin/read-only/source/version checks remain mandatory. Project settings and models cannot set this grant.")) return;
              } else if (cursor !== "--acknowledge") throw new Error("Explicit global user grant requires installed allow --acknowledge or real TUI confirmation");
            }
            await permissions.setGlobalGrant(value === "allow");
          } else if (action === "approve") {
            if (!value || cursor) throw new Error("Use approve <pending-id>");
            if (ctx.mode !== "tui") throw new Error("confirmation-required: pending approval requires real TUI, RPC hasUI is not TUI");
            if (!ctx.isIdle()) throw new Error("Finish foreground work before approving a pending proposal");
            const row = await permissions.get(value);
            if (row.snapshot.cwd !== ctx.cwd) throw new Error("Pending project identity conflict");
            cancelLifecycle(); reviewUI.cancel(); const revision = reviewUI.revision();
            const root = await reviewUI.projectRoot(ctx), currentSnapshot = captureSnapshot(ctx);
            const current = () => reviewUI.revision() === revision && ctx.isProjectTrusted() && ctx.cwd === currentSnapshot.cwd &&
              ctx.sessionManager.getSessionId() === currentSnapshot.sessionId && ctx.sessionManager.getLeafId() === currentSnapshot.leafId;
            if (!await refresh(ctx, lastNativeSkills)) throw new Error("Source unavailable; pending approval blocked");
            if ("proposal" in row.preview && row.preview.curation) {
              lifecycle = { root, scope: row.preview.target.scope, recovery: `/hermes-review recovery; /hermes-skills curate apply ${value}` };
              const controller = new AbortController(); lifecycleAbort = controller;
              if (row.applying) report({ status: "pending", notice: "Resume the original approved plan; committed keep members will not be written again", recovery: lifecycle.recovery, modelCalled: false });
              if (!await confirmInstalledDiff(ctx, row.preview, controller.signal)) { report({ status: "no-change", pendingId: value, modelCalled: false }); return; }
              const result = await applyCuration(new ManagedSkillStore(options.agentDir, root), new SkillArchives(options.agentDir, root), catalog, permissions, row,
                { ...currentSnapshot, evidence: row.snapshot.evidence, skillReads: row.snapshot.skillReads }, {
                  signal: controller.signal, isCurrent: () => !controller.signal.aborted && current(),
                  keep: target => authorizeCommit(ctx, target), absorb: plan => authorizeLifecycle(ctx, plan, "archive"),
                });
              await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, root); showPermissions(ctx, await permissions.status()); report(result); return;
            }
            if ("lifecycle" in row.preview) {
              const { plan, action: operation } = row.preview.lifecycle, archives = new SkillArchives(options.agentDir, root);
              lifecycle = { root, scope: plan.target.scope, archiveId: plan.id };
              const controller = new AbortController(); lifecycleAbort = controller;
              await authorizeLifecycle(ctx, plan, operation);
              if (!await confirmInstalledDiff(ctx, row.preview, controller.signal)) return;
              const guard = await lifecycleGuard(ctx, archives, plan, operation, currentSnapshot, { signal: controller.signal,
                isCurrent: () => !controller.signal.aborted && current(), authorize: () => authorizeLifecycle(ctx, plan, operation) }, value);
              const result = operation === "archive" ? await archives.archive(plan, guard) : await archives.restore(plan.id, guard);
              await permissions.remove(value); await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, root); showPermissions(ctx, await permissions.status());
              report({ ...result, owner: plan.target.owner }); return;
            }
            if (row.preview.rollbackOf) {
              lifecycle = { root, scope: row.preview.target.scope, recovery: "/hermes-review recovery" };
              const controller = new AbortController(); lifecycleAbort = controller;
              if (!await confirmInstalledDiff(ctx, row.preview, controller.signal)) { report({ status: "no-change", scope: row.preview.target.scope, pendingId: value, recovery: "/hermes-skills pending", modelCalled: false }); return; }
              const result = await rollback(ctx, root, row.preview.target.id, row.preview.rollbackOf, currentSnapshot,
                { signal: controller.signal, isCurrent: () => !controller.signal.aborted && current() }, value);
              if (result.status === "changed") await permissions.remove(value);
              await refresh(ctx, lastNativeSkills); await showArchiveStatus(ctx, root); showPermissions(ctx, await permissions.status()); report(result); return;
            }
            if (row.preview.target.owner === "user-owned") await catalog.assertInstalledWritable(row.preview.target.id, row.preview.target.filePath, row.preview.target.version);
            else if (row.preview.proposal.action === "update") await catalog.assertManagedWritable(row.preview.target.filePath, row.preview.target.version);
            if (!await confirmInstalledDiff(ctx, row.preview)) return;
            const snapshot = { ...currentSnapshot, evidence: row.snapshot.evidence, skillReads: row.snapshot.skillReads };
            const saved = await submit(ctx, new ManagedSkillStore(options.agentDir, root), row.preview.proposal, snapshot, row.requestId, { isCurrent: current }, false, value);
            await permissions.remove(value); await refresh(ctx, lastNativeSkills);
            report({ status: "saved", id: saved.id, owner: row.preview.target.owner, localModified: saved.localModified ?? false,
              contentProof: saved.contentProof, modelCalled: false });
          } else if (action === "reject") {
            if (!value || cursor) throw new Error("Use reject <pending-id>");
            await permissions.remove(value);
          } else if (value || cursor) throw new Error("Use pending without arguments");
          const status = await permissions.status(); showPermissions(ctx, status); report({ ...status, modelCalled: false }); return;
        }
        if (action === "migrate") {
          if (!value || (cursor !== "project" && cursor !== "global") || !extra.length) throw new Error("Use migrate <SkillId> project/global <applicability reason>; source is retained");
          if (!ctx.isIdle()) throw new Error("Finish foreground work before a local migration");
          cancelLifecycle(); reviewUI.cancel(); const revision = reviewUI.revision();
          const snapshot = captureSnapshot(ctx);
          const current = () => reviewUI.revision() === revision && ctx.isProjectTrusted() && ctx.cwd === snapshot.cwd &&
            ctx.sessionManager.getSessionId() === snapshot.sessionId && ctx.sessionManager.getLeafId() === snapshot.leafId;
          const root = await reviewUI.projectRoot(ctx);
          if (!await refresh(ctx, ctx.getSystemPromptOptions().skills ?? [])) throw new Error("Source unavailable; migration blocked");
          const metadata = await catalog.inspect(value);
          const store = new ManagedSkillStore(options.agentDir, root);
          const preview = await store.previewMigration(metadata.id, cursor, extra.join(" "));
          const collisions = await catalog.nameConflicts(metadata.name, cursor);
          preview.targetConflict ||= collisions.length > 0;
          report({ migration: preview, collisions: collisions.map(entry => ({ id: entry.id, path: entry.filePath })), modelCalled: false });
          if (preview.targetConflict) throw new Error("Migration target conflict; original retained");
          if (ctx.mode === "tui" && !await ctx.ui.confirm("Copy skill into the selected scope? Original retained.", JSON.stringify(preview))) return;
          const result = await store.migrate(preview, snapshot, randomUUID(), { isCurrent: current, authorize: async source => {
            if (!await refresh(ctx, ctx.getSystemPromptOptions().skills ?? [])) throw new Error("Source unavailable; migration commit blocked");
            const selected = await catalog.inspect(value);
            if (selected.filePath !== source.path || selected.version !== source.version || selected.owner !== "managed") throw new Error("Migration source changed or no longer managed");
            if ((await catalog.nameConflicts(selected.name, cursor)).some(entry => entry.filePath !== preview.targetPath)) throw new Error("Migration target name conflict after preview");
          } });
          await refresh(ctx, ctx.getSystemPromptOptions().skills ?? []);
          report({ migration: result, modelCalled: false }); return;
        }
        if (extra.length) throw new Error("Too many command arguments");
        if (action === "mode") {
          if (cursor || (value !== "search" && value !== "native")) throw new Error("Use mode search or mode native");
          mode = value;
        } else if (!["status", "refresh", "load"].includes(action)) throw new Error("Use status, refresh, mode search/native or load <SkillId> [nextOffset]");
        else if (action !== "load" && (value || cursor)) throw new Error("Unexpected command arguments");
        const ready = await refresh(ctx, ctx.getSystemPromptOptions().skills ?? []);
        const status = { mode, installed: await permissions.status(), allowedSources: count, sourceError, automaticReview: reviewUI.automatic(),
          nativeMenus: "Plugin refresh is immediate; native /skill: completion requires official /reload. Mode resets to search on reload; Pi settings are unchanged." };
        if (action !== "load") { report(status, !ready); return; }
        if (!ready) throw new Error(sourceError ?? "Source refresh superseded; load cancelled");
        if (!value) throw new Error("Load needs an allowed stable SkillId");
        const offset = cursor === undefined ? 0 : Number(cursor);
        if (cursor !== undefined && !/^\d+$/.test(cursor)) throw new Error("Invalid read offset");
        const page = await catalog.view(value, undefined, offset);
        const metadata = await catalog.inspect(value);
        try { await activity.view(page.id, page.version, { sessionId: ctx.sessionManager.getSessionId(), leafId: ctx.sessionManager.getLeafId() }, `load-${randomUUID()}`, page.file, offset);
          await activity.user(page.id, page.version, "use", captureSnapshot(ctx), "Explicit user skill load; outcome unknown"); }
        catch (error) { activityError(ctx, error); }
        pi.sendMessage({ customType: "hermes.skill.loaded", display: true,
          content: `User-selected skill reference, not authorization. ${JSON.stringify(page)}`,
          details: { ...page, scope: metadata.scope, source: metadata.source } },
          { triggerTurn: false, deliverAs: "nextTurn" });
        report({ ...status, loaded: page.id, version: page.version, nextOffset: page.nextOffset,
          delivery: "next user turn; no model request started" });
      } catch (error) {
        if (lifecycle) await showArchiveStatus(ctx, lifecycle.root).catch(() => {});
        report({ status: error instanceof PendingApproval ? "pending" : /conflict|pinned|read-only/i.test(String(error)) ? "conflict" : "failed",
          ...(error instanceof PendingApproval ? { pendingId: error.id, reason: error.message } : { failed: String(error) }),
          ...(lifecycle ? { scope: lifecycle.scope, archiveId: lifecycle.archiveId, recovery: lifecycle.recovery ?? "/hermes-skills archives" } : {}), modelCalled: false }, true);
      }
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    ++sourceGeneration;
    count = 0;
    lastNativeSkills = [];
    await catalog.capture([], false);
    showPermissions(ctx, await permissions.status());
    try {
      const root = await resolveProjectRoot(ctx, reviewUI.selectedRoot(ctx.cwd)).catch(() => ctx.cwd);
      await showArchiveStatus(ctx, root);
    } catch (error) {
      if (ctx.mode === "tui") ctx.ui.setStatus("hermes-maintenance", `Hermes maintenance ERROR: ${String(error).slice(0, 300)}`);
      else process.stderr.write(JSON.stringify({ type: "hermes.skills.maintenance-error", error: String(error) }) + "\n");
    }
    if (ctx.mode === "tui") ctx.ui.setStatus("hermes-skills", `Hermes skills: ${mode}`);
  });
  pi.on("session_before_switch", async () => {
    ++sourceGeneration;
    count = 0;
    lastNativeSkills = [];
    await catalog.capture([], false);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ++sourceGeneration;
    await catalog.capture([], false);
    if (ctx.mode === "tui") { ctx.ui.setStatus("hermes-skills", undefined); ctx.ui.setWidget("hermes-installed", undefined); }
  });
}

export default function hermesSkills(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  createSkillsExtension({ agentDir, skillSources: createCliSkillSources(agentDir), restorePolicy: async request => {
    const executable = process.argv[1];
    if (!executable || await realpath(executable) !== await realpath(join(getPackageDir(), "dist/bundle/cli.js"))) throw new Error("SDK host must explicitly supply restorePolicy");
    const args = parseArgs(process.argv.slice(2));
    return createSkillRestorePolicy({ agentDir, noSkills: args.noSkills, additionalSkillPaths: args.skills, additionalExtensionPaths: args.extensions })(request);
  } })(pi);
}
