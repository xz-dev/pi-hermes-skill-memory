import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { loadSkillsFromDir, parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./context.ts";
import { atomicJson, readJson, scopedDirectory, withLock } from "./files.ts";
import type { ContentProof } from "./content.ts";
import { assessContent } from "./content.ts";
import type { InstalledPreview } from "./permissions.ts";
import { InstalledPermissions, PendingApproval } from "./permissions.ts";
import { SkillActivityStore } from "./activity.ts";
import { SkillArchives } from "./archives.ts";
import { awaitWithAbort } from "./async.ts";

export interface SkillProposal {
  action: "create" | "update";
  id?: string;
  scope: "project" | "global" | "external";
  name: string; description: string; body: string; reason: string;
  crossProject?: string;
  baseVersion?: string;
  contentKind?: "source-report";
  procedureTemplate?: "build-before-manifest";
  files?: { file: string; content: string; baseVersion?: string }[];
  evidence: { entryId: string; quote: string }[];
}
export interface MigrationPreview {
  source: ManagedSkill; targetScope: "project" | "global"; targetPath: string; targetConflict: boolean;
  sourceRetained: true; reason: string;
}
export interface InstalledTarget {
  id: string; name: string; scope: string; filePath: string; baseDir: string; version: string;
  owner: "managed" | "user-owned"; source: string; namespace: string; readOnly: boolean; pinned: boolean;
  projectIdentity?: string;
}
export interface ManagedSkill {
  id: string; name: string; description: string; scope: "project" | "global" | "external";
  path: string; version: string; createdBy: "hermes-skills";
  requestId: string; sessionId: string; evidence: SkillProposal["evidence"];
  pinned: boolean;
  localModified?: boolean;
  contentProof?: ContentProof;
  files?: Record<string, string>;
}
export const normalizedBody = (body: string) => body.trim().replace(/\r\n/g, "\n");
export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");

interface CommitMember { file: string; path: string; before: string | null; content: string | null; stage: string }
interface RecoveryPlan {
  version: 1; key: string; record: ManagedSkill; reason: string;
  canonicalParent: string; canonicalRoot: string;
  before: string | null; content: string; stage: string;
  installed?: InstalledTarget;
  members?: CommitMember[];
  rollbackOf?: string;
}
interface ChangeReceipt { status: "intent" | "saved" | "aborted"; record: ManagedSkill; reason: string; plan?: RecoveryPlan }
interface Approval { key: string; path: string; hash: string; state: "pending" | "saved" | "aborted"; plan: RecoveryPlan }
export interface RecoveryItem {
  key: string; scope: "project" | "global" | "external"; path: string;
  state: "prepared" | "content-committed" | "conflict" | "unsupported" | "saved" | "aborted";
  beforeVersion: string | null; afterVersion: string; diagnostic?: string;
  members?: { file: string; state: "prepared" | "committed" | "conflict" | "unchanged"; beforeVersion: string | null; afterVersion: string | null }[];
}


export function validateProposal(value: unknown, snapshot: Snapshot): SkillProposal {
  if (!value || typeof value !== "object") throw new Error("Invalid proposal object");
  const p = value as SkillProposal;
  if (!["create", "update"].includes(p.action) || !["project", "global", "external"].includes(p.scope) || p.action === "create" && p.scope === "external") throw new Error("Invalid action or scope");
  if (typeof p.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.name) || p.name.length > 64) throw new Error("Invalid skill name");
  for (const key of ["description", "body", "reason"] as const) {
    if (typeof p[key] !== "string" || !p[key].trim()) throw new Error(`Missing ${key}`);
  }
  if (p.description.length > 1024 || p.body.length > 24000 || p.reason.length > 1024 || (p.crossProject?.length ?? 0) > 4096) throw new Error("Proposal exceeds skill content limit");
  if (p.scope === "global" && (typeof p.crossProject !== "string" || !p.crossProject.trim())) throw new Error("Global scope needs cross-project evidence");
  if (!Array.isArray(p.evidence) || !p.evidence.length || p.evidence.length > 16) throw new Error("Missing or excessive evidence");
  for (const item of p.evidence) {
    if (!item || typeof item.entryId !== "string" || item.entryId.length > 2000 || typeof item.quote !== "string" || item.quote.length > 4096 || !item.quote.trim()) throw new Error("Invalid evidence");
    if (!snapshot.evidence.some(e => e.entryId === item.entryId && e.text.includes(item.quote))) throw new Error("Evidence not in effective snapshot");
  }
  if (p.action === "update" && (typeof p.id !== "string" || !p.id || p.id.length > 2000)) throw new Error("Update requires stable target identity");
  if (p.action === "create" && p.id !== undefined) throw new Error("Create identity is assigned by the host");
  if (p.action === "update" && !/^[a-f0-9]{64}$/.test(p.baseVersion ?? "")) throw new Error("Update needs read version");
  if (p.contentKind !== undefined && p.contentKind !== "source-report" || p.procedureTemplate !== undefined && p.procedureTemplate !== "build-before-manifest") throw new Error("Unknown content proof format");
  if (p.files !== undefined) {
    if (!Array.isArray(p.files) || p.files.length > 16) throw new Error("Invalid or excessive file members");
    const seen = new Set<string>(["SKILL.md"]); let size = p.body.length;
    for (const file of p.files) {
      if (!file || typeof file.file !== "string" || file.file.length > 256 || file.file.includes("\\") ||
        file.file.startsWith("/") || /^[a-zA-Z]:/.test(file.file) || file.file.split("/").some(part => !part || part === "." || part === "..") || seen.has(file.file)) {
        throw new Error("Invalid, duplicate or escaping file member");
      }
      if (typeof file.content !== "string" || file.content.length > 24000) throw new Error("Invalid or excessive file content");
      if (file.baseVersion !== undefined && !/^[a-f0-9]{64}$/.test(file.baseVersion)) throw new Error("Invalid file read version");
      seen.add(file.file); size += file.content.length;
    }
    if (size > 128000) throw new Error("Proposal exceeds total member capacity");
  }
  return structuredClone(p);
}

function proposalContent(p: SkillProposal, before: string | null, installed: boolean): string {
  const metadata = installed && before !== null ? { ...parseFrontmatter(before).frontmatter, name: p.name, description: p.description } : undefined;
  return metadata ? `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${p.body.trim()}\n` :
    `---\nname: ${p.name}\ndescription: ${JSON.stringify(p.description)}\n---\n\n${p.body.trim()}\n`;
}

export class ManagedSkillStore {
  readonly agentDir: string;
  readonly projectRoot: string;
  constructor(agentDir: string, projectRoot: string) {
    this.agentDir = agentDir;
    this.projectRoot = projectRoot;
  }
  private stateDir(scope: SkillProposal["scope"]) {
    return scope === "project" ? join(this.projectRoot, ".pi", "hermes-skills") : join(this.agentDir, "hermes-skills");
  }
  private skillRoot(scope: SkillProposal["scope"]) {
    return scope === "project" ? join(this.projectRoot, ".pi", "skills", "hermes-managed") : join(this.agentDir, "skills", "hermes-managed");
  }
  private async records(scope: SkillProposal["scope"]): Promise<ManagedSkill[]> {
    const dir = this.stateDir(scope);
    if (!await scopedDirectory(scope === "project" ? this.projectRoot : this.agentDir, dir)) return [];
    let files: string[];
    try { files = await readdir(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    if (!files.includes("manifest.json")) {
      if (files.some(name => name !== "store.lock" && name !== "provenance")) throw new Error("Ownership manifest missing");
      return [];
    }
    const records = await readJson<ManagedSkill[]>(join(dir, "manifest.json"));
    if (!Array.isArray(records) || records.some(r => r.createdBy !== "hermes-skills" || !r.id || !r.version)) throw new Error("Invalid ownership manifest");
    return records;
  }
  async catalog(): Promise<ManagedSkill[]> {
    const hidden = new Set(await new SkillArchives(this.agentDir, this.projectRoot).hiddenIds());
    return [...await this.records("project"), ...await this.records("global")].filter(record => !hidden.has(record.id));
  }

  async previewMigration(id: string, targetScope: "project" | "global", reason: string): Promise<MigrationPreview> {
    if (!["project", "global"].includes(targetScope) || !reason.trim() || reason.length > 1024) throw new Error("Migration needs an explicit scope and applicability reason");
    await this.assertReady();
    const candidate = (await this.catalog()).find(record => record.id === id);
    if (!candidate) throw new Error("Unknown managed migration source");
    const source = await this.ownership(await realpath(candidate.path), candidate.scope);
    if (!source || source.scope === targetScope || source.scope === "external") throw new Error("Migration needs a proven source in a different scope");
    if (contentHash(await readFile(source.path, "utf8")) !== source.version) throw new Error("Migration source version conflict");
    const targetPath = join(this.skillRoot(targetScope), source.name, "SKILL.md");
    let targetConflict = (await this.records(targetScope)).some(record => record.name === source.name);
    try { await realpath(dirname(targetPath)); targetConflict = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { source, targetScope, targetPath, targetConflict, sourceRetained: true, reason };
  }

  /** Explicit scoped copy: retain the exact original version, never silently archive or widen scope. */
  async migrate(preview: MigrationPreview, snapshot: Snapshot, requestId: string, guard?: {
    isCurrent?: () => boolean;
    authorize?: (source: { path: string; version: string }) => Promise<void>;
  }) {
    if (!/^[\w-]+$/.test(requestId)) throw new Error("Invalid migration identity");
    const fresh = await this.previewMigration(preview.source.id, preview.targetScope, preview.reason);
    if (fresh.source.version !== preview.source.version || fresh.targetPath !== preview.targetPath) throw new Error("Migration preview version conflict");
    if (fresh.targetConflict) throw new Error("Migration target conflict: original retained");
    const source = fresh.source;
    const members = Object.entries(source.files ?? { "SKILL.md": source.version });
    const files: { file: string; content: string }[] = [];
    const check = async () => {
      if (guard?.isCurrent?.() === false) throw new Error("Stale migration eligibility");
      await guard?.authorize?.({ path: source.path, version: source.version });
      for (const [file, version] of members) {
        const path = join(dirname(source.path), ...file.split("/"));
        await this.verifyMember({ file, path, before: null, content: "", stage: path + ".migration-new" }, dirname(source.path));
        if (contentHash(await readFile(path, "utf8")) !== version) throw new Error("Migration source member version conflict");
      }
    };
    await check();
    for (const [file] of members) if (file !== "SKILL.md") files.push({ file, content: await readFile(join(dirname(source.path), ...file.split("/")), "utf8") });
    const content = await readFile(source.path, "utf8");
    const evidence = { entryId: `user-migration-${requestId}`, quote: preview.reason };
    const localSnapshot = { ...snapshot, evidence: [...snapshot.evidence, { entryId: evidence.entryId, text: evidence.quote }] };
    const state = join(this.approvalDir(), "migrations");
    await scopedDirectory(this.agentDir, state, true);
    const receipt = join(state, `${requestId}.json`);
    await atomicJson(receipt, { status: "intent", ...fresh, sourceContent: content, sourceMembers: files });
    const target = await this.save({ action: "create", scope: preview.targetScope, name: source.name, description: source.description,
      body: stripFrontmatter(content), reason: preview.reason, crossProject: preview.targetScope === "global" ? preview.reason : undefined,
      files, evidence: [evidence] }, localSnapshot, requestId, { isCurrent: guard?.isCurrent, authorize: check, retainedPin: source.pinned });
    await atomicJson(receipt, { status: "copied", ...fresh, sourceContent: content, sourceMembers: files, target });
    return { ...fresh, target, receipt, sourceRetained: true, modelCalled: false };
  }

  /** Location identity stays stable when ownership evidence disappears; it grants no permission. */
  async identity(path: string, scope: SkillProposal["scope"]): Promise<string | undefined> {
    if (scope === "external") return undefined;
    const root = this.skillRoot(scope);
    let canonicalRoot: string;
    try { canonicalRoot = await realpath(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (!path.startsWith(canonicalRoot + sep)) return undefined;
    const parent = await realpath(scope === "project" ? this.projectRoot : this.agentDir);
    if (!canonicalRoot.startsWith(parent + sep)) return undefined;
    const rel = relative(canonicalRoot, path).split(sep);
    if (rel.length !== 2 || rel[1] !== "SKILL.md" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rel[0]!)) return undefined;
    return `${scope}:${contentHash(parent).slice(0, 16)}:managed:${rel[0]}`;
  }

  /** Discovery may report ownership, but only matching creation provenance grants it. */
  async ownership(path: string, scope: SkillProposal["scope"]): Promise<ManagedSkill | undefined> {
    const identity = await this.identity(path, scope);
    if (!identity) return undefined;
    const root = this.skillRoot(scope);
    const records = await this.records(scope);
    let record: ManagedSkill | undefined;
    for (const candidate of records) {
      if (candidate.scope !== scope || typeof candidate.path !== "string") continue;
      try { if (await realpath(candidate.path) === path) { record = candidate; break; } }
      catch { /* Missing records cannot grant ownership. */ }
    }
    if (!record || record.createdBy !== "hermes-skills" || typeof record.requestId !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name) || !/^[\w-]+$/.test(record.requestId) ||
      !Array.isArray(record.evidence) || !record.evidence.length || !record.sessionId) return undefined;
    if (record.path !== join(root, record.name, "SKILL.md") ||
      record.id !== identity) return undefined;
    const change = await readJson<ChangeReceipt>(
      join(this.stateDir(scope), "changes", `${record.requestId}-${record.name}.json`));
    if (change.status !== "saved" || change.record.id !== record.id || change.record.path !== record.path ||
      change.record.createdBy !== "hermes-skills" || change.record.requestId !== record.requestId ||
      change.record.sessionId !== record.sessionId || change.record.scope !== scope || change.record.version !== record.version ||
      !change.plan || change.plan.installed || !await this.approved(change.plan, "saved") ||
      change.plan.record.id !== record.id || change.plan.record.path !== record.path || change.plan.record.scope !== scope ||
      change.plan.record.requestId !== record.requestId || change.plan.record.sessionId !== record.sessionId ||
      change.plan.record.version !== record.version) return undefined;
    return { ...change.plan.record, pinned: await new SkillActivityStore(this.agentDir).pinned(record.id, record.pinned || change.plan.record.pinned) };
  }

  /** Read-only preview before any user interaction or writer lock. Save reconstructs and compares the exact diff. */
  async previewInstalled(p: SkillProposal, snapshot: Snapshot, target: InstalledTarget): Promise<InstalledPreview> {
    p = validateProposal(p, snapshot);
    if (p.action !== "update" || p.id !== target.id || p.scope !== target.scope || p.name !== target.name || target.owner !== "user-owned" ||
      target.version !== p.baseVersion || target.readOnly || target.pinned) throw new Error("Installed target identity/read-only/pin/version conflict");
    const before = await readFile(target.filePath, "utf8");
    const primaryFile = relative(target.baseDir, target.filePath).split(sep).join("/");
    if (contentHash(before) !== p.baseVersion || !snapshot.skillReads?.some(read => read.id === p.id && read.file === primaryFile && read.version === p.baseVersion)) throw new Error("Installed version conflict or target not read");
    const diff = [{ file: primaryFile, before: before as string | null, after: proposalContent(p, before, true) }];
    for (const asset of p.files ?? []) {
      if (asset.file === primaryFile) throw new Error("Duplicate primary file member");
      const path = join(target.baseDir, ...asset.file.split("/"));
      await scopedDirectory(target.baseDir, dirname(path));
      await this.verifyMember({ file: asset.file, path, before: null, content: asset.content, stage: join(dirname(path), "preview.new") }, target.baseDir, true);
      const before = await this.currentContent(path);
      if (before !== null && (asset.baseVersion !== contentHash(before) ||
        !snapshot.skillReads?.some(read => read.id === p.id && read.file === asset.file && read.version === asset.baseVersion))) throw new Error("Installed asset version conflict or not read");
      if (before === null && asset.baseVersion !== undefined) throw new Error("Installed asset version conflict: source disappeared");
      diff.push({ file: asset.file, before, after: asset.content });
    }
    return { target: structuredClone(target), proposal: p, diff };
  }

  /** Bounded preview for model content pending; no directory creation or ownership promotion. */
  async previewManaged(p: SkillProposal, snapshot: Snapshot): Promise<InstalledPreview> {
    p = validateProposal(p, snapshot);
    if (p.scope === "external") throw new Error("External content needs an allowed installed target");
    const root = this.skillRoot(p.scope), path = join(root, p.name, "SKILL.md"), baseDir = dirname(path);
    const parent = await realpath(p.scope === "project" ? this.projectRoot : this.agentDir);
    const present = await scopedDirectory(parent, baseDir);
    let existing = (await this.records(p.scope)).find(record => record.id === p.id);
    if (p.action === "create" && present) throw new Error("Managed pending target conflict: existing directory");
    if (p.action === "update") {
      if (!existing || existing.path !== path || existing.name !== p.name) throw new Error("Managed pending target identity conflict");
      existing = await this.ownership(await realpath(path), p.scope);
      if (!existing) throw new Error("Unowned pending target: creation provenance missing");
      if (existing.pinned || ((await stat(path)).mode & 0o222) === 0 || ((await stat(baseDir)).mode & 0o222) === 0) throw new Error("Managed pending target pinned or Read-only");
      await this.verifyMember({ file: "SKILL.md", path, before: null, content: p.body, stage: join(baseDir, "preview.new") }, baseDir);
    }
    const before = await this.currentContent(path);
    if (p.action === "create" && before !== null || p.action === "update" && (before === null || contentHash(before) !== p.baseVersion ||
      !snapshot.skillReads?.some(read => read.id === p.id && read.file === "SKILL.md" && read.version === p.baseVersion))) throw new Error("Managed pending version conflict or not read");
    const target: InstalledTarget = { id: existing?.id ?? `${p.scope}:${contentHash(parent).slice(0, 16)}:managed:${p.name}`,
      name: p.name, scope: p.scope, filePath: path, baseDir, version: before === null ? "absent" : contentHash(before), owner: "managed",
      source: "managed", namespace: "managed", readOnly: false, pinned: existing?.pinned ?? false,
      projectIdentity: p.scope === "project" ? parent : undefined };
    const diff = [{ file: "SKILL.md", before, after: proposalContent(p, before, false) }];
    for (const asset of p.files ?? []) {
      const assetPath = join(baseDir, ...asset.file.split("/"));
      await scopedDirectory(parent, dirname(assetPath));
      if (present) await this.verifyMember({ file: asset.file, path: assetPath, before: null, content: asset.content, stage: join(dirname(assetPath), "preview.new") }, baseDir, true);
      const before = await this.currentContent(assetPath);
      if (before !== null && (existing?.files?.[asset.file] !== asset.baseVersion || contentHash(before) !== asset.baseVersion || !snapshot.skillReads?.some(read => read.id === p.id && read.file === asset.file && read.version === asset.baseVersion))) throw new Error("Managed pending asset version conflict or not read");
      if (before === null && asset.baseVersion !== undefined) throw new Error("Managed pending asset version conflict: source disappeared");
      diff.push({ file: asset.file, before, after: asset.content });
    }
    return { target, proposal: p, diff, contentReview: true as const };
  }

  async submitModel(p: SkillProposal, snapshot: Snapshot, requestId: string, guard?: Parameters<ManagedSkillStore["save"]>[3]) {
    p = validateProposal(p, snapshot);
    const assessment = assessContent(p, snapshot);
    if (assessment.proof) return this.save(assessment.proposal, snapshot, requestId, { ...guard, contentProof: assessment.proof });
    guard?.signal?.throwIfAborted();
    await awaitWithAbort(Promise.resolve().then(() => guard?.authorize?.(p.action === "update" ? { path: join(this.skillRoot(p.scope), p.name, "SKILL.md"), version: p.baseVersion! } : undefined)), guard?.signal);
    const preview = await this.previewManaged(p, snapshot);
    const id = await new InstalledPermissions(this.agentDir).enqueue(preview, snapshot, requestId, () => !guard?.signal?.aborted && guard?.isCurrent?.() !== false);
    throw new PendingApproval(id, assessment.reason);
  }

  async history(id: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid history offset");
    const records = (await this.approvals()).filter(row => row.state === "saved" && row.plan.record.id === id).reverse();
    return { items: records.slice(offset, offset + 10).map(row => ({ key: row.key, requestId: row.plan.record.requestId, scope: row.plan.record.scope,
      kind: row.plan.before === null ? "creation" : "update", reason: row.plan.reason,
      beforeVersion: row.plan.before === null ? null : contentHash(row.plan.before), afterVersion: row.plan.record.version,
      files: this.members(row.plan).map(member => ({ file: member.file, beforeVersion: member.before === null ? null : contentHash(member.before),
        afterVersion: member.content === null ? null : contentHash(member.content) })), rollbackOf: row.plan.rollbackOf })),
      total: records.length, nextOffset: offset + 10 < records.length ? offset + 10 : null, modelCalled: false };
  }
  private async rollbackPlan(key: string, id: string): Promise<RecoveryPlan> {
    const row = (await this.approvals()).find(row => row.key === key && row.state === "saved" && row.plan.record.id === id);
    if (!row || !await this.approved(row.plan, "saved")) throw new Error("Unknown or unapproved rollback source");
    await this.checkPlan(row.plan); return row.plan;
  }
  async previewRollback(key: string, target: InstalledTarget, original: Snapshot) {
    await this.assertReady();
    const plan = await this.rollbackPlan(key, target.id);
    if (plan.record.path !== target.filePath || plan.record.scope !== target.scope || plan.record.name !== target.name || plan.record.version !== target.version ||
      !!plan.installed !== (target.owner === "user-owned") || target.pinned || target.readOnly) throw new Error("Rollback target identity/version/ownership conflict");
    for (const member of this.members(plan)) {
      await this.verifyMember(member, target.baseDir);
      if (await this.currentContent(member.path) !== member.content) throw new Error(`Rollback conflict: subsequent edit to ${member.file}`);
    }
    if (plan.before === null) {
      const owned = await this.ownership(target.filePath, target.scope as "project" | "global");
      if (!owned || JSON.stringify(Object.entries(owned.files ?? {}).sort()) !== JSON.stringify(Object.entries(plan.record.files ?? {}).sort())) throw new Error("Creation rollback member inventory conflict");
      return { kind: "creation" as const, record: plan.record };
    }
    const reason = `Explicit local rollback of ${key}`, entryId = `rollback-${contentHash(key)}`;
    const snapshot: Snapshot = { ...structuredClone(original), evidence: [...original.evidence, { entryId, text: reason }],
      skillReads: [...original.skillReads ?? [], ...this.members(plan).filter(member => member.content !== null).map(member => ({ id: target.id, file: member.file, version: contentHash(member.content!) }))] };
    const { frontmatter } = parseFrontmatter(plan.before);
    if (typeof frontmatter.description !== "string" || frontmatter.name !== target.name) throw new Error("Historical skill metadata conflict");
    const proposal: SkillProposal = { action: "update", id: target.id, scope: plan.record.scope, name: target.name,
      description: frontmatter.description.slice(0, 1024), body: "Restore exact recorded bytes.", baseVersion: target.version,
      reason, evidence: [{ entryId, quote: reason }], ...(target.scope === "global" ? { crossProject: "Explicit byte restoration in the existing global scope, not a promotion." } : {}),
      files: this.members(plan).filter(member => member.path !== plan.record.path && member.before !== null).map(member => ({ file: member.file, content: "",
        ...(member.content !== null ? { baseVersion: contentHash(member.content) } : {}) })) };
    const preview: InstalledPreview = { target: structuredClone(target), proposal,
      diff: this.members(plan).map(member => ({ file: member.file, before: member.content, after: member.before })).sort((a, b) => a.file.localeCompare(b.file)), rollbackOf: key };
    return { kind: "update" as const, preview, snapshot };
  }

  async save(p: SkillProposal, snapshot: Snapshot, requestId: string, guard?: {
    curationId?: string;
    rollbackOf?: string;
    retainedPin?: boolean;
    contentProof?: ContentProof;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    authorize?: (target?: { path: string; version: string }) => Promise<void>;
    installed?: InstalledTarget;
    approveContent?: (preview: Awaited<ReturnType<ManagedSkillStore["previewManaged"]>>) => Promise<void>;
    approveInstalled?: (preview: { target: InstalledTarget; proposal: SkillProposal; diff: { file: string; before: string | null; after: string | null }[] }) => Promise<boolean>;
  }): Promise<ManagedSkill> {
    p = validateProposal(p, snapshot);
    await new InstalledPermissions(this.agentDir).assertNoApplying(guard?.curationId);
    const reversal = guard?.rollbackOf ? await this.rollbackPlan(guard.rollbackOf, p.id!) : undefined;
    if (reversal) {
      if (reversal.before === null || p.action !== "update" || p.baseVersion !== reversal.record.version || p.scope !== reversal.record.scope || p.name !== reversal.record.name) throw new Error("Rollback source identity/version conflict");
      const expectedFiles = this.members(reversal).filter(member => member.path !== reversal.record.path && member.before !== null).map(member => ({
        file: member.file, content: "", ...(member.content !== null ? { baseVersion: contentHash(member.content) } : {}) }));
      if (JSON.stringify(p.files ?? []) !== JSON.stringify(expectedFiles) || p.description !== String(parseFrontmatter(reversal.before).frontmatter.description).slice(0, 1024)) throw new Error("Rollback member selection conflict");
    }
    if (!/^[\w-]+$/.test(requestId)) throw new Error("Invalid request identity");
    const current = () => {
      guard?.signal?.throwIfAborted();
      if (guard?.isCurrent?.() === false) throw new Error("Stale commit: review no longer has write eligibility");
    };
    const authorize = async (target?: { path: string; version: string }) => {
      current();
      // An ignored authorization abort cannot retain the writer/root lock or resume its write tail.
      await awaitWithAbort(Promise.resolve().then(() => guard?.authorize?.(target)), guard?.signal);
      current();
    };
    const installed = guard?.installed;
    if (installed && (p.action !== "update" || p.id !== installed.id || p.name !== installed.name || p.scope !== installed.scope ||
      installed.owner !== "user-owned" || installed.readOnly || installed.pinned || installed.version !== p.baseVersion)) throw new Error("Installed target identity, read-only, pin or version conflict");
    if (p.scope === "external" && !installed) throw new Error("External update requires an allowed installed target");
    const scope = p.scope;
    const root = installed?.baseDir ?? this.skillRoot(scope);
    const state = installed ? join(this.approvalDir(), "installed", contentHash(installed.id)) : this.stateDir(scope);
    current();
    await scopedDirectory(installed ? this.agentDir : scope === "project" ? this.projectRoot : this.agentDir, state, true);
    const lock = installed ? join(this.approvalDir(), "installed", "root-locks", `${contentHash(root)}.lock`) : join(state, "store.lock");
    return withLock(lock, async () => {
      current(); // Recheck after any in-process queue or filesystem lock acquisition.
      const parent = installed ? dirname(root) : scope === "project" ? this.projectRoot : this.agentDir;
      await scopedDirectory(parent, root, !installed);
      const canonicalParent = await realpath(parent);
      const canonicalRoot = await realpath(root);
      if (!canonicalRoot.startsWith(canonicalParent + sep)) throw new Error("Managed root escapes selected scope");
      const records = installed ? [] : await this.records(scope);
      let existing = p.action === "update" ? records.find(r => r.id === p.id) : records.find(r => r.name === p.name);
      const target = installed?.baseDir ?? join(root, p.name);
      const path = installed?.filePath ?? join(target, "SKILL.md");
      const primaryFile = relative(target, path).split(sep).join("/");
      let beforeContent: string | null = null;
      await authorize(p.action === "update" ? { path, version: p.baseVersion! } : undefined);
      current();
      if (p.action === "create") {
        if (existing) throw new Error("Skill conflict: name already managed");
        try { await mkdir(target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Skill conflict: existing target has no creation authorization");
          throw error;
        }
      } else {
        if (!installed) {
          if (!existing || existing.name !== p.name || existing.scope !== p.scope || existing.path !== path || existing.createdBy !== "hermes-skills") throw new Error("Target identity conflict or Unowned target: approval required");
          const owned = await this.ownership(await realpath(path), scope);
          if (!owned) throw new Error("Unowned target: creation provenance missing");
          existing = owned;
          if (existing.pinned) throw new Error("Skill pinned");
        }
        if (((await stat(path)).mode & 0o222) === 0 || ((await stat(target)).mode & 0o222) === 0) throw new Error("Read-only skill target");
        const actual = await realpath(path);
        if (!actual.startsWith(canonicalRoot + sep)) throw new Error("Target escapes managed root");
        const before = await readFile(path, "utf8"); beforeContent = before;
        if (contentHash(before) !== p.baseVersion || (installed?.version ?? existing?.version) !== p.baseVersion) throw new Error("Skill version conflict");
        if (!snapshot.skillReads?.some(read => read.id === p.id && read.file === primaryFile && read.version === p.baseVersion)) throw new Error("Target identity/version not read in snapshot");
      }
      const content = reversal?.before ?? proposalContent(p, beforeContent, !!installed);
      const record: ManagedSkill = {
        id: installed?.id ?? existing?.id ?? `${scope}:${contentHash(canonicalParent).slice(0, 16)}:managed:${relative(root, target)}`,
        name: p.name, description: reversal ? String(parseFrontmatter(content).frontmatter.description) : p.description, scope, path, version: contentHash(content),
        createdBy: "hermes-skills", requestId, sessionId: snapshot.sessionId, evidence: p.evidence,
        pinned: existing?.pinned ?? guard?.retainedPin ?? false,
        ...(installed ? { localModified: true } : {}),
        ...(reversal ? { contentProof: { kind: "restored-version" as const, restoredFrom: reversal.key, sources: [] } } : guard?.contentProof ? { contentProof: structuredClone(guard.contentProof) } : {}),
      };
      const tmp = join(target, `${requestId}.new`);
      const members: CommitMember[] = [{ file: primaryFile, path, before: beforeContent, content, stage: tmp }];
      for (const asset of p.files ?? []) {
        // Restoration bytes come only from the selected saved approval, not a new model proposal or its size limits.
        const assetContent = reversal ? this.members(reversal).find(member => member.file === asset.file)!.before! : asset.content;
        const assetPath = join(target, ...asset.file.split("/"));
        if (asset.file === primaryFile) throw new Error("Duplicate primary file member");
        await scopedDirectory(target, dirname(assetPath), !installed);
        const stage = join(dirname(assetPath), `${requestId}-${members.length}.new`);
        await this.verifyMember({ file: asset.file, path: assetPath, before: null, content: assetContent, stage }, target, !!installed);
        const before = await this.currentContent(assetPath);
        if (before !== null) {
          if (p.action === "create" || !installed && existing?.files?.[asset.file] === undefined) throw new Error("Unowned asset target: no creation record");
          if (!asset.baseVersion || contentHash(before) !== asset.baseVersion || !installed && existing?.files?.[asset.file] !== asset.baseVersion ||
            !snapshot.skillReads?.some(read => read.id === p.id && read.file === asset.file && read.version === asset.baseVersion)) throw new Error("Asset version conflict or target version not read");
          if (((await stat(assetPath)).mode & 0o222) === 0) throw new Error("Read-only asset target");
        } else if (asset.baseVersion !== undefined) throw new Error("Asset version conflict: read target disappeared");
        members.push({ file: asset.file, path: assetPath, before, content: assetContent, stage });
      }
      for (const prior of reversal ? this.members(reversal).filter(member => member.before === null) : []) {
        if (prior.content === null || prior.path === path) throw new Error("Invalid rollback removal");
        const before = await this.currentContent(prior.path);
        if (before !== prior.content || !installed && existing?.files?.[prior.file] !== contentHash(prior.content) || !snapshot.skillReads?.some(read => read.id === p.id && read.file === prior.file && read.version === contentHash(prior.content!))) throw new Error("Rollback removal ownership/version conflict or not read");
        if (((await stat(prior.path)).mode & 0o222) === 0 || ((await stat(dirname(prior.path))).mode & 0o222) === 0) throw new Error("Read-only rollback member");
        const member = { file: prior.file, path: prior.path, before, content: null, stage: join(dirname(prior.path), `${requestId}-${members.length}.new`) };
        await this.verifyMember(member, target); members.push(member);
      }
      record.files = { ...existing?.files };
      for (const member of members) {
        if (member.content === null) delete record.files[member.file];
        else record.files[member.file] = contentHash(member.content);
      }
      if (!installed && guard?.approveContent) await guard.approveContent({ target: {
        id: record.id, name: record.name, scope, filePath: path, baseDir: target, version: beforeContent === null ? "absent" : contentHash(beforeContent),
        owner: "managed", source: "managed", namespace: "managed", readOnly: false, pinned: existing?.pinned ?? false,
        projectIdentity: scope === "project" ? canonicalParent : undefined }, proposal: p,
        diff: members.map(member => ({ file: member.file, before: member.before, after: member.content })), contentReview: true });
      if (installed) {
        if (!guard?.approveInstalled || !await awaitWithAbort(guard.approveInstalled({ target: installed, proposal: p,
          diff: members.map(member => ({ file: member.file, before: member.before, after: member.content })) }), guard.signal)) throw new Error("Installed approval required or rejected");
        await authorize({ path, version: p.baseVersion! });
        for (const member of members) {
          if (await this.currentContent(member.path) !== member.before) throw new Error("Installed approved version conflict");
          await scopedDirectory(target, dirname(member.path), true);
          await this.verifyMember(member, target);
        }
      }
      if (p.action === "update") await atomicJson(join(state, "history", `${requestId}-${p.name}.json`), {
        path, before: beforeContent, version: p.baseVersion, members: members.map(member => ({ file: member.file, before: member.before,
          version: member.before === null ? null : contentHash(member.before) })),
      });
      const plan: RecoveryPlan = { version: 1, key: `${scope}:${contentHash(canonicalParent).slice(0, 16)}:${requestId}-${p.name}`, record, reason: p.reason,
        canonicalParent, canonicalRoot, before: beforeContent, content, stage: tmp, members, ...(installed ? { installed } : {}), ...(reversal ? { rollbackOf: reversal.key } : {}) };
      if (members.some(member => members.some(other => member.path === other.stage)) || new Set(members.map(member => member.stage)).size !== members.length) {
        throw new Error("File member collides with transaction staging");
      }
      // Only this agentDir-owned record authorizes recovery; project metadata alone cannot do so.
      await this.approve(plan);
      await this.writeReceipt(plan, "intent");
      current();
      for (const member of members) {
        if (member.before === member.content) continue;
        if (member.content === null) { await this.backupRemoval(plan, member); continue; }
        const file = await open(member.stage, "wx", 0o600);
        try { await file.writeFile(member.content); await file.sync(); } finally { await file.close(); }
      }
      let primaryCommitted = false;
      for (const member of members) {
        if (member.before === member.content) { current(); continue; }
        const expectedPrimary = primaryCommitted ? content : beforeContent;
        if (await this.currentContent(path) !== expectedPrimary) throw new Error("Skill version conflict during member commit");
        await authorize(p.action === "update" ? { path, version: contentHash(expectedPrimary!) } : undefined);
        if (p.action === "update") {
          if (!installed) {
            const latest = await this.ownership(await realpath(path), scope);
            if (!latest || latest.id !== p.id || latest.version !== p.baseVersion) throw new Error("Unowned target or version conflict during commit");
            if (latest.pinned) throw new Error("Skill pinned during commit");
          }
          if (((await stat(dirname(member.path))).mode & 0o222) === 0) throw new Error("Read-only member directory");
          if (((await stat(member.path).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: 0o600 }; throw error; })).mode & 0o222) === 0) throw new Error("Read-only member target");
        }
        await this.checkPlan(plan);
        if (await this.currentContent(path) !== expectedPrimary) throw new Error("Skill version conflict during member authorization");
        await this.verifyMember(member, target);
        if (member.content === null) await this.backupRemoval(plan, member);
        if (await this.currentContent(member.path) !== member.before) throw new Error(`File version conflict: ${member.file}`);
        current(); // Every member gets a last eligibility check, not a fictional multi-file atomicity claim.
        if (member.content === null) {
          if (await this.currentContent(this.removalPath(plan, member)) !== member.before) throw new Error("Rollback backup changed");
          current(); await unlink(member.path); // Prior after-version remains in the non-scanned history, never purged.
        } else await rename(member.stage, member.path);
        if (member.file === primaryFile) primaryCommitted = true;
        await this.writeReceipt(plan, "intent");
      }
      current();
      await atomicJson(join(state, "manifest.json"), [...records.filter(r => r.name !== p.name), record]);
      await this.writeReceipt(plan, "saved");
      await this.setApprovalState(plan, "saved");
      return record;
    });
  }

  private approvalDir() { return join(this.agentDir, "hermes-skills", "provenance"); }
  private async approvals(): Promise<Approval[]> {
    const dir = this.approvalDir();
    if (!await scopedDirectory(this.agentDir, dir)) return [];
    try {
      const value = await readJson<{ version: number; items: Approval[] }>(join(dir, "approved.json"));
      if (value.version !== 1 || !Array.isArray(value.items) || value.items.some(item =>
        !item.key || !item.path || !/^[a-f0-9]{64}$/.test(item.hash) || !["pending", "saved", "aborted"].includes(item.state))) {
        throw new Error("Invalid global ownership approvals");
      }
      return value.items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      let files: string[];
      try { files = await readdir(dir); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return []; throw missing; }
      if (files.some(name => name !== "approval.lock" && name !== "permissions" && name !== "installed" && name !== "activity" && name !== "archives")) throw new Error("Global ownership approvals missing; refusing to reset provenance");
      return [];
    }
  }
  private async approve(plan: RecoveryPlan): Promise<void> {
    const dir = this.approvalDir();
    await scopedDirectory(this.agentDir, dir, true);
    await withLock(join(dir, "approval.lock"), async () => {
      const rows = await this.approvals();
      if (rows.some(row => row.key === plan.key)) throw new Error("Commit identity already approved; inspect recovery instead of replaying");
      if (!rows.length) await open(join(dir, "initialized"), "a", 0o600).then(file => file.close());
      await atomicJson(join(dir, "approved.json"), { version: 1, items: [...rows,
        { key: plan.key, path: plan.record.path, hash: contentHash(JSON.stringify(plan)), state: "pending", plan }] });
    });
  }
  private async approved(plan: RecoveryPlan, state?: Approval["state"]): Promise<boolean> {
    const row = (await this.approvals()).find(item => item.key === plan.key);
    return !!row && row.path === plan.record.path && row.hash === contentHash(JSON.stringify(plan)) && (!state || row.state === state);
  }
  private async setApprovalState(plan: RecoveryPlan, state: Approval["state"]): Promise<void> {
    const dir = this.approvalDir();
    await withLock(join(dir, "approval.lock"), async () => {
      const rows = await this.approvals();
      const row = rows.find(item => item.key === plan.key);
      if (!row || row.hash !== contentHash(JSON.stringify(plan))) throw new Error("Ownership approval changed; recovery conflict");
      row.state = state;
      await atomicJson(join(dir, "approved.json"), { version: 1, items: rows });
    });
  }
  private transactionState(plan: RecoveryPlan) {
    return plan.installed ? join(this.approvalDir(), "installed", contentHash(plan.installed.id)) : this.stateDir(plan.record.scope);
  }
  private receiptPath(plan: RecoveryPlan) {
    return join(this.transactionState(plan), "changes", `${plan.record.requestId}-${plan.record.name}.json`);
  }
  private members(plan: RecoveryPlan): CommitMember[] {
    return plan.members ?? [{ file: "SKILL.md", path: plan.record.path, before: plan.before, content: plan.content, stage: plan.stage }];
  }
  private async verifyMember(member: CommitMember, targetDir: string, allowMissingParent = false): Promise<void> {
    if (!member.file || member.file.includes("\\") || member.file.startsWith("/") || /^[a-zA-Z]:/.test(member.file) ||
      member.file.split("/").some(part => !part || part === "." || part === "..") || member.path !== join(targetDir, ...member.file.split("/")) ||
      dirname(member.stage) !== dirname(member.path)) throw new Error("File member escapes or changes its selected identity");
    const canonicalRoot = await realpath(targetDir);
    const expected = join(canonicalRoot, ...member.file.split("/"));
    try { if (await realpath(dirname(member.path)) !== dirname(expected)) throw new Error("File member directory moved or escaped skill root"); }
    catch (error) { if (!allowMissingParent || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return; }
    for (const path of [member.path, member.stage]) {
      try { if (await realpath(path) !== (path === member.path ? expected : join(dirname(expected), path.split(sep).at(-1)!))) throw new Error("File member link identity conflict"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  private removalPath(plan: RecoveryPlan, member: CommitMember) {
    return join(this.transactionState(plan), "history", `${plan.record.requestId}-${plan.record.name}-removed`, ...member.file.split("/"));
  }
  private async backupRemoval(plan: RecoveryPlan, member: CommitMember): Promise<void> {
    if (!plan.rollbackOf || member.content !== null || member.before === null) throw new Error("Unapproved member removal");
    const path = this.removalPath(plan, member);
    const parent = await scopedDirectory(plan.installed ? this.agentDir : plan.canonicalParent, dirname(path), true);
    try { if (await realpath(path) !== join(parent!, basename(path))) throw new Error("Rollback backup link conflict"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const existing = await this.currentContent(path);
    if (existing !== null && existing !== member.before) throw new Error("Rollback backup version conflict");
    if (existing === null) {
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(member.before); await file.sync(); } finally { await file.close(); }
    }
  }
  private async memberStates(plan: RecoveryPlan): Promise<NonNullable<RecoveryItem["members"]>> {
    return Promise.all(this.members(plan).map(async member => {
      const actual = await this.currentContent(member.path);
      return { file: member.file, state: member.before === member.content && actual === member.before ? "unchanged" as const : actual === member.content ? "committed" as const : actual === member.before ? "prepared" as const : "conflict" as const,
        beforeVersion: member.before === null ? null : contentHash(member.before), afterVersion: member.content === null ? null : contentHash(member.content) };
    }));
  }
  private async writeReceipt(plan: RecoveryPlan, status: ChangeReceipt["status"]): Promise<void> {
    const members = await this.memberStates(plan);
    await atomicJson(this.receiptPath(plan), { status, record: plan.record, reason: plan.reason, plan, members });
    if (members.some(member => member.state === "conflict")) throw new Error(`File version conflict in ${plan.key}; actual members recorded`);
  }
  private async checkPlan(plan: RecoveryPlan): Promise<void> {
    if (!plan || plan.version !== 1 || !plan.record || !/^[\w-]+$/.test(plan.record.requestId) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan.record.name) || contentHash(plan.content) !== plan.record.version ||
      !["project", "global", "external"].includes(plan.record.scope) || !await this.approved(plan)) throw new Error("Unapproved or invalid recovery plan");
    if (this.members(plan).some(member => member.content === null) && !plan.rollbackOf) throw new Error("Only an approved historical rollback can remove a member");
    if (plan.rollbackOf) {
      const source = (await this.approvals()).find(row => row.key === plan.rollbackOf && row.state === "saved");
      if (!source || source.plan.record.id !== plan.record.id || !await this.approved(source.plan, "saved") || this.members(plan).length !== this.members(source.plan).length ||
        this.members(plan).some(member => !this.members(source.plan).some(prior => prior.file === member.file && prior.path === member.path && prior.before === member.content && prior.content === member.before))) throw new Error("Rollback does not reverse the approved historical bytes");
    }
    if (plan.installed) {
      const target = plan.installed;
      if (!plan.record.localModified || target.scope === "project" && await realpath(this.projectRoot) !== target.projectIdentity ||
        target.owner !== "user-owned" || target.id !== plan.record.id || target.scope !== plan.record.scope ||
        target.filePath !== plan.record.path || target.readOnly || target.pinned || plan.before === null || contentHash(plan.before) !== target.version ||
        await realpath(target.baseDir) !== plan.canonicalRoot || await realpath(dirname(target.baseDir)) !== plan.canonicalParent ||
        await realpath(target.filePath) !== plan.record.path || !plan.record.path.startsWith(plan.canonicalRoot + sep) ||
        plan.stage !== join(target.baseDir, `${plan.record.requestId}.new`)) throw new Error("Installed recovery source identity conflict");
      for (const member of this.members(plan)) await this.verifyMember(member, target.baseDir);
      return;
    }
    const root = this.skillRoot(plan.record.scope);
    const parent = plan.record.scope === "project" ? this.projectRoot : this.agentDir;
    if (await realpath(parent) !== plan.canonicalParent || await realpath(root) !== plan.canonicalRoot ||
      !plan.canonicalRoot.startsWith(plan.canonicalParent + sep) ||
      plan.record.path !== join(root, plan.record.name, "SKILL.md") ||
      plan.stage !== join(root, plan.record.name, `${plan.record.requestId}.new`) ||
      await realpath(dirname(plan.record.path)) !== join(plan.canonicalRoot, plan.record.name)) throw new Error("Recovery root or target identity conflict");
    for (const member of this.members(plan)) await this.verifyMember(member, dirname(plan.record.path));
  }
  private async currentContent(path: string): Promise<string | null> {
    try { return await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async inspectRecovery(): Promise<RecoveryItem[]> {
    const items: RecoveryItem[] = [];
    const rows = await this.approvals();
    for (const row of rows.filter(item => item.state === "pending")) {
      const plan = row.plan;
      const item: RecoveryItem = { key: row.key, scope: plan.record.scope, path: plan.record.path, state: "unsupported",
        beforeVersion: plan.before === null ? null : contentHash(plan.before), afterVersion: plan.record.version };
      try {
        await this.checkPlan(plan);
        item.members = await this.memberStates(plan);
        item.state = item.members.some(member => member.state === "conflict") ? "conflict" : item.members.some(member => member.state === "committed") ? "content-committed" : "prepared";
        if (item.state === "conflict") item.diagnostic = "Current member differs from both approved versions; preserve manual changes";
      } catch (error) { item.diagnostic = String(error).slice(0, 500); }
      items.push(item);
    }
    // Unknown/legacy project receipts can stop spending, but cannot grant recovery/write authority.
    for (const scope of ["project", "global"] as const) {
      if (!await scopedDirectory(scope === "project" ? this.projectRoot : this.agentDir, this.stateDir(scope))) continue;
      let files: string[];
      try { files = await readdir(join(this.stateDir(scope), "changes")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const file of files.filter(file => file.endsWith(".json"))) {
        const change = await readJson<ChangeReceipt>(join(this.stateDir(scope), "changes", file));
        if (change.status !== "intent" || items.some(item => item.key === change.plan?.key)) continue;
        items.push({ key: change.plan?.key ?? `${scope}:${file}`, scope, path: change.record?.path ?? "unknown", state: "unsupported",
          beforeVersion: null, afterVersion: change.record?.version ?? "unknown", diagnostic: "Intent lacks a matching agentDir approval; inspect locally, do not replay" });
      }
    }
    return items;
  }
  async assertReady(curationId?: string): Promise<void> {
    await new InstalledPermissions(this.agentDir).assertNoApplying(curationId);
    await new SkillActivityStore(this.agentDir).assertReady();
    await new SkillArchives(this.agentDir, this.projectRoot).assertReady();
    const pending = await this.inspectRecovery();
    if (pending.length) throw new Error(`store-recovery-required: ${pending.map(item => item.key).join(", ")}`);
    // Missing/corrupt manifests are also local prerequisites, never a reason to spend a request first.
    await this.records("project");
    await this.records("global");
  }
  private async recoveryRecords(plan: RecoveryPlan): Promise<ManagedSkill[]> {
    if (plan.installed) return [];
    try { return await this.records(plan.record.scope); }
    catch (error) {
      if (!/Ownership manifest missing/.test(String(error)) || plan.before !== null) throw error;
      const dir = join(this.stateDir(plan.record.scope), "changes");
      const changes = await Promise.all((await readdir(dir)).filter(file => file.endsWith(".json")).map(file => readJson<ChangeReceipt>(join(dir, file))));
      if (changes.some(change => change.status === "saved")) throw new Error("Existing ownership history has no manifest; do not reconstruct it from one pending creation");
      return [];
    }
  }
  async previewRecovery(key: string): Promise<InstalledPreview | undefined> {
    const row = (await this.approvals()).find(item => item.key === key && item.state === "pending");
    if (!row) throw new Error("No approved pending recovery plan");
    const plan = row.plan; await this.checkPlan(plan);
    if ((await this.memberStates(plan)).some(member => member.state === "conflict")) throw new Error("Recovery version conflict");
    if (!plan.installed) return undefined;
    const primary = await this.currentContent(plan.record.path);
    return { target: { ...plan.installed, version: contentHash(primary!) }, proposal: {
      action: "update", id: plan.record.id, scope: plan.record.scope, name: plan.record.name, description: plan.record.description,
      body: "Resume the approved remaining members without replaying the model.", reason: `Resume ${plan.key}`, baseVersion: contentHash(primary!), evidence: plan.record.evidence,
    }, diff: await Promise.all(this.members(plan).map(async member => ({ file: member.file, before: await this.currentContent(member.path), after: member.content }))),
      ...(plan.rollbackOf ? { rollbackOf: plan.rollbackOf } : {}) };
  }
  /** Explicit local action only. No model calls or unknown-usage reservation changes. */
  async recover(key: string, action: "commit" | "abort", guard?: {
    authorize?: (target?: { path: string; version: string; installedId?: string }) => Promise<void>;
    approveInstalled?: (preview: InstalledPreview) => Promise<boolean>; signal?: AbortSignal; isCurrent?: () => boolean;
  }): Promise<RecoveryItem> {
    if (!["commit", "abort"].includes(action)) throw new Error("Use recovery commit or abort");
    const row = (await this.approvals()).find(item => item.key === key && item.state === "pending");
    if (!row) throw new Error("No approved pending recovery plan");
    const plan = row.plan;
    await this.checkPlan(plan);
    const lock = plan.installed ? join(this.approvalDir(), "installed", "root-locks", `${contentHash(plan.canonicalRoot)}.lock`) : join(this.transactionState(plan), "store.lock");
    return withLock(lock, async () => {
      await this.checkPlan(plan);
      const members = this.members(plan);
      const states = await this.memberStates(plan);
      if (states.some(member => member.state === "conflict")) throw new Error("Recovery version conflict: manual member content is preserved");
      const records = await this.recoveryRecords(plan);
      if (action === "abort" && states.some(member => member.state === "committed")) throw new Error("Content already committed; finish remaining members or explicitly roll back, not a false abort");
      const current = () => { guard?.signal?.throwIfAborted(); if (guard?.isCurrent?.() === false) throw new Error("Stale recovery eligibility"); };
      const permission = new InstalledPermissions(this.agentDir);
      const grantRequired = action === "commit" && !!plan.installed && !guard?.approveInstalled;
      if (action === "commit" && plan.installed && guard?.approveInstalled &&
        !await awaitWithAbort(guard.approveInstalled((await this.previewRecovery(key))!), guard.signal)) throw new Error("Installed recovery approval rejected");
      const authorize = async () => {
        current();
        if (grantRequired && !await permission.allowed()) throw new Error("Installed recovery requires current approval; global grant revoked or absent");
        const primary = await this.currentContent(plan.record.path);
        await awaitWithAbort(Promise.resolve().then(() => guard?.authorize?.(plan.before === null ? undefined : {
          path: plan.record.path, version: contentHash(primary!), installedId: plan.installed?.id })), guard?.signal);
        if (grantRequired && !await permission.allowed()) throw new Error("Installed recovery global grant revoked during source authorization");
        if (await new SkillActivityStore(this.agentDir).pinned(plan.record.id, plan.record.pinned)) throw new Error("Recovery target pinned");
        current();
      };
      await authorize();
      const afterAuthorization = await this.memberStates(plan);
      if (JSON.stringify(afterAuthorization) !== JSON.stringify(states)) throw new Error("Recovery version conflict after authorization");
      if (action === "commit") {
        for (const member of members) {
          if (plan.installed && (((await stat(dirname(member.path))).mode & 0o222) === 0 || ((await stat(member.path).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: 0o600 }; throw error;
          })).mode & 0o222) === 0)) throw new Error("Read-only installed recovery member");
          const actual = await this.currentContent(member.path);
          if (actual === member.content) continue;
          if (actual !== member.before) throw new Error(`Recovery version conflict: ${member.file}`);
          await authorize();
          if (member.content === null) await this.backupRemoval(plan, member);
          else {
            const staged = await this.currentContent(member.stage);
            if (staged !== null && staged !== member.content) throw new Error("Recovery stage version conflict");
            if (staged === null) {
              const file = await open(member.stage, "wx", 0o600);
              try { await file.writeFile(member.content); await file.sync(); } finally { await file.close(); }
            }
          }
          await this.checkPlan(plan);
          await authorize();
          if (member.content === null) await this.backupRemoval(plan, member);
          if (await this.currentContent(member.path) !== actual) throw new Error("Recovery version conflict before replacement");
          current();
          if (member.content === null) await unlink(member.path); else await rename(member.stage, member.path);
          await this.writeReceipt(plan, "intent");
        }
      }
      if (action === "abort") {
        // Preserve owned preparation outside native discovery; do not move unrelated user files.
        const targetDir = dirname(plan.record.path);
        const archiveRoot = join(this.transactionState(plan), "aborted");
        const metadataParent = plan.installed ? this.agentDir : plan.canonicalParent;
        await scopedDirectory(metadataParent, archiveRoot, true);
        if (plan.before === null) {
          const allowedFiles = new Set(members.map(member => member.stage));
          const allowedDirs = new Set<string>();
          for (const member of members) {
            let dir = dirname(member.stage);
            while (dir !== targetDir) { allowedDirs.add(dir); dir = dirname(dir); }
          }
          const pending = [targetDir];
          while (pending.length) {
            const dir = pending.pop()!;
            for (const file of await readdir(dir, { withFileTypes: true })) {
              const path = join(dir, file.name);
              if (file.isDirectory() && allowedDirs.has(path)) pending.push(path);
              else if (!file.isFile() || !allowedFiles.has(path)) throw new Error("Recovery conflict: unexpected files in prepared target");
            }
          }
          const archive = join(archiveRoot, `${plan.record.requestId}-${plan.record.name}`);
          try { await realpath(archive); throw new Error("Recovery archive already exists"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          await rename(targetDir, archive);
        } else {
          for (const member of members) {
            if (await this.currentContent(member.stage) === null) continue;
            const archive = join(archiveRoot, `${plan.record.requestId}-${plan.record.name}`, ...member.file.split("/"));
            await scopedDirectory(metadataParent, dirname(archive), true);
            if (await this.currentContent(archive) !== null) throw new Error("Recovery archive already exists");
            await rename(member.stage, archive);
          }
        }
      }
      await atomicJson(join(this.transactionState(plan), "manifest.json"), action === "commit" ?
        [...records.filter(record => record.id !== plan.record.id), plan.record] : records);
      await this.writeReceipt(plan, action === "commit" ? "saved" : "aborted");
      await this.setApprovalState(plan, action === "commit" ? "saved" : "aborted");
      return { key, scope: plan.record.scope, path: plan.record.path, state: action === "commit" ? "saved" : "aborted", members: await this.memberStates(plan),
        beforeVersion: plan.before === null ? null : contentHash(plan.before), afterVersion: plan.record.version, diagnostic: `${action}: local recovery completed; no model request` };
    });
  }

  async localModified(id: string, path: string): Promise<boolean> {
    return (await this.approvals()).some(row => row.state === "saved" && row.plan.installed?.id === id && row.path === path);
  }

  async search(query: string): Promise<ManagedSkill[]> {
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const valid: ManagedSkill[] = [];
    for (const record of await this.catalog()) {
      const loaded = loadSkillsFromDir({ dir: dirname(record.path), source: record.scope === "project" ? "project" : "user" });
      if (!loaded.skills.length) throw new Error(`Skill unavailable or invalid: ${record.id}`);
      const actual = await realpath(record.path);
      const root = await realpath(this.skillRoot(record.scope));
      if (!actual.startsWith(root + sep)) throw new Error("Skill escaped managed root");
      const content = await readFile(record.path, "utf8");
      const current = loaded.skills[0]!;
      const fresh = { ...record, name: current.name, description: current.description, version: contentHash(content) };
      if (!current.disableModelInvocation && words.every(w => `${fresh.name} ${fresh.description}`.toLocaleLowerCase().includes(w))) valid.push(fresh);
    }
    return valid.slice(0, 10);
  }

  async view(id: string): Promise<{ record: ManagedSkill; content: string }> {
    const record = (await this.catalog()).find(r => r.id === id);
    if (!record) throw new Error("Unknown SkillId");
    const actual = await realpath(record.path);
    const root = await realpath(this.skillRoot(record.scope));
    if (!actual.startsWith(root + sep)) throw new Error("Skill escaped managed root");
    const content = await readFile(record.path, "utf8");
    if (content.length > 16000) throw new Error("Skill needs paged reading; first-slice reader refuses truncation");
    return { record: { ...record, version: contentHash(content) }, content };
  }
}
