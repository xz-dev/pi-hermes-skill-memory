import assert from "node:assert/strict";
import { mkdir, writeFile, rename, stat, readFile, symlink, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DefaultPackageManager, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { EnabledCatalog } from "../../src/catalog.ts";
import { createSkillSources } from "../../src/sources.ts";
import { createSkillRestorePolicy } from "../../src/restore-sources.ts";

const root = process.argv[2]!, cwd = join(root, "project"), agentDir = join(root, "agent");
await mkdir(join(cwd, ".git"), { recursive: true }); await mkdir(agentDir, { recursive: true });
const text = "---\nname: matrix-rule\ndescription: Local differential fixture\n---\nKeep these bytes.\n";
const observations: { label: string; expected: boolean; allowed: boolean }[] = [];
const errors: string[] = [];
let skillCount = 0;
async function skill(path: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text.replace("matrix-rule", `matrix-rule-${++skillCount}`)); }
async function settings(user = {}, project = {}) {
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify(user)); await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify(project));
  return SettingsManager.create(cwd, agentDir, { projectTrusted: true });
}
async function check(label: string, file: string, user = {}, project = {}, runtime: { noSkills?: boolean; additionalSkillPaths?: string[]; additionalExtensionPaths?: string[] } = {}, original?: Skill) {
  const current = await settings(user, project);
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: current, noExtensions: true, noPromptTemplates: true, noThemes: true, ...runtime });
  await loader.reload();
  const loaded = await Promise.all(loader.getSkills().skills.map(async row => ({ ...row, filePath: await realpath(row.filePath), baseDir: await realpath(row.baseDir) })));
  const found = loaded.find(row => row.filePath === file);
  const provided = await createSkillSources({ agentDir, settingsManager: current, ...runtime })({ cwd, projectTrusted: true, nativeSkills: [] });
  const catalog = new EnabledCatalog(agentDir); await catalog.capture(provided.skills, true, provided.diagnostics, cwd);
  const candidate = (await catalog.search()).items.find(row => row.filePath === file);
  const pluginSkill = candidate ? await catalog.source(candidate.id) : undefined;
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: current });
  const resolved = (await manager.resolve(async () => "skip")).skills.find(row => row.path === file);
  const source = original ?? pluginSkill;
  assert.ok(source, `Fixture needs an allowed baseline: ${label}`);
  const expected = !!found;
  // Different rules can select a different source identity for the same path; restoring old identity is not permission to rebind it.
  const sameIdentity = !!pluginSkill && pluginSkill.sourceInfo.source === source.sourceInfo.source && pluginSkill.sourceInfo.scope === source.sourceInfo.scope &&
    pluginSkill.sourceInfo.origin === source.sourceInfo.origin && pluginSkill.sourceInfo.baseDir === source.sourceInfo.baseDir;
  const before = await readFile(file, "utf8");
  const archived = join(root, `archive-${observations.length}.md`); await rename(file, archived);
  try {
    const result = await createSkillRestorePolicy({ agentDir, settingsManager: current, ...runtime })({ cwd, projectTrusted: true, id: "matrix-id", skill: source });
    observations.push({ label, expected: expected && sameIdentity, allowed: result.allowed });
    if (result.allowed !== (expected && sameIdentity)) errors.push(JSON.stringify({ label, expected, sameIdentity, result, source: source.sourceInfo, resolved }));
    await assert.rejects(stat(file), /ENOENT/); assert.equal(await readFile(archived, "utf8"), before);
  } finally { await rename(archived, file); }
  return source;
}

const auto = join(cwd, ".pi/skills/group/matrix/SKILL.md"); await skill(auto);
const autoSource = await check("project auto", auto);
for (const [name, rules] of [["excluded", ["!skills/**"]], ["forced", ["!skills/**", "+skills/group/matrix"]], ["hard-excluded", ["+skills/group/matrix", "-skills/group/matrix"]]] as const)
  await check(`project ${name}`, auto, {}, { skills: rules }, {}, autoSource);
await writeFile(join(cwd, ".pi/skills/.ignore"), "group/\n"); await check("ignore ancestor", auto, {}, {}, {}, autoSource);
await writeFile(join(cwd, ".pi/skills/.ignore"), "");
await writeFile(join(dirname(auto), ".fdignore"), "SKILL.md\n"); await check("ignore primary", auto, {}, {}, {}, autoSource);
await writeFile(join(dirname(auto), ".fdignore"), "");
const agents = join(cwd, ".agents/skills/loose/rule.md"); await skill(agents);
const agentSource = await check("agents nested loose file", agents);
await check("agents exclusion", agents, {}, { skills: ["-skills/loose/rule.md"] }, {}, agentSource);
await rename(agents, agents + ".inactive");
const local = join(root, "configured/rule/SKILL.md"); await skill(local);
const localSource = await check("configured exact directory", local, { skills: [dirname(local)] });
await check("configured removed", local, {}, {}, {}, localSource);
await check("configured pattern exclusion", local, { skills: [dirname(local), "!**/rule/**"] }, {}, {}, localSource);
await check("configured explicit file", local, { skills: [local] });
await check("configured noSkills", local, { skills: [local] }, {}, { noSkills: true }, localSource);
const cliSource = await check("CLI explicit file under noSkills", local, {}, {}, { noSkills: true, additionalSkillPaths: [local] });
await check("CLI explicit directory", local, {}, {}, { noSkills: true, additionalSkillPaths: [dirname(local)] }, cliSource);
await check("CLI removed", local, {}, {}, { noSkills: true }, cliSource);

const pkg = join(root, "package"), target = join(pkg, "skills/rule/SKILL.md"); await skill(target);
const pkgJson = join(pkg, "package.json");
await writeFile(pkgJson, JSON.stringify({ name: "fixture-package", version: "1.0.0", pi: { skills: ["skills"] } }));
const pkgSource = await check("package manifest", target, { packages: [pkg] });
await check("package empty filter", target, { packages: [{ source: pkg, skills: [] }] }, {}, {}, pkgSource);
await check("package force include", target, { packages: [{ source: pkg, skills: ["!**", "+skills/rule"] }] }, {}, {}, pkgSource);
await check("package force exclude", target, { packages: [{ source: pkg, skills: ["+skills/rule", "-skills/rule"] }] }, {}, {}, pkgSource);
await check("package autoload false explicit", target, { packages: [{ source: pkg, autoload: false, skills: ["+skills/rule"] }] }, {}, {}, pkgSource);
await check("package autoload false ordering", target, { packages: [{ source: pkg, autoload: false, skills: ["+skills/rule", "-skills/rule", "+skills/rule"] }] }, {}, {}, pkgSource);
await check("package removed", target, {}, {}, {}, pkgSource);
const projectSource = await check("project package wins", target, { packages: [pkg] }, { packages: [pkg] });
await check("old user identity cannot bypass project override", target, { packages: [pkg] }, { packages: [{ source: pkg, skills: [] }] }, {}, pkgSource);
await check("project delta disables global package path", target, { packages: [pkg] }, { packages: [{ source: pkg, autoload: false, skills: ["-skills/rule"] }] }, {}, projectSource);
await check("project delta falls through", target, { packages: [pkg] }, { packages: [{ source: pkg, autoload: false, skills: ["+skills/missing"] }] }, {}, pkgSource);
await writeFile(pkgJson, JSON.stringify({ name: "fixture-package", version: "1.0.0", pi: { skills: ["skills/*", "!**/rule/**"] } }));
await check("manifest glob excluded", target, { packages: [pkg] }, {}, {}, pkgSource);
await writeFile(pkgJson, JSON.stringify({ name: "fixture-package", version: "1.0.0", pi: { skills: ["skills/*", "!**/rule/**", "+skills/rule"] } }));
await check("manifest glob force include", target, { packages: [pkg] }, {}, {}, pkgSource);
const temporary = await check("temporary local package", target, {}, {}, { additionalExtensionPaths: [pkg], noSkills: true });
await check("temporary removed", target, {}, {}, { noSkills: true }, temporary);
await writeFile(pkgJson, JSON.stringify({ name: "fixture-package", pi: { skills: [] } }));
await check("manifest empty means none", target, { packages: [pkg] }, {}, {}, pkgSource);
await check("filter with empty manifest falls back to convention", target, { packages: [{ source: pkg, skills: ["skills/**"] }] }, {}, {}, pkgSource);

const npmRoot = join(agentDir, "npm/node_modules/@hermes-fixture/cached"), npmFile = join(npmRoot, "skills/rule/SKILL.md");
await skill(npmFile);
const npmSource = "npm:@hermes-fixture/cached@^1.0.0", npmManifest = join(npmRoot, "package.json");
await writeFile(npmManifest, JSON.stringify({ name: "@hermes-fixture/cached", version: "1.5.0", pi: { skills: ["skills"] } }));
const npmSkill = await check("cached npm compatible version", npmFile, { packages: [npmSource] });
await writeFile(npmManifest, JSON.stringify({ name: "@hermes-fixture/cached", version: "2.0.0", pi: { skills: ["skills"] } }));
await check("cached npm wrong installed version", npmFile, { packages: [npmSource] }, {}, {}, npmSkill);
await writeFile(npmManifest, JSON.stringify({ name: "@hermes-fixture/cached", version: "1.5.0", pi: { skills: ["skills"] } }));
await check("missing project npm version still shadows global", npmFile, { packages: [npmSource] }, { packages: ["npm:@hermes-fixture/cached@^2.0.0"] }, {}, npmSkill);
await check("npm project delta inherits the global installed root", npmFile, { packages: [npmSource] },
  { packages: [{ source: "npm:@hermes-fixture/cached@^2.0.0", autoload: false, skills: ["+skills/rule"] }] });
const gitRoot = join(agentDir, "git/github.com/hermes-fixture/cached"), gitFile = join(gitRoot, "skills/rule/SKILL.md");
await skill(gitFile); await writeFile(join(gitRoot, "package.json"), JSON.stringify({ pi: { skills: ["skills"] } }));
const gitSource = "git:github.com/hermes-fixture/cached@main";
const gitSkill = await check("cached configured Git package", gitFile, { packages: [gitSource] });
await check("Git URL alias project override shadows user cache", gitFile, { packages: [gitSource] },
  { packages: ["git:git@github.com:hermes-fixture/cached@other-ref"] }, {}, gitSkill);

const link = join(root, "linked-local"); await symlink(join(root, "configured"), link);
await check("explicit symlink source", local, { skills: [join(link, "rule")] }, {}, {}, localSource);
console.log(JSON.stringify({ observations, errors, targetWrittenDuringDecision: false, modelCalls: 0 }));
assert.equal(errors.length, 0, errors.join("\n"));
