import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { satisfies, validRange } from "semver";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { stockTemporaryRoot } from "./temporary-package-root.ts";
import { DefaultPackageManager, SettingsManager, getPackageDir } from "@earendil-works/pi-coding-agent";
import type { Skill, PackageSource } from "@earendil-works/pi-coding-agent";

export interface SkillRestoreRequest { cwd: string; projectTrusted: boolean; id: string; skill: Skill }
export interface SkillRestoreDecision {
  version: 1; cwd: string; projectTrusted: boolean; id: string; filePath: string; allowed: boolean; reason: string;
}
export type SkillRestorePolicy = (request: SkillRestoreRequest) => Promise<SkillRestoreDecision>;

/** A current host decision for one absent destination, not a directory grant or write approval. */
export async function authorizeSkillRestore(policy: SkillRestorePolicy | undefined, request: SkillRestoreRequest) {
  if (!policy) throw new Error("restore-source-unsupported: host restore policy is required");
  if (!request.projectTrusted) throw new Error("Untrusted restore project");
  const value = await policy(structuredClone(request));
  if (!value || value.version !== 1 || value.id !== request.id || value.filePath !== request.skill.filePath ||
    value.projectTrusted !== request.projectTrusted || await realpath(value.cwd) !== await realpath(request.cwd) ||
    typeof value.allowed !== "boolean" || typeof value.reason !== "string") throw new Error("Restore source decision identity/protocol conflict");
  if (!value.allowed) throw new Error(`Restore source denied: ${value.reason.slice(0, 500)}`);
}

const posix = (path: string) => path.split(sep).join("/");
const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
const override = (value: string) => /^[!+-]/.test(value);
const pattern = (value: string) => override(value) || /[*?]/.test(value);
const from = (path: string, base: string) => resolve(base, path.trim().replace(/^~(?=$|\/)/, process.env.HOME || homedir()));
const exists = async (path: string) => stat(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });

function matches(path: string, patterns: string[], base: string, exact = false) {
  const choices = [posix(relative(base, path)), posix(path), ...(!exact ? [basename(path)] : [])];
  if (basename(path) === "SKILL.md") choices.push(posix(relative(base, dirname(path))), posix(dirname(path)), ...(!exact ? [basename(dirname(path))] : []));
  return patterns.some(value => choices.some(choice => exact ? choice === posix(value.replace(/^\.([/\\])/, "")) : minimatch(choice, posix(value))));
}
function enabled(path: string, entries: string[], base: string, includePatterns = false, delta = false) {
  if (delta) {
    let answer = false;
    for (const value of entries) if (matches(path, [override(value) ? value.slice(1) : value], base, /^[+-]/.test(value))) answer = !/^[!-]/.test(value);
    return answer;
  }
  const includes = entries.filter(value => !override(value));
  let answer = !includePatterns || !includes.length || matches(path, includes, base);
  if (matches(path, entries.filter(value => value.startsWith("!")).map(value => value.slice(1)), base)) answer = false;
  if (matches(path, entries.filter(value => value.startsWith("+")).map(value => value.slice(1)), base, true)) answer = true;
  if (matches(path, entries.filter(value => value.startsWith("-")).map(value => value.slice(1)), base, true)) answer = false;
  return answer;
}

/** Follow only the known target's ancestor chain. Never insert a probe in a real source or scan unknown roots. */
async function discoverable(path: string, root: string, mode: "pi" | "agents" = "pi"): Promise<boolean> {
  if (path === root) return true; // An explicitly selected file is not recursively filtered by ignore files.
  if (!inside(path, root) || !path.endsWith(".md") || !await exists(root)) return false;
  if (!(await stat(root)).isDirectory()) return false;
  const ig = ignore(); let dir = root;
  const parts = relative(root, path).split(sep);
  for (let index = 0; index < parts.length; index++) {
    const prefix = posix(relative(root, dir));
    for (const name of [".gitignore", ".ignore", ".fdignore"]) {
      let text: string;
      try { text = await readFile(join(dir, name), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (let line of text.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#") && !line.trim().startsWith("\\#")) continue;
        const negated = line.startsWith("!");
        if (negated || line.startsWith("\\!")) line = line.slice(1);
        line = line.replace(/^\//, "");
        ig.add(`${negated ? "!" : ""}${prefix ? prefix + "/" : ""}${line}`);
      }
    }
    const name = parts[index]!, last = index === parts.length - 1, child = join(dir, name);
    const primary = join(dir, "SKILL.md");
    const ownPrimary = primary === path || await exists(primary);
    if (ownPrimary && !ig.ignores(posix(relative(root, primary)))) return path === primary;
    if (name.startsWith(".") || name === "node_modules" || ig.ignores(posix(relative(root, child)) + (last ? "" : "/"))) return false;
    if (last) return mode === "pi" ? dir === root : dir !== root;
    dir = child;
  }
  return false;
}

async function manifestEntries(root: string): Promise<{ present: boolean; skills?: string[] }> {
  try {
    const pkg = JSON.parse((await readFile(join(root, "package.json"), "utf8")).replace(/^\uFEFF/, ""));
    const present = !!pkg?.pi && typeof pkg.pi === "object" && !Array.isArray(pkg.pi);
    return { present, skills: present && Array.isArray(pkg.pi.skills) && pkg.pi.skills.every((value: unknown) => typeof value === "string") ? pkg.pi.skills : undefined };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { present: false }; throw error; }
}
async function selectedPath(path: string, selection: string): Promise<string | undefined> {
  const info = await stat(selection).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (info?.isDirectory()) {
    const canonical = await realpath(selection);
    return inside(path, canonical) ? join(selection, relative(canonical, path)) : undefined;
  }
  const parent = await realpath(dirname(selection)).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  return parent && join(parent, basename(selection)) === path ? selection : undefined;
}
async function entryPaths(path: string, entries: string[], root: string, globs: boolean): Promise<string[]> {
  const result = new Set<string>();
  for (const entry of entries.filter(value => !override(value))) {
    if (globs && /[*?]/.test(entry)) {
      const selected = await selectedPath(path, root) ?? path, rel = relative(root, selected);
      if (rel.split(sep).some(part => part.startsWith(".") && part !== "..")) continue;
      for (let candidate = selected; ; candidate = dirname(candidate)) {
        if (minimatch(posix(relative(root, candidate)), posix(entry)) && await discoverable(selected, candidate)) { result.add(selected); break; }
        if (candidate === root || dirname(candidate) === candidate) break;
      }
    } else {
      const selection = globs ? resolve(root, entry) : from(entry, root), selected = await selectedPath(path, selection);
      if (selected && await discoverable(selected, selection)) result.add(selected);
    }
  }
  return [...result];
}
async function packagePaths(path: string, root: string, pkg: PackageSource) {
  const manifest = await manifestEntries(root), filter = typeof pkg === "object" ? pkg : undefined;
  const entries = filter?.skills !== undefined || filter?.autoload === false ? manifest.skills?.length ? manifest.skills : ["skills"] :
    manifest.skills ?? (manifest.present && !filter ? [] : ["skills"]);
  return (await entryPaths(path, entries, root, true)).filter(selected => enabled(selected, entries.filter(override), root, true))
    .flatMap(selected => {
      if (filter?.autoload === false && !(filter.skills ?? []).some(value => matches(selected, [override(value) ? value.slice(1) : value], root, /^[+-]/.test(value)))) return [];
      return [{ path: selected, enabled: filter?.autoload === false ? enabled(selected, filter.skills ?? [], root, true, true) :
        filter?.skills === undefined || !!filter.skills.length && enabled(selected, filter.skills, root, true) }];
    });
}

// Use the official source identity parser via public operations on fresh IN-MEMORY settings.
// Neither host settings nor files are mutated; this also handles Git URL aliases and npm versions without a second parser.
function normalizedPackage(source: string, base: string, agentDir: string): string {
  const memory = SettingsManager.inMemory();
  new DefaultPackageManager({ cwd: base, agentDir, settingsManager: memory }).addSourceToSettings(source);
  const entry = memory.getGlobalSettings().packages![0]!;
  return typeof entry === "string" ? entry : entry.source;
}
function samePackage(a: string, b: string, agentDir: string): boolean {
  const memory = SettingsManager.inMemory({ packages: [a] });
  return new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager: memory }).removeSourceFromSettings(b);
}
async function installedVersion(source: string, root: string) {
  if (!source.startsWith("npm:")) return true;
  try {
    const installed = JSON.parse((await readFile(join(root, "package.json"), "utf8")).replace(/^\uFEFF/, "")).version;
    const requested = source.slice(4).trim().match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/)?.[2];
    const range = requested ? validRange(requested) : null;
    return typeof installed === "string" && !!installed && (!range || satisfies(installed, range));
  } catch (error) { if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

type Candidate = { path: string; enabled: boolean; source: string; scope: "user" | "project" | "temporary"; origin: "top-level" | "package"; baseDir?: string };
async function configuredCandidates(path: string, cwd: string, agentDir: string, settings: SettingsManager): Promise<Candidate[]> {
  const user = settings.getGlobalSettings(), project = settings.getProjectSettings(), manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  const candidates = new Map<string, Candidate>();
  const add = (candidate: Candidate) => { if (!candidates.has(candidate.path)) candidates.set(candidate.path, candidate); };
  const scopes = [{ scope: "project" as const, base: join(cwd, ".pi"), settings: project }, { scope: "user" as const, base: agentDir, settings: user }];
  const packages: { pkg: PackageSource; source: string; scope: "user" | "project"; normalized: string }[] = [];
  for (const scope of scopes) for (const pkg of scope.settings.packages ?? []) {
    const source = typeof pkg === "string" ? pkg : pkg.source, normalized = normalizedPackage(source, scope.base, agentDir);
    const index = packages.findIndex(row => samePackage(row.normalized, normalized, agentDir)), old = packages[index];
    const entry = { pkg, source, scope: scope.scope, normalized };
    if (!old) packages.push(entry);
    else if (old.scope === "project" && scope.scope === "user") { if (typeof old.pkg === "object" && old.pkg.autoload === false) packages.push(entry); }
    else if (scope.scope === "project") packages[index] = entry;
  }
  for (const entry of packages) {
    const inherited = entry.scope === "project" && typeof entry.pkg === "object" && entry.pkg.autoload === false ?
      packages.find(row => row.scope === "user" && samePackage(row.normalized, entry.normalized, agentDir)) : undefined;
    const location = inherited ?? entry, root = manager.getInstalledPath(location.source, location.scope);
    if (!root || !await installedVersion(location.source, root)) continue;
    for (const selected of await packagePaths(path, root, entry.pkg)) add({ ...selected, source: entry.source, scope: entry.scope, origin: "package", baseDir: root });
  }
  for (const scope of scopes) {
    const entries = scope.settings.skills ?? [];
    for (const selected of await entryPaths(path, entries.filter(value => !pattern(value)), scope.base, false)) {
      add({ path: selected, enabled: enabled(selected, entries.filter(pattern), scope.base, true), source: "local", scope: scope.scope, origin: "top-level" });
    }
  }
  const roots = [{ root: join(cwd, ".pi/skills"), base: join(cwd, ".pi"), mode: "pi" as "pi" | "agents", scope: "project" as "project" | "user" }];
  const homeAgents = join(process.env.HOME || homedir(), ".agents");
  for (let current = resolve(cwd); ; current = dirname(current)) {
    const base = join(current, ".agents");
    if (base !== homeAgents) roots.push({ root: join(base, "skills"), base, mode: "agents", scope: "project" });
    if (await exists(join(current, ".git")) || dirname(current) === current) break;
  }
  roots.push({ root: join(agentDir, "skills"), base: agentDir, mode: "pi", scope: "user" },
    { root: join(homeAgents, "skills"), base: homeAgents, mode: "agents", scope: "user" });
  for (const root of roots) {
    const selected = await selectedPath(path, root.root);
    if (!selected || !await discoverable(selected, root.root, root.mode)) continue;
    const entries = root.scope === "project" ? project.skills ?? [] : user.skills ?? [];
    add({ path: selected, enabled: enabled(selected, entries.filter(override), root.base), source: "auto", scope: root.scope, origin: "top-level", baseDir: root.base });
  }
  const rank = (row: Candidate) => row.origin === "package" ? 4 : (row.scope === "project" ? 0 : 2) + (row.source === "local" ? 0 : 1);
  return [...candidates.values()].sort((a, b) => rank(a) - rank(b));
}

async function temporaryCandidates(path: string, cwd: string, agentDir: string, sources: string[]): Promise<Candidate[]> {
  const result = new Map<string, Candidate>();
  for (const source of sources) {
    if (source.startsWith("builtin:")) continue;
    const normalized = normalizedPackage(source, cwd, agentDir);
    let root = from(normalized, agentDir);
    if (!samePackage(normalized, root, agentDir)) {
      // A layout-dependent predicate must not silently authorize an unverified SDK layout.
      if (JSON.parse(await readFile(join(getPackageDir(), "package.json"), "utf8")).version !== "0.99.2") throw new Error("restore-source-unsupported: unverified temporary cache layout; supply a current host restore policy");
      root = stockTemporaryRoot(agentDir, source);
    }
    if (!await stat(root).then(info => info.isDirectory(), error => { if (error.code === "ENOENT") return false; throw error; }) || !await installedVersion(source, root)) continue;
    for (const selected of await packagePaths(path, root, source)) {
      if (!result.has(selected.path)) result.set(selected.path, { ...selected, source, scope: "temporary", origin: "package", baseDir: root });
    }
  }
  return [...result.values()];
}

/** Stock 0.99.2 missing-path filter, kept local because its public resolver enumerates existing files only.
 * SDK custom loaders must supply their own final policy instead of using this stock helper.
 */
export function createSkillRestorePolicy(options: {
  agentDir: string; settingsManager?: SettingsManager; noSkills?: boolean; additionalSkillPaths?: string[];
  additionalExtensionPaths?: string[];
}): SkillRestorePolicy {
  return async request => {
    const { skill, cwd, projectTrusted, id } = request, path = skill.filePath, source = skill.sourceInfo;
    const answer = (allowed: boolean, reason: string): SkillRestoreDecision => ({ version: 1, cwd, projectTrusted, id, filePath: path, allowed, reason });
    if (!projectTrusted || !isAbsolute(path) || !isAbsolute(skill.baseDir) || !inside(path, skill.baseDir) ||
      await realpath(skill.baseDir) !== skill.baseDir || await realpath(dirname(path)) !== dirname(path)) return answer(false, "Untrusted or rebound restoration identity");
    const settings = options.settingsManager ?? SettingsManager.create(cwd, options.agentDir, { projectTrusted });
    if (settings.isProjectTrusted() !== projectTrusted) return answer(false, "Current host trust mismatch");
    if (options.noSkills && source.scope !== "temporary") return answer(false, "noSkills");
    const temporary = await temporaryCandidates(path, cwd, options.agentDir, options.additionalExtensionPaths ?? []);
    const configured = options.noSkills ? [] : await configuredCandidates(path, cwd, options.agentDir, settings);
    const direct = (await entryPaths(path, options.additionalSkillPaths ?? [], cwd, false)).map(selected => ({ path: selected, enabled: true,
      source: "cli", scope: "temporary" as const, origin: "top-level" as const, baseDir: undefined }));
    // Configured resolver deduplicates disabled paths before noSkills/CLI merge; enabled temporary resources lead the plugin snapshot.
    const current = [...temporary.filter(row => row.enabled), ...configured.slice(0, 1).filter(row => row.enabled), ...direct][0];
    if (!current) return answer(false, "Current settings/manifest/ignore rules exclude or no longer select this path");
    if (current.source !== source.source || current.scope !== source.scope || current.origin !== source.origin || current.baseDir !== source.baseDir) {
      return answer(false, "Current source identity changed; the archived source cannot override it");
    }
    return answer(true, "Current stock source and filters select the original identity");
  };
}
