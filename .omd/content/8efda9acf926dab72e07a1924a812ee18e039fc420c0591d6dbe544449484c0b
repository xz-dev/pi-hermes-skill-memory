import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { awaitWithAbort } from "./async.ts";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, readJson, scopedDirectory, withLock } from "./files.ts";
import { contentHash } from "./store.ts";
import type { SkillProposal, InstalledTarget } from "./store.ts";
import type { ArchivePlan } from "./archives.ts";
import type { Snapshot } from "./context.ts";

export interface InstalledDiff { file: string; before: string | null; after: string | null }
export interface CurationSelection { absorb: ArchivePlan; keepFiles: Record<string, string>; keepDiff: InstalledDiff[] }
export interface InstalledPreview { target: InstalledTarget; proposal: SkillProposal; diff: InstalledDiff[]; contentReview?: boolean; rollbackOf?: string; curation?: CurationSelection }
export interface LifecyclePreview { target: InstalledTarget; lifecycle: { action: "archive" | "restore"; plan: ArchivePlan }; diff: InstalledDiff[]; contentReview?: false }
export type PermissionPreview = InstalledPreview | LifecyclePreview;
export interface PendingSkill {
  id: string; preview: PermissionPreview; requestId: string; applying?: boolean; failure?: string;
  snapshot: Pick<Snapshot, "sessionId" | "leafId" | "cwd" | "digest" | "evidence" | "skillReads">;
}

export class PendingApproval extends Error {
  readonly id: string;
  constructor(id: string, reason?: string) { super(`Skill approval pending: ${id}${reason ? `; ${reason}` : ""}`); this.id = id; }
}

export async function confirmInstalledDiff(ctx: ExtensionContext, preview: PermissionPreview, signal?: AbortSignal): Promise<boolean> {
  if (ctx.mode !== "tui") throw new Error("confirmation-required: actual TUI is required");
  const text = [
    `Target: ${preview.target.id}`, `Scope: ${preview.target.scope}`, `Path: ${preview.target.filePath}`,
    `Base version: ${preview.target.version}`, `Owner: ${preview.target.owner} (unchanged after saving)`, `Reason: ${"proposal" in preview ? preview.proposal.reason : preview.lifecycle.plan.reason}`,
    ...("lifecycle" in preview ? [`Operation: ${preview.lifecycle.action}; location changes, not replacement prose.`,
      ...preview.lifecycle.plan.members.map(member => `${member.transfer}: ${member.file} @ ${member.version}`)] : []),
    ...("proposal" in preview && preview.rollbackOf ? [`Rollback recorded change: ${preview.rollbackOf}; exact prior bytes, removed members retained in history.`] : []),
    ...(preview.contentReview ? ["Content verification: unavailable. Approval accepts this change; it does not certify its assertions."] : []),
    ...preview.diff.flatMap(file => [`\n--- BEFORE ${file.file} ---`, file.before ?? "<not present>", `+++ AFTER ${file.file} +++`, file.after ?? "<removed from active skill; version retained in history>"]),
    // Stock TUI trims outer whitespace on submit. Keep file-ending whitespace inside the reviewed envelope.
    "\nEnd of exact diff. Content above must remain unchanged for approval.",
  ].join("\n");
  const inspected = await awaitWithAbort(ctx.ui.editor("Review exact skill diff — scroll to inspect; edits abort approval", text), signal);
  if (inspected !== text) return false;
  return await awaitWithAbort(ctx.ui.confirm(preview.contentReview ? "Accept this unverified content change? Not a factual certification." : `Apply this exact ${preview.target.owner} skill diff?`, JSON.stringify({ target: preview.target.id,
    scope: preview.target.scope, path: preview.target.filePath, version: preview.target.version,
    files: preview.diff.map(file => file.file), diffHash: contentHash(text), ownership: `remains ${preview.target.owner}` }, null, 2), { signal }), signal);
}

/** User-owned agentDir state only. No project/skill/model setting is ever consulted. */
export class InstalledPermissions {
  readonly agentDir: string;
  constructor(agentDir: string) { this.agentDir = agentDir; }
  private directory() { return join(this.agentDir, "hermes-skills", "provenance", "permissions"); }
  private async read(): Promise<{ version: 1; allowAutoModifyInstalledSkills: boolean; pending: PendingSkill[] }> {
    const dir = this.directory();
    if (!await scopedDirectory(this.agentDir, dir)) return { version: 1, allowAutoModifyInstalledSkills: false, pending: [] };
    try {
      const value = await readJson<{ version: 1; allowAutoModifyInstalledSkills: boolean; pending: PendingSkill[] }>(join(dir, "state.json"));
      if (value.version !== 1 || typeof value.allowAutoModifyInstalledSkills !== "boolean" || !Array.isArray(value.pending) || value.pending.length > 32 ||
        value.pending.some(row => row.id !== contentHash(JSON.stringify(row.preview)) || !row.snapshot || !row.requestId)) throw new Error("Invalid installed permission state");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if ((await readdir(dir)).some(file => file !== "state.lock")) throw new Error("Installed permission state missing; do not reset approvals");
      return { version: 1, allowAutoModifyInstalledSkills: false, pending: [] };
    }
  }
  private async change<T>(action: (value: Awaited<ReturnType<InstalledPermissions["read"]>>) => T): Promise<T> {
    const dir = this.directory(); await scopedDirectory(this.agentDir, dir, true);
    return withLock(join(dir, "state.lock"), async () => {
      const value = await this.read(), result = action(value);
      await open(join(dir, "initialized"), "a", 0o600).then(file => file.close());
      await atomicJson(join(dir, "state.json"), value); return result;
    });
  }
  async status() {
    const value = await this.read();
    return { allowAutoModifyInstalledSkills: value.allowAutoModifyInstalledSkills, pending: value.pending.map(row => ({
      id: row.id, target: row.preview.target.id, scope: row.preview.target.scope, version: row.preview.target.version,
      project: row.snapshot.cwd, applying: row.applying ?? false, failure: row.failure, contentReview: row.preview.contentReview ?? false, files: row.preview.diff.map(file => file.file),
    })) };
  }
  async allowed(): Promise<boolean> { return (await this.read()).allowAutoModifyInstalledSkills; }
  /** Only invoked by an explicit user command, not a model tool or project configuration. */
  async setGlobalGrant(allow: boolean): Promise<void> {
    if (typeof allow !== "boolean") throw new Error("Invalid user grant");
    await this.change(value => { value.allowAutoModifyInstalledSkills = allow; });
  }
  async enqueue(preview: PermissionPreview, snapshot: Snapshot, requestId: string, isCurrent?: () => boolean): Promise<string> {
    const evidence = "proposal" in preview ? preview.proposal.evidence : [];
    const citedEvidence = snapshot.evidence.filter(entry => evidence.some(item => item.entryId === entry.entryId)).map(entry => ({
      entryId: entry.entryId, text: evidence.filter(item => item.entryId === entry.entryId).map(item => item.quote).join("\n"),
    }));
    const row: PendingSkill = { id: contentHash(JSON.stringify(preview)), preview: structuredClone(preview), requestId,
      snapshot: structuredClone({ sessionId: snapshot.sessionId, leafId: snapshot.leafId, cwd: snapshot.cwd, digest: snapshot.digest,
        evidence: citedEvidence, skillReads: snapshot.skillReads?.filter(read => read.id === preview.target.id) }) };
    if (JSON.stringify(row).length > 384000) throw new Error("Installed proposal exceeds pending capacity");
    const id = row.id;
    await this.change(value => {
      if (isCurrent?.() === false) throw new Error("Stale pending proposal; no write eligibility");
      if (value.pending.some(row => row.id === id)) return;
      if (value.pending.length >= 32 || JSON.stringify(value.pending).length + JSON.stringify(row).length > 1_000_000) throw new Error("Pending capacity exhausted; inspect/reject existing proposals");
      value.pending.push(row);
    }); return id;
  }
  async get(id: string): Promise<PendingSkill> {
    const row = (await this.read()).pending.find(row => row.id === id);
    if (!row) throw new Error("Unknown pending proposal"); return structuredClone(row);
  }
  async assertNoApplying(except?: string): Promise<void> {
    const rows = (await this.read()).pending.filter(row => row.applying && row.id !== except);
    if (rows.length) throw new Error(`store-recovery-required: curate apply ${rows.map(row => row.id).join(", ")}; complete any child store recovery first`);
  }
  async applying(id: string, value: boolean, failure?: string): Promise<void> {
    await this.change(state => {
      const row = state.pending.find(row => row.id === id);
      if (!row || !("proposal" in row.preview) || !row.preview.curation) throw new Error("Unknown curation pending");
      row.applying = value;
      if (failure) row.failure = failure.slice(0, 1000); else delete row.failure;
    });
  }
  async remove(id: string, completedCuration = false): Promise<void> {
    await this.change(value => {
      if (!completedCuration && value.pending.some(row => row.id === id && row.applying)) throw new Error("Applying curation cannot be discarded; finish local recovery without replaying the model");
      value.pending = value.pending.filter(row => row.id !== id);
    });
  }
}
