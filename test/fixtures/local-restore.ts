import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat, symlink, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createSkillSources } from "../../src/sources.ts";
import { createSkillRestorePolicy } from "../../src/restore-sources.ts";
import { SkillArchives } from "../../src/archives.ts";
import { ReviewLedger } from "../../src/ledger.ts";
import { isolatedSession } from "../support.ts";

const mode = process.argv[2]!, cached = mode === "cached-npm" || mode === "cached-git";
const cli = mode === "cli", temporary = mode === "temporary" || cached, packaged = mode === "package" || temporary;
const cachedSource = mode === "cached-npm" ? "npm:@hermes-fixture/cached@1.0.0" : "git:github.com/hermes-fixture/cached@main";
let rules: string[] = [], decisions = 0;
const configuration = (cwd: string) => {
  const settingsManager = SettingsManager.inMemory({ skills: cli || packaged ? [] : rules,
    packages: packaged && !temporary && rules.length ? [{ source: rules[0]!, ...(rules.length > 1 ? { skills: rules.slice(1) } : {}) }] : [] }); settingsManager.setProjectTrusted(true);
  return { agentDir: join(dirname(cwd), "agent"), settingsManager, ...(cli ? { noSkills: true, additionalSkillPaths: rules } : temporary ? { noSkills: true, additionalExtensionPaths: rules } : {}) };
};
const observed: unknown[] = [];
const f = await isolatedSession("unused", { projectRoot: cwd => cwd,
  skillSources: request => createSkillSources(configuration(request.cwd))(request),
  restorePolicy: async request => {
    decisions++; observed.push(structuredClone(request.skill));
    // No optimistic restoration: the first authorization always sees an absent destination.
    await assert.rejects(stat(request.skill.filePath), /ENOENT/);
    return createSkillRestorePolicy(configuration(request.cwd))(request);
  },
});
try {
  await mkdir(join(f.cwd, ".git")); // Bounds official ancestor discovery to this fixture.
  const sourceRoot = join(f.root, "manual/rule"), primary = join(sourceRoot, "SKILL.md");
  // Fixture layout is checked by the actual public resolver before archiving, not by the plugin locator.
  const bucket = createHash("sha256").update(mode === "cached-npm" ? "npm-" : "git-github.com-hermes-fixture/cached@main").digest("hex").slice(0, 8);
  const alias = !cached ? join(f.root, "selected") : mode === "cached-npm" ?
    join(f.agentDir, "tmp/extensions/npm", bucket, "node_modules/@hermes-fixture/cached") :
    join(f.agentDir, "tmp/extensions/git-github.com", bucket, "hermes-fixture/cached");
  const selectedSource = cached ? cachedSource : alias;
  await mkdir(sourceRoot, { recursive: true }); await mkdir(dirname(alias), { recursive: true });
  const text = "---\nname: local-rule\ndescription: Explicitly configured local procedure\n---\nOriginal bytes.\n";
  if (packaged) await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "local-package", version: "1.0.0", pi: { skills: ["."] } }));
  await writeFile(primary, text); await symlink(sourceRoot, alias); rules = [selectedSource];
  const notifications: string[] = [], ui = f.session.extensionRunner.createCommandContext().ui;
  await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, notify: text => notifications.push(text),
    editor: async (_title, value) => value, select: async () => "Allow this change once",
    confirm: async () => true, setStatus: () => {}, setWidget: () => {} } });
  const command = async (text: string) => { notifications.length = 0; await f.session.prompt(`/hermes-skills ${text}`); return JSON.parse(notifications.at(-1)!); };
  await command("refresh");
  const search = f.session.agent.state.tools.find(tool => tool.name === "hermes_skill_search")!;
  const hit = (await search.execute("find", { query: "local-rule" })).details.items[0]; assert.ok(hit);
  const archived = await command(`archive ${hit.id} Local source restore fixture`); assert.equal(archived.status, "changed", JSON.stringify(archived));
  const archives = new SkillArchives(f.agentDir, f.cwd), stored = (await archives.get(archived.archiveId)).plan.skill;
  assert.equal(stored.sourceInfo.source, packaged ? selectedSource : cli ? "cli" : "local"); assert.equal(stored.filePath, primary);
  const restored = await command(`restore ${archived.archiveId}`); assert.equal(restored.status, "changed", JSON.stringify(restored));
  assert.deepEqual(observed[0], stored, "restoration input is the real persisted archive identity, not a fabricated native Skill");
  assert.equal(await readFile(primary, "utf8"), text); assert.equal((await search.execute("same-id", { query: "local-rule" })).details.items[0].id, hit.id);
  assert.equal((await command(`inspect ${hit.id}`)).skill.owner, "user-owned");
  // Oracle while present; no probe is inserted into the real source during any later decision.
  const exclude = async (value: boolean) => {
    if (temporary) await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "local-package", version: "1.0.0", pi: { skills: value ? [".", "!SKILL.md"] : ["."] } }));
    else rules = value ? [alias, `-${join(alias, "SKILL.md")}`] : [alias];
  };
  if (!cli) {
    await exclude(true);
    const manager = new DefaultPackageManager({ cwd: f.cwd, ...configuration(f.cwd) });
    const stock = temporary ? await manager.resolveExtensionSources(rules, { temporary: true }) : await manager.resolve(async () => "skip");
    assert.equal(stock.skills.some(row => row.path === join(alias, "SKILL.md") && row.enabled), false);
    await exclude(false);
  }
  rules = [selectedSource]; const second = await command(`archive ${hit.id} Check current exclusions`); assert.equal(second.status, "changed");
  if (!cli) {
    await exclude(true);
    assert.match((await command(`restore ${second.archiveId}`)).failed, /denied/); await assert.rejects(stat(primary), /ENOENT/);
    await exclude(false);
  }
  if (mode === "cached-npm") {
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "local-package", version: "2.0.0", pi: { skills: ["."] } }));
    assert.match((await command(`restore ${second.archiveId}`)).failed, /denied/); await assert.rejects(stat(primary), /ENOENT/);
    await exclude(false);
  }
  rules = []; assert.match((await command(`restore ${second.archiveId}`)).failed, /denied/); await assert.rejects(stat(primary), /ENOENT/);
  rules = [selectedSource]; await rename(alias, alias + "-old"); const replacement = join(f.root, "replacement"); await mkdir(replacement);
  await symlink(replacement, alias);
  assert.match((await command(`restore ${second.archiveId}`)).failed, /denied/); await assert.rejects(stat(primary), /ENOENT/);
  assert.equal((await archives.get(second.archiveId)).state, "archived");
  assert.equal(f.calls.length, 0); assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, []);
  console.log(JSON.stringify({ realArchiveInput: true, cached, incompatibleVersionRejected: mode === "cached-npm", explicitUnderNoSkills: cli || temporary, decisions, roundTrip: true, exclusion: !cli, removed: true, rebound: true, modelCalls: 0 }));
} finally { f.session.dispose(); }
