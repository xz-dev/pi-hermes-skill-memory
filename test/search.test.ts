import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { EnabledCatalog, SEARCH_MAX_CHARS, SEARCH_MAX_ITEMS } from "../src/catalog.ts";
import { isolatedSession } from "./support.ts";

function bounded(result: Awaited<ReturnType<EnabledCatalog["search"]>>) {
  assert.ok(JSON.stringify(result).length <= SEARCH_MAX_CHARS);
  assert.ok(result.items.length <= SEARCH_MAX_ITEMS);
  for (const item of result.items) assert.deepEqual(Object.keys(item).sort(), ["description", "filePath", "id", "name", "scope", "source"]);
}

test("3000 allowed skills use bounded metadata pages/categories and constant initial guidance", async () => {
  const root = await mkdtemp("/var/tmp/hermes-large-catalog-");
  for (let start = 0; start < 3000; start += 64) {
    await Promise.all(Array.from({ length: Math.min(64, 3000 - start) }, async (_v, n) => {
      const index = start + n, dir = join(root, `guide-${index}`); await mkdir(dir);
      await writeFile(join(dir, "SKILL.md"), `---\nname: guide-${index}\ndescription: Fixture procedure ${index}\n---\nBODY_NEVER_INITIAL_${index}.\n`);
    }));
  }
  const skills = loadSkillsFromDir({ dir: root, source: "user" }).skills;
  assert.equal(skills.length, 3000);
  for (let i = 0; i < skills.length; i++) if (i % 2) skills[i]!.sourceInfo.origin = "package";
  const catalog = new EnabledCatalog(); await catalog.capture(skills, true);
  const first = await catalog.search(); bounded(first); assert.equal(first.total, 3000); assert.ok(first.nextOffset);
  const second = await catalog.search("", first.nextOffset); bounded(second);
  assert.ok(second.items.every(i => !first.items.some(f => f.id === i.id)));
  const last = await catalog.search("", 2990); bounded(last); assert.equal(last.nextOffset, null);
  const category = await catalog.search("", 0, { scope: "global", sourceKind: "package" }); bounded(category); assert.equal(category.total, 1500);
  const missing = await catalog.search("nothing-matches-this-marker"); bounded(missing); assert.equal(missing.total, 0);
  assert.match(missing.diagnostics.join(), /No eligible skill matches/);
  const over = await catalog.search("", 3001); bounded(over); assert.equal(over.nextOffset, null); assert.match(over.diagnostics.join(), /offset/);
  assert.ok(!JSON.stringify(first).includes("BODY_NEVER_INITIAL"));
  await assert.rejects(catalog.search("", -1), /offset/);

  const large = await isolatedSession("fake", { skills });
  const small = await isolatedSession("fake", { skills: skills.slice(0, 1) });
  try {
    assert.equal(large.calls.length, 0); assert.equal(small.calls.length, 0);
    await large.session.prompt("Ordinary task"); await small.session.prompt("Ordinary task");
    const system = (calls: typeof large.calls) => JSON.stringify(calls[0]!.messages.filter(m => m.role === "system"));
    assert.ok(Math.abs(system(large.calls).length - system(small.calls).length) < 100);
    assert.ok(!system(large.calls).includes("guide-2999")); assert.ok(!system(large.calls).includes("BODY_NEVER_INITIAL"));
    const before = large.calls.length;
    const result = await large.session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", { scope: "global", sourceKind: "package" });
    assert.equal(large.calls.length, before, "search itself never calls a model");
    bounded(result.details);
  } finally { large.session.dispose(); small.session.dispose(); }
});

test("full serialized budget includes diagnostics and long escaped metadata; pagination advances", async () => {
  const root = await mkdtemp("/var/tmp/hermes-search-budget-");
  const skills = [];
  for (let i = 0; i < 18; i++) {
    const dir = join(root, `large-${i}`); await mkdir(dir);
    await writeFile(join(dir, "SKILL.md"), `---\nname: large-${i}\ndescription: ${JSON.stringify('\\"'.repeat(700))}\n---\nNo body in search.\n`);
    const skill = loadSkillsFromDir({ dir, source: "user" }).skills[0]!;
    // Source labels come from host code; do not let a pathological row stall every page.
    skill.sourceInfo.source = i < 2 ? "x".repeat(10000) : "local";
    skills.push(skill);
  }
  const catalog = new EnabledCatalog(); await catalog.capture(skills, true, ["diagnostic".repeat(1000)]);
  let offset = 0; const found = new Set<string>(); let pages = 0;
  while (true) {
    const result = await catalog.search("", offset); bounded(result);
    for (const item of result.items) { assert.ok(!found.has(item.id)); found.add(item.id); }
    if (result.nextOffset === null) break;
    assert.ok(result.nextOffset > offset); offset = result.nextOffset; assert.ok(++pages < 30);
  }
  assert.equal(found.size, 16);
});
