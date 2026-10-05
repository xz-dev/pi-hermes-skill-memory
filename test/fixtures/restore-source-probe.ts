import assert from "node:assert/strict";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = process.argv[2]!;
const cwd = join(root, "project"), agentDir = join(root, "agent"), target = join(agentDir, "skills/probe/SKILL.md");
await mkdir(cwd, { recursive: true }); await mkdir(join(agentDir, "skills/probe"), { recursive: true });
await writeFile(target, "---\nname: probe\ndescription: Restore-admission API probe\n---\nFixture content.\n");
const allowedSettings = SettingsManager.inMemory(); allowedSettings.setProjectTrusted(true);
const excludedSettings = SettingsManager.inMemory({ skills: ["-skills/probe"] }); excludedSettings.setProjectTrusted(true);
const resolve = async (settingsManager: SettingsManager) => (await new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(async () => "skip")).skills;
const presentAllowed = await resolve(allowedSettings), presentExcluded = await resolve(excludedSettings);
assert.equal(presentAllowed.find(row => row.path === target)?.enabled, true);
assert.equal(presentExcluded.find(row => row.path === target)?.enabled, false);
const archive = join(agentDir, "hermes-skills/archive"); await mkdir(archive, { recursive: true });
await rename(target, join(archive, "SKILL.md"));
const absentAllowed = await resolve(allowedSettings), absentExcluded = await resolve(excludedSettings);
assert.equal(absentAllowed.some(row => row.path === target), false);
assert.equal(absentExcluded.some(row => row.path === target), false);
console.log(JSON.stringify({ presentAllowed: true, presentExcluded: true, absentAllowedResource: false, absentExcludedResource: false,
  distinguishAbsentPermissionFromResolvedPaths: false, modelCalls: 0, fixtureOnly: true, package: "official 0.99.2" }));
