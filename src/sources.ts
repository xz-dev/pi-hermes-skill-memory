import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  DefaultPackageManager, SettingsManager, getPackageDir, loadSkills, loadSkillsFromDir, parseArgs,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedResource, Skill } from "@earendil-works/pi-coding-agent";

export interface SkillSourceRequest {
  cwd: string;
  projectTrusted: boolean;
  nativeSkills: readonly Skill[];
}
export interface SkillSourceSnapshot {
  version: 1;
  cwd: string;
  projectTrusted: boolean;
  skills: Skill[];
  diagnostics: string[];
}
export type SkillSources = (request: SkillSourceRequest) => Promise<SkillSourceSnapshot>;

/** Host code supplies this result AFTER its runtime filters, never from model proposals. */
export async function validateSkillSources(value: SkillSourceSnapshot, request: SkillSourceRequest): Promise<SkillSourceSnapshot> {
  if (!value || value.version !== 1) throw new Error("Unsupported skill source protocol; expected version 1");
  if (await realpath(value.cwd) !== await realpath(request.cwd) || value.projectTrusted !== request.projectTrusted) {
    throw new Error("Skill source snapshot belongs to another project or trust state");
  }
  if (!Array.isArray(value.skills) || !Array.isArray(value.diagnostics) || value.diagnostics.some(d => typeof d !== "string")) {
    throw new Error("Invalid skill source snapshot");
  }
  for (const s of value.skills) {
    if (!s || typeof s.name !== "string" || typeof s.description !== "string" || typeof s.filePath !== "string" ||
      typeof s.baseDir !== "string" || typeof s.disableModelInvocation !== "boolean" ||
      !s.sourceInfo || !["user", "project", "temporary"].includes(s.sourceInfo.scope) ||
      !["package", "top-level"].includes(s.sourceInfo.origin) || typeof s.sourceInfo.source !== "string") {
      throw new Error("Invalid allowed skill metadata");
    }
    if (!request.projectTrusted && s.sourceInfo.scope === "project") throw new Error("Snapshot exposes an untrusted project source");
  }
  return structuredClone(value);
}

/** Public resolver for the stock SDK loader. Caller must supply its actual runtime options.
 * Custom loaders/skillsOverride should instead provide their final allowed Skill[] directly.
 */
export function createSkillSources(options: {
  agentDir: string;
  settingsManager?: SettingsManager;
  noSkills?: boolean;
  additionalSkillPaths?: string[];
  additionalExtensionPaths?: string[];
}): SkillSources {
  return async request => {
    const settings = options.settingsManager ?? SettingsManager.create(request.cwd, options.agentDir, { projectTrusted: request.projectTrusted });
    if (!options.settingsManager) settings.setProjectTrusted(request.projectTrusted);
    if (settings.isProjectTrusted() !== request.projectTrusted) throw new Error("Source settings trust differs from host trust");
    const manager = new DefaultPackageManager({ cwd: request.cwd, agentDir: options.agentDir, settingsManager: settings });
    const diagnostics: string[] = [];
    const configured = await manager.resolve(async source => {
      diagnostics.push(`Missing package skipped (not installed): ${source}`);
      return "skip";
    });
    // resolveExtensionSources has no onMissing callback and can refresh temporary Git sources.
    // An offline child confines that public resolver; no process-wide offline flag or private cache paths.
    let temporary: ResolvedResource[] = [];
    if (options.additionalExtensionPaths?.length) {
      const { stdout } = await promisify(execFile)(process.execPath,
        [fileURLToPath(new URL("./source-worker.mjs", import.meta.url)), request.cwd, options.agentDir,
          JSON.stringify(options.additionalExtensionPaths)],
        { env: { ...process.env, PI_OFFLINE: "1" }, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
      temporary = JSON.parse(stdout) as ResolvedResource[];
      diagnostics.push(`CLI temporary sources resolved offline: ${temporary.filter(r => r.enabled).length} allowed skill paths; missing packages were not installed`);
    }
    const paths = [...temporary, ...configured.skills];
    const skills: Skill[] = [];
    for (const resource of paths) {
      if (!resource.enabled || (options.noSkills && resource.metadata.scope !== "temporary")) {
        diagnostics.push(`Excluded (${resource.enabled ? "noSkills" : "host configuration"}): ${resource.path}`);
        continue;
      }
      if (!request.projectTrusted && resource.metadata.scope === "project") {
        diagnostics.push(`Excluded (untrusted project): ${resource.path}`);
        continue;
      }
      const loaded = await loadPath(resource.path, request.cwd, options.agentDir);
      diagnostics.push(...loaded.diagnostics.map(d => `${d.path}: ${d.message}`));
      skills.push(...loaded.skills.map(skill => ({ ...skill, sourceInfo: {
        path: skill.filePath, source: resource.metadata.source, scope: resource.metadata.scope,
        origin: resource.metadata.origin, baseDir: resource.metadata.baseDir,
      } })));
    }
    for (const path of options.additionalSkillPaths ?? []) {
      const loaded = await loadPath(path, request.cwd, options.agentDir);
      diagnostics.push(...loaded.diagnostics.map(d => `${d.path}: ${d.message}`));
      skills.push(...loaded.skills.map(skill => ({ ...skill, sourceInfo: {
        path: skill.filePath, source: "cli", scope: "temporary" as const, origin: "top-level" as const,
      } })));
    }
    // Native survivors also cover host extension-contributed resources. Config exclusions win.
    const excluded = await Promise.all(configured.skills.filter(r => !r.enabled).map(async r => {
      try { return await realpath(r.path); } catch { return resolve(r.path); }
    }));
    for (const skill of request.nativeSkills) {
      if (options.noSkills && skill.sourceInfo.scope !== "temporary") continue;
      let path: string;
      try { path = await realpath(skill.filePath); } catch { path = resolve(skill.filePath); }
      if (!excluded.some(root => path === root || path.startsWith(root + "/"))) skills.push(skill);
    }
    return { version: 1, cwd: await realpath(request.cwd), projectTrusted: request.projectTrusted, skills, diagnostics };
  };
}

async function loadPath(path: string, cwd: string, agentDir: string) {
  const absolute = resolve(cwd, path);
  if ((await stat(absolute)).isDirectory()) return loadSkillsFromDir({ dir: absolute, source: "path" });
  return loadSkills({ cwd, agentDir, skillPaths: [absolute], includeDefaults: false });
}

export function createCliSkillSources(agentDir: string): SkillSources {
  return async request => {
    const executable = process.argv[1];
    if (!executable || await realpath(executable) !== await realpath(join(getPackageDir(), "dist", "bundle", "cli.js"))) {
      throw new Error("SDK host must pass skillSources to createSkillsExtension; CLI arguments are not inferred");
    }
    const args = parseArgs(process.argv.slice(2));
    return createSkillSources({ agentDir, noSkills: args.noSkills, additionalSkillPaths: args.skills,
      additionalExtensionPaths: args.extensions })(request);
  };
}
