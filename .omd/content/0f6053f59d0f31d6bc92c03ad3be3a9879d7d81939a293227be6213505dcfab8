import { readFile, realpath, stat, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Skill } from "@earendil-works/pi-coding-agent";
import type { SkillRead } from "./context.ts";
import { SkillActivityStore } from "./activity.ts";
import { contentHash, normalizedBody, ManagedSkillStore } from "./store.ts";

export interface CatalogEntry {
  id: string; name: string; description: string; scope: string; source: string;
  filePath: string; baseDir: string; explicitOnly: boolean;
  owner: "managed" | "user-owned"; namespace: string; version: string; readOnly: boolean;
  projectIdentity?: string; pinned: boolean; localModified?: boolean;
}

export interface SearchFilters {
  scope?: "project" | "global" | "external";
  sourceKind?: "managed" | "user-installed" | "package" | "external";
}
export type SearchItem = Pick<CatalogEntry, "id" | "name" | "description" | "scope" | "source" | "filePath">;
export const SEARCH_MAX_ITEMS = 10;
export const SEARCH_MAX_CHARS = 6000;
export const READ_MAX_CHARS = 16000;

type IndexEntry = CatalogEntry & { knownFiles: string[]; sourceSkill: Skill; hostExplicitOnly: boolean; originalFilePath: string; originalBaseDir: string };

/** Only host-enabled sources. This reader never discovers arbitrary filesystem roots. */
export class EnabledCatalog {
  private entries: IndexEntry[] = [];
  private diagnostics: string[] = [];
  private generation = 0;
  private agentDir?: string;
  constructor(agentDir?: string) { this.agentDir = agentDir; }

  async capture(skills: Skill[], trusted: boolean, sourceDiagnostics: string[] = [], projectRoot?: string): Promise<boolean> {
    const generation = ++this.generation;
    const entries: IndexEntry[] = [];
    const diagnostics: string[] = [...sourceDiagnostics];
    const seen = new Set<string>();
    for (const skill of skills) {
      if (skill.sourceInfo.scope === "project" && !trusted) {
        diagnostics.push(`Untrusted project source: ${skill.name}`);
        continue;
      }
      try {
        const path = await realpath(skill.filePath);
        const base = await realpath(skill.baseDir);
        if (!path.startsWith(base + sep)) throw new Error("Skill file escapes source root");
        if (seen.has(path)) continue;
        seen.add(path);
        const scope = skill.sourceInfo.scope === "user" ? "global" : skill.sourceInfo.scope === "project" ? "project" : "external";
        const projectIdentity = scope === "project" && projectRoot ? await realpath(projectRoot) : undefined;
        let managed;
        let managedId: string | undefined;
        if (this.agentDir && projectRoot && scope !== "external") {
          const store = new ManagedSkillStore(this.agentDir, projectRoot);
          try { managedId = await store.identity(path, scope); managed = await store.ownership(path, scope); }
          catch (error) { diagnostics.push(`Ownership unavailable (${skill.name}): ${String(error)}`); }
        }
        let readOnly = ((await stat(path)).mode & 0o222) === 0 || ((await stat(base)).mode & 0o222) === 0;
        try { await access(path, constants.W_OK); await access(base, constants.W_OK); }
        catch { readOnly = true; }
        const namespace = managedId ? "managed" :
          skill.sourceInfo.origin === "package" ? "package" : scope === "external" ? "external" : "user-installed";
        const sourceKey = contentHash(`${skill.sourceInfo.source}\n${base}`).slice(0, 16);
        const entry: IndexEntry = {
          knownFiles: Object.keys(managed?.files ?? {}),
          sourceSkill: structuredClone({ ...skill, filePath: path, baseDir: base }),
          id: managedId ?? `${scope}:${projectIdentity ? contentHash(projectIdentity).slice(0, 16) + ":" : ""}${namespace}:${sourceKey}:${encodeURIComponent(relative(base, path))}`,
          name: skill.name, description: skill.description, scope,
          source: skill.sourceInfo.source, filePath: path, baseDir: base,
          explicitOnly: skill.disableModelInvocation, hostExplicitOnly: skill.disableModelInvocation,
          originalFilePath: skill.filePath, originalBaseDir: skill.baseDir,
          owner: managed ? "managed" : "user-owned",
          namespace, projectIdentity, version: "", readOnly, pinned: managed?.pinned ?? false,
        };
        if (this.agentDir && projectRoot) entry.localModified = await new ManagedSkillStore(this.agentDir, projectRoot).localModified(entry.id, path);
        entries.push(await this.read(entry));
      } catch (error) { diagnostics.push(`${skill.name}: ${String(error)}`); }
    }
    if (generation !== this.generation) return false;
    this.entries = entries;
    this.diagnostics = diagnostics;
    return true;
  }

  async inspect(id: string): Promise<CatalogEntry> {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) throw new Error("Unknown or host-excluded SkillId");
    const { knownFiles: _knownFiles, sourceSkill: _sourceSkill, hostExplicitOnly: _host, originalFilePath: _original, originalBaseDir: _originalBase, ...metadata } = await this.read(entry);
    return metadata;
  }

  async source(id: string): Promise<Skill> {
    const current = await this.inspect(id);
    return structuredClone({ ...this.entries.find(entry => entry.id === id)!.sourceSkill, name: current.name, description: current.description });
  }

  /** Literal mentions in enabled primaries/proven members/current read references; never a claim about all external users. */
  async referencesTo(id: string, reads: SkillRead[] = []) {
    const target = await this.inspect(id);
    const matches: { id: string; file: string; version: string }[] = [], diagnostics: string[] = [];
    let scannedFiles = 0, truncated = false;
    for (const entry of this.entries) {
      if (entry.id === id) continue;
      for (const file of new Set([relative(entry.baseDir, entry.filePath).split(sep).join("/"), ...entry.knownFiles, ...reads.filter(read => read.id === entry.id).map(read => read.file)])) {
        try {
          const needles = [id, target.filePath, relative(dirname(resolve(entry.baseDir, file)), target.filePath).split(sep).join("/")];
          let offset = 0, overlap = "", version: string | undefined, found = false;
          while (true) {
            const page = await this.view(entry.id, file, offset);
            if (version && version !== page.version) throw new Error("Reference changed during impact inspection");
            version = page.version;
            const text = overlap + page.content; found ||= needles.some(needle => text.includes(needle));
            overlap = text.slice(-Math.max(...needles.map(needle => needle.length)));
            if (page.nextOffset === null) break;
            offset = page.nextOffset;
          }
          scannedFiles++;
          if (found) {
            const match = { id: entry.id, file, version: version! };
            if (matches.length < 10 && JSON.stringify([...matches, match]).length <= 4000) matches.push(match); else truncated = true;
          }
        } catch (error) { if (diagnostics.length < 3) diagnostics.push(String(error).slice(0, 180)); }
      }
    }
    return { matches, scannedFiles, truncated, diagnostics, externalReferences: "unchecked", scope: "literal mentions in enabled primary, proven managed and current-read files; no automatic rewrite" };
  }

  /** Explicit local inspection only; matching body is a candidate, not permission to absorb assets. */
  async curation(offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid curation offset");
    const groups = new Map<string, string[]>();
    const eligible: { id: string; scope: string; version: string; bodyKey: string; reasons: string[]; lastUse: number | null }[] = [];
    const diagnostics = [...this.diagnostics];
    for (const entry of this.entries) {
      try {
        const current = await this.inspect(entry.id);
        if (current.explicitOnly || current.owner !== "managed" || current.pinned || current.readOnly) continue;
        const text = await readFile(current.filePath, "utf8");
        if (contentHash(text) !== current.version) throw new Error("Curation version changed while reading");
        const bodyKey = contentHash(`${current.scope}\n${current.projectIdentity ?? ""}\n${normalizedBody(stripFrontmatter(text))}`);
        const activity = this.agentDir ? await new SkillActivityStore(this.agentDir).inspect(current.id) : undefined;
        const reasons = !activity?.userUses && !activity?.reportedUses ? ["no-recorded-use"] : [];
        eligible.push({ id: current.id, scope: current.scope, version: current.version, bodyKey, reasons, lastUse: activity?.lastUse ?? null });
        groups.set(bodyKey, [...groups.get(bodyKey) ?? [], current.id]);
      } catch (error) { diagnostics.push(`${entry.id}: ${String(error)}`); }
    }
    const candidates = eligible.map(({ bodyKey, ...entry }) => {
      const duplicateIds = groups.get(bodyKey)!.filter(id => id !== entry.id);
      return { ...entry, reasons: [...entry.reasons, ...(duplicateIds.length ? ["same-primary-body"] : [])], duplicateIds: duplicateIds.slice(0, 8),
        duplicateCount: duplicateIds.length };
    }).filter(entry => entry.reasons.length).sort((a, b) => a.id.localeCompare(b.id));
    const items: typeof candidates = []; let cursor = Math.min(offset, candidates.length);
    const result = () => ({ status: "no-change", items, total: candidates.length, nextOffset: cursor < candidates.length ? cursor : null,
      diagnostics: diagnostics.slice(0, 3).map(message => message.slice(0, 180)), modelCalled: false,
      notice: "Candidates are not archive/merge permission. No recorded use is not evidence of staleness; same primary body does not compare assets. External references unchecked." });
    while (cursor < candidates.length && items.length < SEARCH_MAX_ITEMS) {
      items.push(candidates[cursor++]!);
      if (JSON.stringify(result()).length <= SEARCH_MAX_CHARS) continue;
      items.pop();
      if (items.length) { --cursor; break; }
      diagnostics.unshift("Oversized candidate omitted; explicitly inspect its stable ID.");
    }
    return result();
  }

  async duplicateBody(body: string, scope: string): Promise<string | undefined> {
    for (const entry of this.entries) {
      if (entry.scope !== scope || entry.explicitOnly) continue;
      const current = await this.inspect(entry.id);
      if (current.explicitOnly) continue;
      // Matching prose with different assets is only a candidate, not an identical new rule.
      const members = await readdir(current.baseDir);
      if (members.length !== 1 || resolve(current.baseDir, members[0]!) !== current.filePath) continue;
      const text = await readFile(current.filePath, "utf8");
      if (contentHash(text) !== current.version) throw new Error("Duplicate source version conflict");
      if (normalizedBody(stripFrontmatter(text)) === normalizedBody(body)) return current.id;
    }
    return undefined;
  }

  async nameConflicts(name: string, scope: "project" | "global"): Promise<CatalogEntry[]> {
    const hits: CatalogEntry[] = [];
    for (const entry of this.entries) {
      if (entry.scope !== scope) continue;
      const current = await this.inspect(entry.id);
      if (current.name === name) hits.push(current);
    }
    return hits;
  }

  async assertManagedWritable(path: string, version: string): Promise<void> {
    const canonical = await realpath(path);
    const entry = this.entries.find(e => e.filePath === canonical);
    if (!entry) throw new Error("Unknown or host-excluded write target");
    const metadata = await this.inspect(entry.id);
    if (metadata.owner !== "managed" || metadata.readOnly || metadata.pinned) throw new Error("Unowned, read-only or pinned target");
    if (metadata.version !== version) throw new Error("Skill version conflict");
  }

  async assertInstalledWritable(id: string, path: string, version: string): Promise<void> {
    const metadata = await this.inspect(id);
    if (metadata.filePath !== path || metadata.owner !== "user-owned" || metadata.readOnly || metadata.pinned) throw new Error("Installed source identity, read-only or pin conflict");
    if (metadata.version !== version) throw new Error("Installed source version conflict");
  }

  async search(query = "", offset = 0, filters: SearchFilters = {}) {
    if (typeof query !== "string" || query.length > 1024) throw new Error("Invalid or excessive search query");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid search offset");
    if (filters.scope && !["project", "global", "external"].includes(filters.scope)) throw new Error("Invalid scope filter");
    if (filters.sourceKind && !["managed", "user-installed", "package", "external"].includes(filters.sourceKind)) throw new Error("Invalid source category");
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches: IndexEntry[] = [];
    const diagnostics = [...this.diagnostics];
    for (const entry of this.entries) {
      if (filters.scope && entry.scope !== filters.scope) continue;
      if (filters.sourceKind && entry.namespace !== filters.sourceKind) continue;
      try {
        const updated = await this.read(entry);
        if (updated.explicitOnly) continue;
        if (terms.every(term => `${updated.name} ${updated.description}`.toLowerCase().includes(term))) matches.push(updated);
      } catch (error) { diagnostics.push(`${entry.id}: ${String(error)}`); }
    }
    matches.sort((a, b) => Number(b.scope === "project") - Number(a.scope === "project") || a.id.localeCompare(b.id));
    if (!matches.length) diagnostics.push("No eligible skill matches; list with an empty query, change filters, or explicitly load a known SkillId.");
    if (offset > matches.length) diagnostics.push("Search offset is beyond the current result set; restart from offset 0.");
    const items: SearchItem[] = [];
    let cursor = Math.min(offset, matches.length);
    const result = () => ({ items, total: matches.length, nextOffset: cursor < matches.length ? cursor : null,
      diagnostics: diagnostics.slice(0, 3).map(s => s.slice(0, 180)) });
    while (cursor < matches.length && items.length < SEARCH_MAX_ITEMS) {
      const entry = matches[cursor]!;
      const item: SearchItem = { id: entry.id, name: entry.name, description: entry.description,
        scope: entry.scope, source: entry.source, filePath: entry.filePath };
      items.push(item);
      ++cursor;
      if (JSON.stringify(result()).length <= SEARCH_MAX_CHARS) continue;
      items.pop();
      if (items.length) { --cursor; break; }
      // An oversized metadata row must not trap pagination at the same offset.
      diagnostics.unshift(`Metadata exceeds search output budget; explicitly load ${entry.id.slice(0, 96)}.`);
    }
    return result();
  }

  private async read(entry: IndexEntry): Promise<IndexEntry> {
    const canonical = await realpath(entry.originalFilePath);
    if (canonical !== entry.filePath || await realpath(entry.originalBaseDir) !== entry.baseDir ||
      !canonical.startsWith(entry.baseDir + sep)) throw new Error("Source moved or escaped root");
    const text = await readFile(canonical, "utf8");
    const { frontmatter } = parseFrontmatter(text);
    if (typeof frontmatter.name !== "string" || !frontmatter.name.trim() ||
      typeof frontmatter.description !== "string" || !frontmatter.description.trim()) throw new Error("Invalid skill frontmatter");
    return { ...entry, name: frontmatter.name, description: frontmatter.description, version: contentHash(text),
      pinned: this.agentDir ? await new SkillActivityStore(this.agentDir).pinned(entry.id, entry.pinned) : entry.pinned,
      explicitOnly: entry.hostExplicitOnly || frontmatter["disable-model-invocation"] === true };
  }

  async view(id: string, file?: string, offset = 0) {
    const entry = this.entries.find(item => item.id === id);
    if (!entry) throw new Error("Unknown or host-excluded SkillId");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid read offset");
    if (file !== undefined && (typeof file !== "string" || !file || isAbsolute(file) ||
      /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith("\\\\") || file.split(/[\\/]/).includes(".."))) {
      throw new Error("Supporting file must be relative without traversal");
    }
    await this.read(entry); // Revalidate logical source/root and frontmatter, not just a cached realpath.
    const path = await realpath(file === undefined ? entry.filePath : resolve(entry.baseDir, file));
    const rel = relative(entry.baseDir, path);
    if (rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw new Error("Supporting file escapes skill root");
    if (!(await stat(path)).isFile()) throw new Error("Only an explicitly selected file can be read");
    const text = await readFile(path, "utf8");
    const characters = Array.from(text);
    let cursor = Math.min(offset, characters.length);
    let content = "";
    const version = contentHash(text);
    const result = () => ({ id, file: rel, version, content, nextOffset: cursor < characters.length ? cursor : null });
    // Reserve the longest scalar-offset representation; count serialized JSON, including escapes.
    const overhead = JSON.stringify({ id, file: rel, version, content: "", nextOffset: characters.length }).length;
    let remaining = READ_MAX_CHARS - overhead;
    if (remaining < 6) throw new Error("Read identity exceeds response budget");
    while (cursor < characters.length) {
      const char = characters[cursor]!;
      const cost = JSON.stringify(char).length - 2;
      if (cost > remaining) break;
      content += char; remaining -= cost; ++cursor;
    }
    return result();
  }
}
