import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, realpath, rename, stat, link, unlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { awaitWithAbort } from "./async.ts";
import { atomicJson, readJson, scopedDirectory, withLock } from "./files.ts";
import { contentHash, ManagedSkillStore } from "./store.ts";
import type { ManagedSkill } from "./store.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { LifecyclePreview } from "./permissions.ts";
import { SkillActivityStore } from "./activity.ts";

interface ArchiveMember { file: string; version: string; data: string; mode: number; transfer: "move" | "copy" }
export interface ArchivePlan {
  version: 1; id: string; target: CatalogEntry; skill: Skill; managed?: ManagedSkill;
  projectRoot: string; reason: string; members: ArchiveMember[];
  impact?: { matches: { id: string; file: string; version: string }[]; scannedFiles: number; truncated: boolean; diagnostics: string[]; externalReferences: string; scope: string };
}
interface ArchiveRecord { plan: ArchivePlan; hash: string; state: "archiving" | "archived" | "restoring" | "restored"; error?: string;
  approvals?: Partial<Record<"archive" | "restore", { origin: "user-diff" | "global-grant"; hash: string }>>;
}
type Guard = { curationId?: string; isCurrent: () => boolean; authorize: () => Promise<void>; signal?: AbortSignal;
  approveInstalled?: (preview: LifecyclePreview) => Promise<"user-diff" | "global-grant"> };
const displayBytes = (member: ArchiveMember) => {
  const bytes = Buffer.from(member.data, "base64"), text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text : `[binary base64, ${bytes.length} bytes]\n${member.data}`;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const currentBytes = async (path: string): Promise<Buffer | undefined> => readFile(path).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });

/** AgentDir-owned receipts bind exact members. No timer, provider, recursive move or purge. */
export class SkillArchives {
  readonly agentDir: string; readonly projectRoot: string;
  constructor(agentDir: string, projectRoot: string) { this.agentDir = agentDir; this.projectRoot = projectRoot; }
  private root() { return join(this.agentDir, "hermes-skills/provenance/archives"); }
  private directory(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid archive ID");
    return join(this.root(), id);
  }
  private receipt(id: string) { return join(this.directory(id), "receipt.json"); }
  private async records(): Promise<ArchiveRecord[]> {
    if (!await scopedDirectory(this.agentDir, this.root())) return [];
    const result: ArchiveRecord[] = [];
    for (const entry of await readdir(this.root(), { withFileTypes: true })) {
      if (!entry.isDirectory()) throw new Error("Unexpected archive metadata entry");
      await scopedDirectory(this.agentDir, this.directory(entry.name));
      const record = await readJson<ArchiveRecord>(this.receipt(entry.name));
      if (record.plan?.version !== 1 || record.plan.id !== entry.name || record.hash !== contentHash(JSON.stringify(record.plan)) ||
        !["archiving", "archived", "restoring", "restored"].includes(record.state)) throw new Error("Invalid archive receipt; no implicit reset");
      result.push(record);
    }
    return result;
  }
  async list() {
    return (await this.records()).filter(row => row.plan.target.scope !== "project" || row.plan.projectRoot === this.projectRoot).map(row => ({
      id: row.plan.id, skillId: row.plan.target.id, scope: row.plan.target.scope, state: row.state, reason: row.plan.reason,
      version: row.plan.target.version, members: row.plan.members.map(member => ({ file: member.file, transfer: member.transfer, version: member.version })),
      error: row.error, recovery: `archive-resume ${row.plan.id} | restore ${row.plan.id}`,
    }));
  }
  async hiddenIds() { return (await this.records()).filter(row => row.state !== "restored").map(row => row.plan.target.id); }
  async assertReady() {
    const pending = (await this.list()).filter(row => row.state === "archiving" || row.state === "restoring");
    if (pending.length) throw new Error(`store-recovery-required: archive operations ${pending.map(row => row.id).join(", ")}`);
  }
  async get(id: string) {
    const row = (await this.records()).find(row => row.plan.id === id);
    if (!row) throw new Error("Unknown archive ID");
    if (row.plan.target.scope === "project" && row.plan.projectRoot !== this.projectRoot) throw new Error("Archive project identity conflict");
    return row;
  }
  private async memberPath(plan: ArchivePlan, member: ArchiveMember, verifyData = true) {
    if (!member.file || member.file.includes("\\") || member.file.startsWith("/") || /^[a-zA-Z]:/.test(member.file) ||
      member.file.split("/").some(part => !part || part === "." || part === "..") || verifyData && hash(Buffer.from(member.data, "base64")) !== member.version) throw new Error("Invalid archive member identity");
    if (await realpath(plan.target.baseDir) !== plan.target.baseDir) throw new Error("Archive source root changed");
    const path = join(plan.target.baseDir, ...member.file.split("/"));
    if (await realpath(dirname(path)) !== dirname(path)) throw new Error("Archive member parent changed");
    try { if (await realpath(path) !== path) throw new Error("Archive member link changed"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return path;
  }
  private async protected(plan: ArchivePlan) {
    if (await new SkillActivityStore(this.agentDir).pinned(plan.target.id, plan.target.pinned)) throw new Error("Archive target pinned");
    if (plan.target.readOnly || (plan.target.owner === "managed" ? !plan.managed || plan.managed.id !== plan.target.id || plan.managed.path !== plan.target.filePath ||
      plan.managed.version !== plan.target.version : plan.managed !== undefined)) throw new Error("Unowned/read-only archive target");
    if (plan.target.scope === "project" && await realpath(this.projectRoot) !== plan.projectRoot) throw new Error("Archive scope identity conflict");
    if (((await stat(plan.target.baseDir)).mode & 0o222) === 0) throw new Error("Read-only archive root");
  }
  private async check(guard: Guard) {
    guard.signal?.throwIfAborted(); if (!guard.isCurrent()) throw new Error("Stale archive eligibility");
    await awaitWithAbort(guard.authorize(), guard.signal);
    guard.signal?.throwIfAborted(); if (!guard.isCurrent()) throw new Error("Stale archive eligibility");
  }
  private lock(plan: ArchivePlan) {
    return plan.target.owner === "user-owned" ? join(this.agentDir, "hermes-skills/provenance/installed/root-locks", `${contentHash(plan.target.baseDir)}.lock`) :
      join(plan.target.scope === "project" ? join(this.projectRoot, ".pi/hermes-skills") : join(this.agentDir, "hermes-skills"), "store.lock");
  }
  async permissionPreview(plan: ArchivePlan, action: "archive" | "restore"): Promise<LifecyclePreview> {
    const diff = [];
    for (const member of plan.members) {
      const bytes = await currentBytes(await this.memberPath(plan, member));
      const before = bytes ? displayBytes({ ...member, data: bytes.toString("base64") }) : null;
      diff.push({ file: member.file, before, after: action === "restore" ? displayBytes(member) : member.transfer === "copy" ? displayBytes(member) : `<move to archive ${plan.id}; bytes preserved at ${member.version}>` });
    }
    return { target: structuredClone(plan.target), lifecycle: { action, plan: structuredClone(plan) }, diff };
  }
  private async approve(plan: ArchivePlan, action: "archive" | "restore", guard: Guard) {
    if (plan.target.owner !== "user-owned") return undefined;
    if (!guard.approveInstalled) throw new Error("Installed lifecycle approval required");
    const preview = await this.permissionPreview(plan, action);
    const origin = await awaitWithAbort(guard.approveInstalled(preview), guard.signal);
    if (!["user-diff", "global-grant"].includes(origin)) throw new Error("Explicit lifecycle authorization required");
    return { origin, hash: contentHash(JSON.stringify(preview)) };
  }
  async preview(target: CatalogEntry, skill: Skill, reason: string, impact?: ArchivePlan["impact"], selectedFiles?: string[], curationId?: string): Promise<ArchivePlan> {
    if (!reason.trim() || reason.length > 1024) throw new Error("Archive requires a bounded reason");
    if (selectedFiles && (target.owner === "managed" || !Array.isArray(selectedFiles) || selectedFiles.length > 16 || selectedFiles.some(file => typeof file !== "string"))) throw new Error("Only installed archives accept an explicit bounded asset list");
    const store = new ManagedSkillStore(this.agentDir, this.projectRoot); await store.assertReady(curationId);
    const managed = target.owner === "managed" ? await store.ownership(target.filePath, target.scope as "project" | "global") : undefined;
    if (target.owner === "managed" && (!managed || managed.version !== target.version)) throw new Error("Archive provenance/version conflict");
    const plan: ArchivePlan = { version: 1, id: randomUUID(), target: structuredClone(target), skill: structuredClone(skill), managed,
      projectRoot: await realpath(this.projectRoot), reason, members: [], ...(impact ? { impact } : {}) };
    await this.protected(plan);
    const primary = relative(target.baseDir, target.filePath).split(sep).join("/");
    const members: [string, string][] = managed ? Object.entries(managed.files ?? { [primary]: managed.version }) : [...new Set([primary, ...selectedFiles ?? []])].map(file => [file, ""]);
    if (members.length > 17) throw new Error("Archive member capacity exceeded");
    for (const [file, version] of members) {
      const member: ArchiveMember = { file, version, data: "", mode: 0, transfer: managed || file === primary ? "move" : "copy" };
      if (!file || file.split(/[\\/]/).some(part => part === ".." || part === "." || !part) || file.startsWith("/") || file.includes("\\") || /^[a-zA-Z]:/.test(file)) throw new Error("Invalid archive member path");
      const path = await this.memberPath(plan, member, false), bytes = await readFile(path);
      member.data = bytes.toString("base64"); member.mode = (await stat(path)).mode & 0o777;
      if (!managed) member.version = hash(bytes);
      if (file === primary && hash(bytes) !== target.version) throw new Error("Installed archive primary version conflict");
      await this.memberPath(plan, member);
      if (member.transfer === "move" && !(member.mode & 0o222) || managed && hash(bytes) !== version) throw new Error("Archive read-only/member version conflict");
      plan.members.push(member);
    }
    if (!plan.members.some(member => join(target.baseDir, member.file) === target.filePath) || skill.filePath !== target.filePath || skill.baseDir !== target.baseDir) throw new Error("Archive primary/source identity conflict");
    if (JSON.stringify(plan).length > 384000) throw new Error("Archive preview capacity exceeded");
    // Primary last keeps source authorization available until all selected assets are secured.
    plan.members.sort((a, b) => Number(join(target.baseDir, a.file) === target.filePath) - Number(join(target.baseDir, b.file) === target.filePath) || a.file.localeCompare(b.file));
    return plan;
  }
  async archive(plan: ArchivePlan, guard: Guard) {
    await this.check(guard); await this.protected(plan);
    await new ManagedSkillStore(this.agentDir, this.projectRoot).assertReady(guard.curationId);
    return withLock(this.lock(plan), async () => {
      await this.check(guard); await this.protected(plan);
      const fresh = await this.preview(plan.target, plan.skill, plan.reason, plan.impact, plan.target.owner === "user-owned" ? plan.members.filter(member => member.transfer === "copy").map(member => member.file) : undefined, guard.curationId); fresh.id = plan.id;
      if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error("Archive preview/provenance changed");
      for (const member of plan.members) if (hash(await readFile(await this.memberPath(plan, member))) !== member.version) throw new Error("Archive member version conflict after preview");
      const approval = await this.approve(plan, "archive", guard);
      await this.check(guard);
      await scopedDirectory(this.agentDir, this.root(), true); await mkdir(this.directory(plan.id));
      const record: ArchiveRecord = { plan, hash: contentHash(JSON.stringify(plan)), state: "archiving", ...(approval ? { approvals: { archive: approval } } : {}) };
      await atomicJson(this.receipt(plan.id), record);
      return this.moveMembers(record, guard);
    });
  }
  private async moveMembers(record: ArchiveRecord, guard: Guard) {
    const plan = record.plan;
    try {
      await this.protected(plan);
      for (const member of plan.members) {
        const path = await this.memberPath(plan, member), destination = join(this.directory(plan.id), "members", ...member.file.split("/"));
        await scopedDirectory(this.agentDir, dirname(destination), true);
        const bytes = await currentBytes(path), backup = await currentBytes(destination);
        if (backup && hash(backup) !== member.version) throw new Error("Archive backup conflict");
        if (!bytes) {
          if (member.transfer === "move" && backup) continue;
          throw new Error("Archive source unexpectedly missing");
        }
        if (hash(bytes) !== member.version || member.transfer === "move" && ((await stat(path)).mode & 0o222) === 0) throw new Error("Archive member changed/read-only");
        if (backup && member.transfer === "copy") continue; // Already retained; no new source mutation or authorization implied.
        await this.check(guard); await this.protected(plan);
        if (hash(await readFile(await this.memberPath(plan, member))) !== member.version) throw new Error("Archive version conflict before move");
        if (!backup) {
          const file = await open(destination, "wx", 0o600);
          try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        }
        if (member.transfer === "move") {
          if (hash(await readFile(await this.memberPath(plan, member))) !== member.version || hash(await readFile(destination)) !== member.version) throw new Error("Archive version conflict after backup");
          if (!guard.isCurrent()) throw new Error("Stale archive eligibility before move");
          try { await rename(path, destination); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
            await this.check(guard);
            if (hash(await readFile(path)) !== member.version || hash(await readFile(destination)) !== member.version) throw new Error("Archive cross-device version conflict");
            if (!guard.isCurrent()) throw new Error("Stale cross-device archive eligibility");
            await unlink(path); // Exact bytes retained in the verified archive, not physical purge.
          }
        }
      }
      record.state = "archived"; delete record.error;
      await atomicJson(this.receipt(plan.id), record);
      return { status: "changed", archiveId: plan.id, skillId: plan.target.id, scope: plan.target.scope, impact: plan.impact, restore: `restore ${plan.id}`, modelCalled: false };
    } catch (error) { record.error = String(error).slice(0, 1000); await atomicJson(this.receipt(plan.id), record); throw error; }
  }
  async resume(id: string, guard: Guard) {
    const record = await this.get(id);
    if (record.state !== "archiving") throw new Error("Only an interrupted archive can be resumed");
    return withLock(this.lock(record.plan), async () => {
      const approval = await this.approve(record.plan, "archive", guard);
      if (approval) record.approvals = { ...record.approvals, archive: approval };
      return this.moveMembers(record, guard);
    });
  }
  async restore(id: string, guard: Guard) {
    const selected = await this.get(id), plan = selected.plan;
    return withLock(this.lock(plan), async () => {
      const record = await this.get(id);
      try {
        if (record.state === "restored") return { status: "no-change", archiveId: id, modelCalled: false };
        if (record.state !== "archived" && record.state !== "restoring") throw new Error("Finish the interrupted archive before restoration");
        await this.check(guard); await this.protected(plan);
        for (const member of plan.members) {
          const path = await this.memberPath(plan, member), bytes = await currentBytes(path);
          const backup = await readFile(join(this.directory(id), "members", ...member.file.split("/")));
          if (hash(backup) !== member.version) throw new Error("Restore archive version conflict");
          if (bytes && (member.transfer === "move" && record.state !== "restoring" || hash(bytes) !== member.version)) throw new Error("Restore target conflict; existing user files retained");
        }
        const approval = await this.approve(plan, "restore", guard);
        if (approval) record.approvals = { ...record.approvals, restore: approval };
        record.state = "restoring"; delete record.error; await atomicJson(this.receipt(id), record);
        for (const member of plan.members) {
          const path = await this.memberPath(plan, member), bytes = await currentBytes(path);
          if (bytes) { if (hash(bytes) !== member.version) throw new Error("Restore version conflict"); continue; }
          await this.check(guard); await this.protected(plan);
          const stage = join(dirname(path), `${id}-${contentHash(member.file).slice(0, 16)}.restore-new`);
          const prepared = await currentBytes(stage);
          if (prepared && hash(prepared) !== member.version) throw new Error("Restore preparation conflict");
          if (!prepared) {
            const file = await open(stage, "wx", member.mode);
            try { await file.writeFile(Buffer.from(member.data, "base64")); await file.sync(); } finally { await file.close(); }
          }
          await this.check(guard); await this.memberPath(plan, member);
          if (!guard.isCurrent()) throw new Error("Stale restore eligibility before publication");
          await link(stage, path); // Exclusive publication: never overwrite a concurrent human file.
          await unlink(stage);
        }
        record.state = "restored"; await atomicJson(this.receipt(id), record);
        return { status: "changed", archiveId: id, skillId: plan.target.id, scope: plan.target.scope, modelCalled: false };
      } catch (error) { record.error = String(error).slice(0, 1000); await atomicJson(this.receipt(id), record); throw error; }
    });
  }
}
