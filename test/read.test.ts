import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir, loadSkills } from "@earendil-works/pi-coding-agent";
import { EnabledCatalog, READ_MAX_CHARS } from "../src/catalog.ts";

async function fixture() {
  const root = await mkdtemp("/var/tmp/hermes-paged-read-"); const dir = join(root, "read-check"); await mkdir(dir);
  const text = "---\nname: read-check\ndescription: Safe reader fixture\n---\nSelected body.\n";
  await writeFile(join(dir, "SKILL.md"), text);
  const loaded = loadSkillsFromDir({ dir, source: "user" }); const catalog = new EnabledCatalog(); await catalog.capture(loaded.skills, true);
  const id = (await catalog.search()).items[0]!.id; return { root, dir, text, catalog, id };
}

test("read selects one body/reference/script without recursion or execution and rejects escapes", async () => {
  const f = await fixture(); await mkdir(join(f.dir, "references")); await mkdir(join(f.dir, "scripts"));
  await writeFile(join(f.dir, "references/check.md"), "Only this selected reference.");
  await writeFile(join(f.dir, "references/private.md"), "UNSELECTED_REFERENCE_MARKER");
  const marker = join(f.root, "script-ran");
  const script = `#!/bin/sh\nprintf ran > '${marker}'\n`;
  await writeFile(join(f.dir, "scripts/check.sh"), script);
  const body = await f.catalog.view(f.id); assert.equal(body.content, f.text);
  assert.ok(!JSON.stringify(body).includes("UNSELECTED_REFERENCE_MARKER"));
  assert.equal((await f.catalog.view(f.id, "references/check.md")).content, "Only this selected reference.");
  assert.equal((await f.catalog.view(f.id, "scripts/check.sh")).content, script);
  await assert.rejects(readFile(marker), /ENOENT/);
  await writeFile(join(f.root, "outside.md"), "OUTSIDE_CONTENT_MARKER");
  await symlink(join(f.root, "outside.md"), join(f.dir, "references/escaped.md"));
  for (const path of ["../outside.md", "references/../SKILL.md", join(f.root, "outside.md"), "C:\\private\\secret", "\\\\server\\secret"]) {
    await assert.rejects(f.catalog.view(f.id, path), /relative without traversal/);
  }
  await assert.rejects(f.catalog.view(f.id, "references/escaped.md"), /escapes skill root/);
  await assert.rejects(f.catalog.view(f.id, "references"), /selected file/);
  await assert.rejects(f.catalog.view(f.id, undefined, -1), /offset/);
});

test("Unicode/escaped long body and reference pages have full JSON budget and exact scalar cursors", async () => {
  const f = await fixture(); const long = '😀\\"\n'.repeat(9000);
  await writeFile(join(f.dir, "SKILL.md"), f.text + long);
  await writeFile(join(f.dir, "large.txt"), long);
  for (const file of [undefined, "large.txt"]) {
    let offset = 0, all = "", pages = 0; const versions = new Set<string>();
    while (true) {
      const page = await f.catalog.view(f.id, file, offset);
      assert.ok(JSON.stringify(page).length <= READ_MAX_CHARS);
      assert.ok(!page.content.includes("\ufffd")); all += page.content; versions.add(page.version);
      if (page.nextOffset === null) break;
      assert.equal(page.nextOffset, offset + Array.from(page.content).length);
      assert.ok(page.nextOffset > offset); offset = page.nextOffset; assert.ok(++pages < 20);
    }
    assert.equal(all, file ? long : f.text + long); assert.equal(versions.size, 1);
    const beyond = await f.catalog.view(f.id, file, Array.from(all).length + 10);
    assert.equal(beyond.content, ""); assert.equal(beyond.nextOffset, null);
  }
  const before = await f.catalog.view(f.id);
  await writeFile(join(f.dir, "SKILL.md"), f.text + "New content.");
  const after = await f.catalog.view(f.id); assert.notEqual(after.version, before.version);
  await writeFile(join(f.dir, "SKILL.md"), "---\nname: read-check\n---\nMissing description.");
  await assert.rejects(f.catalog.view(f.id), /Invalid skill frontmatter/);
  assert.match((await f.catalog.search()).diagnostics.join(), /Invalid skill frontmatter/);
});

test("default read follows selected loose markdown, not a different SKILL.md; logical source rebind fails", async () => {
  const root = await mkdtemp("/var/tmp/hermes-source-rebind-"); const a = join(root, "a"), b = join(root, "b");
  await mkdir(a); await mkdir(b);
  const text = "---\nname: loose-check\ndescription: Selected loose markdown\n---\nLOOSE_BODY\n";
  await writeFile(join(a, "procedure.md"), text);
  await writeFile(join(a, "SKILL.md"), text.replace("LOOSE_BODY", "WRONG_DEFAULT"));
  const loaded = loadSkills({ cwd: root, agentDir: root, skillPaths: [join(a, "procedure.md")], includeDefaults: false });
  const catalog = new EnabledCatalog(); await catalog.capture(loaded.skills, true);
  const id = (await catalog.search()).items[0]!.id; assert.equal((await catalog.view(id)).content, text);
  await writeFile(join(b, "SKILL.md"), text.replace("LOOSE_BODY", "OTHER_ROOT"));
  const alias = join(root, "alias"); await symlink(a, alias);
  const linked = loadSkillsFromDir({ dir: alias, source: "user" }); await catalog.capture(linked.skills, true);
  const linkedId = (await catalog.search()).items[0]!.id;
  await unlink(alias); await symlink(b, alias);
  await assert.rejects(catalog.view(linkedId), /Source moved or escaped root/);
});
