// Synthetic cached package only. The cache shape is fixture setup, not production path inference.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rename, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createSkillSources } from "../../src/sources.ts";
import { createSkillRestorePolicy } from "../../src/restore-sources.ts";
import { EnabledCatalog } from "../../src/catalog.ts";
import { stockTemporaryRoot } from "../../src/temporary-package-root.ts";

const root = process.argv[2]!, cwd = join(root, "project"), agentDir = join(root, "agent");
const name = "@hermes-restore-fixture/only-skill", source = `npm:${name}@1.0.0`;
const fixtureCache = join(agentDir, "tmp/extensions/npm", createHash("sha256").update("npm-").digest("hex").slice(0, 8), "node_modules", name);
const target = join(fixtureCache, "skills/rule/SKILL.md"), saved = join(root, "archived-skill.md");
await mkdir(join(cwd, ".git"), { recursive: true }); await mkdir(join(fixtureCache, "skills/rule"), { recursive: true });
await writeFile(join(fixtureCache, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { skills: ["skills"] } }));
const text = "---\nname: only-skill\ndescription: Temporary package root API probe\n---\nPreserved.\n";
await writeFile(target, text);
const settings = SettingsManager.inMemory(); settings.setProjectTrusted(true);
const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
const before = await manager.resolveExtensionSources([source], { temporary: true });
assert.equal(before.skills.length, 1); assert.equal(before.skills[0]!.metadata.baseDir, fixtureCache);
const input = await createSkillSources({ agentDir, settingsManager: settings, additionalExtensionPaths: [source], noSkills: true })({ cwd, projectTrusted: true, nativeSkills: [] });
const catalog = new EnabledCatalog(agentDir); await catalog.capture(input.skills, true, [], cwd);
const hit = (await catalog.search()).items[0]!, skill = await catalog.source(hit.id);
const request = { cwd, projectTrusted: true, id: hit.id, skill };
const policy = createSkillRestorePolicy({ agentDir, settingsManager: settings, additionalExtensionPaths: [source], noSkills: true });
assert.equal(stockTemporaryRoot(agentDir, source), before.skills[0]!.metadata.baseDir);
await rename(target, saved);
const after = await manager.resolveExtensionSources([source], { temporary: true });
assert.equal(Object.values(after).flat().length, 0);
const userPath = manager.getInstalledPath(source, "user"), projectPath = manager.getInstalledPath(source, "project");
assert.equal(userPath, undefined); assert.equal(projectPath, undefined); assert.equal(await readFile(saved, "utf8"), text);
assert.equal((await policy(request)).allowed, true);
assert.equal((await createSkillRestorePolicy({ agentDir, settingsManager: settings, noSkills: true })(request)).allowed, false);
await assert.rejects(stat(target), /ENOENT/);
await writeFile(join(fixtureCache, "package.json"), JSON.stringify({ name, version: "2.0.0", pi: { skills: ["skills"] } }));
assert.equal((await policy(request)).allowed, false, "unchanged CLI input is not permission to restore into an incompatible installed version");
const gitCases = [
  ["git:https://github.com/hermes-fixture/cached.git@main", "github.com", "hermes-fixture/cached", "main"],
  ["git:git@github.com:hermes-fixture/cached@refs/heads/a/b", "github.com", "hermes-fixture/cached", "refs/heads/a/b"],
  ["git:gitlab:group/nested/cached#release", "gitlab.com", "group/nested/cached", "release"],
  ["ssh://git@forge.example.test/group/cached@v1", "forge.example.test", "group/cached", "v1"],
  ["git:https://forge.example.test/group/sub/cached", "forge.example.test", "group/sub/cached", undefined],
] as const;
for (const [source, host, repo, ref] of gitCases) {
  const prefix = `git-${host}`, bucket = createHash("sha256").update(`${prefix}-${repo}${ref ? `@${ref}` : ""}`).digest("hex").slice(0, 8);
  const rootPath = join(agentDir, "tmp/extensions", prefix, bucket, repo), path = join(rootPath, "skills/rule/SKILL.md");
  await mkdir(join(rootPath, "skills/rule"), { recursive: true });
  await writeFile(join(rootPath, "package.json"), JSON.stringify({ pi: { skills: ["skills"] } })); await writeFile(path, text);
  const stock = await manager.resolveExtensionSources([source], { temporary: true });
  assert.equal(stock.skills.length, 1, source); assert.equal(stockTemporaryRoot(agentDir, source), stock.skills[0]!.metadata.baseDir, source);
  const supplied = await createSkillSources({ agentDir, settingsManager: settings, additionalExtensionPaths: [source], noSkills: true })({ cwd, projectTrusted: true, nativeSkills: [] });
  await catalog.capture(supplied.skills, true, [], cwd); const hit = (await catalog.search()).items[0]!;
  const skill = await catalog.source(hit.id); await rename(path, join(root, `git-archive-${bucket}.md`));
  const decision = await createSkillRestorePolicy({ agentDir, settingsManager: settings, additionalExtensionPaths: [source], noSkills: true })({ cwd, projectTrusted: true, id: hit.id, skill });
  assert.equal(decision.allowed, true, JSON.stringify({ source, decision })); await assert.rejects(stat(path), /ENOENT/);
}
console.log(JSON.stringify({ cachedNpmRestorable: true, gitCases: gitCases.length, source, beforeSkills: before.skills.length, beforeRoot: before.skills[0]!.metadata.baseDir,
  afterResources: Object.values(after).flat().length, publicUserPath: userPath ?? null, publicProjectPath: projectPath ?? null,
  archivedBytesPreserved: true, modelCalls: 0, publicApiOnly: true }));
