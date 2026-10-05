import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { SettingsManager, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createSkillSources } from "../../src/sources.ts";

const root = process.argv[2]!;
const cwd = join(root, "project"), agentDir = join(root, "agent");
for (const [path, name] of [
  [join(agentDir, "skills/release-check"), "release-check"],
  [join(cwd, ".pi/skills/release-check"), "release-check"],
  [join(agentDir, "skills/excluded-check"), "excluded-check"],
]) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Scoped source fixture\n---\nFixture.\n`);
}
const settings = SettingsManager.inMemory({ skills: ["-skills/excluded-check"], packages: ["npm:@hermes-test/missing-package-1790865331"] });
settings.setProjectTrusted(true);
const request = { cwd, projectTrusted: true, nativeSkills: loadSkillsFromDir({ dir: join(agentDir, "skills/excluded-check"), source: "user" }).skills };
const normal = await createSkillSources({ agentDir, settingsManager: settings })(request);
assert.equal(normal.skills.filter(s => s.name === "release-check").length, 2);
assert.ok(!normal.skills.some(s => s.name === "excluded-check"));
assert.ok(normal.diagnostics.some(d => /host configuration/.test(d)));
const disabled = await createSkillSources({ agentDir, settingsManager: settings, noSkills: true })({ ...request, nativeSkills: normal.skills });
assert.equal(disabled.skills.length, 0);
settings.setProjectTrusted(false);
const untrusted = await createSkillSources({ agentDir, settingsManager: settings })({ ...request, projectTrusted: false });
assert.equal(untrusted.skills.filter(s => s.name === "release-check").length, 1);
assert.ok(untrusted.skills.every(s => s.sourceInfo.scope !== "project"));
const packageRoot = join(root, "temporary-package");
await mkdir(join(packageRoot, "skills/a"), { recursive: true });
await mkdir(join(packageRoot, "skills/b"), { recursive: true });
await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "temporary-fixture", pi: { skills: ["skills/a"] } }));
for (const d of ["a", "b"]) await writeFile(join(packageRoot, `skills/${d}/SKILL.md`), `---\nname: temporary-${d}\ndescription: Temporary source fixture\n---\nFixture.\n`);
const temporary = await createSkillSources({ agentDir, settingsManager: settings, noSkills: true,
  additionalExtensionPaths: [packageRoot, "npm:@hermes-test/also-missing-1790865331"] })({ ...request, projectTrusted: false });
assert.deepEqual(temporary.skills.map(s => s.name), ["temporary-a"]);
assert.ok(temporary.diagnostics.some(d => /offline/.test(d)));
assert.ok(!(await readdir(agentDir)).includes("node_modules"));
console.log(JSON.stringify({ duplicateAllowed: 2, excluded: true, noSkills: disabled.skills.length,
  untrustedAllowed: 1, temporary: temporary.skills.map(s => s.name), missingInstalled: false }));
