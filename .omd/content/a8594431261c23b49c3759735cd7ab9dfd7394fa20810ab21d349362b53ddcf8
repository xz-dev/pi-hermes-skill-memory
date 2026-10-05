import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EnabledCatalog } from "../src/catalog.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { validateSkillSources } from "../src/sources.ts";
import { isolatedSession } from "./support.ts";

async function fixture() {
  const root = await mkdtemp("/var/tmp/hermes-source-catalog-");
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  const globalDir = join(agentDir, "skills", "release-check"), projectDir = join(cwd, ".pi", "skills", "release-check");
  const body = "---\nname: release-check\ndescription: Scoped release check\n---\nOne.\n";
  for (const d of [globalDir, projectDir]) { await mkdir(d, { recursive: true }); await writeFile(join(d, "SKILL.md"), body); }
  const global = loadSkillsFromDir({ dir: globalDir, source: "user" }).skills[0]!;
  const project = loadSkillsFromDir({ dir: projectDir, source: "project" }).skills[0]!;
  return { root, agentDir, cwd, globalDir, projectDir, global, project, body };
}

test("allowed duplicate names have separate stable IDs, scope, ownership and fresh fingerprints", async () => {
  const f = await fixture(); const catalog = new EnabledCatalog(f.agentDir);
  await catalog.capture([f.global, f.project], true, [], f.cwd);
  const first = await catalog.search("release"); assert.equal(first.items.length, 2);
  assert.deepEqual(first.items.map(i => i.scope), ["project", "global"]);
  assert.ok((await Promise.all(first.items.map(i => catalog.inspect(i.id)))).every(i => i.owner === "user-owned" && i.version.length === 64));
  assert.notEqual(first.items[0]!.id, first.items[1]!.id);
  const global = await catalog.inspect(first.items.find(i => i.scope === "global")!.id);
  await writeFile(f.global.filePath, f.body.replace("One.", "Two."));
  await catalog.capture([f.project, f.global, f.global], true, [], f.cwd);
  const second = await catalog.inspect((await catalog.search("release")).items.find(i => i.scope === "global")!.id);
  assert.equal(second.id, global.id); assert.notEqual(second.version, global.version);
  assert.ok((await catalog.view(global.id)).content.includes("Two."));
  await chmod(f.global.filePath, 0o444);
  await catalog.capture([f.global], true, [], f.cwd);
  const readOnly = await catalog.inspect((await catalog.search()).items[0]!.id);
  assert.equal(readOnly.id, global.id); assert.equal(readOnly.readOnly, true); assert.equal(readOnly.owner, "user-owned");
});

test("untrusted projects and explicit-only skills are not auto recommended; clear removes old IDs", async () => {
  const f = await fixture(); const catalog = new EnabledCatalog(f.agentDir);
  await catalog.capture([f.global, f.project], false, [], f.cwd);
  assert.equal((await catalog.search()).items.length, 1);
  assert.match((await catalog.search()).diagnostics.join(), /Untrusted/);
  await writeFile(f.global.filePath, f.body.replace("description:", "disable-model-invocation: true\ndescription:"));
  await catalog.capture([f.global], true, [], f.cwd);
  assert.equal((await catalog.search()).items.length, 0);
  await writeFile(f.global.filePath, f.body);
  await catalog.capture([f.global], true, [], f.cwd);
  const id = (await catalog.search()).items[0]!.id;
  await catalog.capture([{ ...f.global, disableModelInvocation: true }], true, [], f.cwd);
  assert.equal((await catalog.search()).items.length, 0, "host explicit-only policy cannot be cleared by frontmatter");
  assert.ok((await catalog.view(id)).content.includes("One."));
  await catalog.capture([], false, ["Excluded by noSkills"]);
  await assert.rejects(catalog.view(id), /Unknown or host-excluded/);
  assert.match((await catalog.search()).diagnostics.join(), /noSkills/);
});

test("only matching saved creation provenance promotes a discovered source to managed", async () => {
  const f = await fixture(); const store = new ManagedSkillStore(f.agentDir, f.cwd);
  const snapshot = { sessionId: "synthetic-session", leafId: null, cwd: f.cwd,
    model: undefined, thinking: undefined, messages: [], digest: "synthetic", evidence: [{ entryId: "user-1", text: "Use release checks" }] };
  const record = await store.save({ action: "create", scope: "project", name: "managed-check", description: "Managed check",
    body: "Check releases.", reason: "Reusable correction", evidence: [{ entryId: "user-1", quote: "Use release checks" }] }, snapshot, "request-1");
  const skill = loadSkillsFromDir({ dir: join(f.cwd, ".pi", "skills", "hermes-managed", "managed-check"), source: "project" }).skills[0]!;
  const catalog = new EnabledCatalog(f.agentDir); await catalog.capture([skill], true, [], f.cwd);
  const managed = await catalog.inspect((await catalog.search()).items[0]!.id);
  assert.equal(managed.id, record.id); assert.equal(managed.owner, "managed");
  await writeFile(join(f.cwd, ".pi", "hermes-skills", "manifest.json"), "[]");
  await catalog.capture([skill], true, [], f.cwd);
  assert.equal((await catalog.inspect(record.id)).owner, "user-owned");
  assert.equal((await catalog.search()).items[0]!.id, record.id, "loss of permission does not rename the entity");
  await writeFile(join(f.cwd, ".pi", "hermes-skills", "manifest.json"), JSON.stringify([{ ...record, id: "forged" }]));
  await catalog.capture([skill], true, [], f.cwd);
  assert.equal((await catalog.inspect(record.id)).owner, "user-owned");
  assert.equal((await catalog.search()).items[0]!.id, record.id);
});

test("SDK callback is authoritative before name dedup and excludes configured/noSkills sources", async () => {
  const f = await fixture(); let allowed = [f.global, f.project]; let ctx: ExtensionContext | undefined; let pi: ExtensionAPI | undefined;
  const { session } = await isolatedSession("fake", {
    skills: [f.global], skillSources: async request => ({ version: 1, cwd: request.cwd,
      projectTrusted: request.projectTrusted, skills: allowed, diagnostics: allowed.length ? [] : ["noSkills: all excluded"] }),
    observe: api => { pi = api; api.on("agent_settled", (_e, context) => { ctx = context; }); },
  });
  try {
    await session.prompt("Read metadata"); assert.ok(ctx && pi);
    const found = await session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", {});
    const result = found.details as { items: { id: string }[] }; assert.equal(result.items.length, 2);
    allowed = [];
    await session.prompt("Now skills are disabled");
    const empty = await session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", {});
    assert.equal((empty.details as { items: unknown[] }).items.length, 0);
    await assert.rejects(session.agent.state.tools.find(t => t.name === "hermes_skill_view")!.execute("fixture", { id: result.items[0]!.id }), /Unknown or host-excluded/);
  } finally { session.dispose(); }
});

test("SDK source failure clears old catalog and preserves native prompt discovery", async () => {
  const f = await fixture(); let fail = false; let ctx: ExtensionContext | undefined; let pi: ExtensionAPI | undefined;
  const { session, calls } = await isolatedSession("fake", { skills: [f.global], nativeRead: true,
    skillSources: async request => { if (fail) throw new Error("source-disconnect"); return { version: 1,
      cwd: request.cwd, projectTrusted: request.projectTrusted, skills: [f.global], diagnostics: [] }; },
    observe: api => { pi = api; api.on("agent_settled", (_e, context) => { ctx = context; }); },
  });
  try {
    await session.prompt("First"); fail = true; await session.prompt("Second"); assert.ok(ctx && pi);
    assert.ok(JSON.stringify(calls.at(-1)).includes("release-check"));
    const result = await session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", {});
    const details = result.details as { items: unknown[]; diagnostics: string[] };
    assert.equal(details.items.length, 0); assert.match(details.diagnostics.join(), /source-disconnect/);
    assert.ok(pi.getCommands().some(c => c.name === "skill:release-check" && c.source === "skill"));
    await session.prompt("/skill:release-check Explain this fixture");
    assert.ok(JSON.stringify(calls.at(-1)).includes('<skill name=\\"release-check\\"'));
    assert.ok(JSON.stringify(calls.at(-1)).includes("One."));
    fail = false;
    let restored: boolean | undefined;
    pi.on("before_agent_start", event => {
      restored = event.systemPromptOptions.skills.length === 0 && !event.systemPrompt.includes("<name>release-check</name>");
    });
    await session.prompt("Recovered");
    assert.equal(restored, true, "current prompt returns to search-first; prior history is not erased");
    assert.equal((await session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", {})).details.items.length, 1);
  } finally { session.dispose(); }
});

test("SDK snapshots reject protocol mismatch, old project and untrusted sources", async () => {
  const f = await fixture(); const request = { cwd: f.cwd, projectTrusted: true, nativeSkills: [] };
  const snapshot = { version: 1 as const, cwd: f.cwd, projectTrusted: true, skills: [f.global], diagnostics: [] };
  await validateSkillSources(snapshot, request);
  await assert.rejects(validateSkillSources({ ...snapshot, version: 2 as 1 }, request), /protocol/);
  await assert.rejects(validateSkillSources({ ...snapshot, cwd: f.agentDir }, request), /another project/);
  await assert.rejects(validateSkillSources({ ...snapshot, projectTrusted: false, skills: [f.project] }, { ...request, projectTrusted: false }), /untrusted/);
});
