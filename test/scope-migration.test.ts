import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { resolveProjectRoot, selectProjectRoot } from "../src/scope.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { isolatedSession } from "./support.ts";

const snapshot = (cwd: string) => ({ cwd, sessionId: "fixture", leafId: null, model: undefined, thinking: undefined, messages: [],
  evidence: [{ entryId: "project-correction", text: "Build before manifest check" }], digest: "fixture" });
const proposal = { action: "create" as const, scope: "project" as const, name: "release-check", description: "Release ordering",
  body: "Build before manifest check", reason: "This project's release correction",
  evidence: [{ entryId: "project-correction", quote: "Build before manifest check" }],
  files: [{ file: "references/check.md", content: "The project release requires a built manifest." }] };

test("non-Git write roots require an explicit choice; hasUI without TUI never invents one", async () => {
  const f = await isolatedSession();
  try {
    const nested = join(f.cwd, "src"); await mkdir(nested);
    const context = { cwd: nested, isProjectTrusted: () => true };
    await assert.rejects(resolveProjectRoot(context));
    assert.equal(await resolveProjectRoot(context, f.cwd), f.cwd);
    await assert.rejects(resolveProjectRoot(context, f.agentDir), /does not contain/);
    await assert.rejects(resolveProjectRoot({ ...context, isProjectTrusted: () => false }, f.cwd), /not trusted/);
    const command = f.session.extensionRunner.createCommandContext(); let prompts = 0;
    const ui = { ...command.ui, input: async () => { prompts++; return f.cwd; } };
    assert.equal(await selectProjectRoot({ ...command, ...context, mode: "tui", ui }), f.cwd);
    assert.equal(prompts, 1);
    await assert.rejects(selectProjectRoot({ ...command, ...context, mode: "rpc", hasUI: true, ui }));
    assert.equal(prompts, 1); assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("two temporary worktrees have distinct roots/identities and never share project corrections through a remote", async () => {
  const f = await isolatedSession();
  try {
    const clone = join(f.root, "local-clone"), a = join(f.root, "worktree-a"), b = join(f.root, "worktree-b");
    const env = { ...process.env, HOME: f.root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
    const git = (args: string[]) => promisify(execFile)("git", args, { env });
    // Fixture worktrees use existing local objects: no commit, branch creation, network, or writes to the real repo.
    await git(["clone", "--no-hardlinks", "--no-checkout", fileURLToPath(new URL("../", import.meta.url)), clone]);
    await git(["-C", clone, "worktree", "add", "--detach", a, "HEAD"]);
    await git(["-C", clone, "worktree", "add", "--detach", b, "HEAD"]);
    const nested = join(a, "src-fixture"); await mkdir(nested);
    const rootA = await resolveProjectRoot({ cwd: nested, isProjectTrusted: () => true });
    const rootB = await resolveProjectRoot({ cwd: b, isProjectTrusted: () => true });
    assert.equal(rootA, a); assert.equal(rootB, b);
    const sa = new ManagedSkillStore(f.agentDir, rootA), sb = new ManagedSkillStore(f.agentDir, rootB);
    const first = await sa.save(proposal, snapshot(nested), "a-correction");
    assert.equal((await sb.catalog()).length, 0);
    const second = await sb.save({ ...proposal, body: "Build before manifest check in worktree B" }, snapshot(b), "b-correction");
    assert.notEqual(first.id, second.id);
    assert.equal((await sa.catalog()).length, 1); assert.equal((await sb.catalog()).length, 1);
    await assert.rejects(access(join(f.agentDir, "skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("explicit scope migration preserves source bytes and assets, records scope change, and refuses target names/changed previews", async () => {
  const f = await isolatedSession();
  try {
    const store = new ManagedSkillStore(f.agentDir, f.cwd);
    const created = await store.save(proposal, snapshot(f.cwd), "source");
    const old = await readFile(created.path, "utf8");
    const preview = await store.previewMigration(created.id, "global", "The user selected this release rule for all their npm projects");
    assert.equal(preview.targetConflict, false); assert.equal(preview.sourceRetained, true);
    const result = await store.migrate(preview, snapshot(f.cwd), "migration");
    assert.equal(result.target.scope, "global"); assert.notEqual(result.target.id, created.id);
    assert.equal(await readFile(created.path, "utf8"), old);
    assert.equal(await readFile(result.target.path, "utf8"), old);
    assert.equal(await readFile(join(f.agentDir, "skills/hermes-managed/release-check/references/check.md"), "utf8"), proposal.files[0]!.content);
    const receipt = JSON.parse(await readFile(result.receipt, "utf8"));
    assert.equal(receipt.status, "copied"); assert.equal(receipt.sourceContent, old); assert.equal(receipt.source.version, created.version);
    const duplicate = await store.previewMigration(created.id, "global", "Explicit second migration");
    assert.equal(duplicate.targetConflict, true);
    await assert.rejects(store.migrate(duplicate, snapshot(f.cwd), "duplicate"), /target conflict/);
    await writeFile(created.path, old + "Manual change\n");
    await assert.rejects(store.migrate(preview, snapshot(f.cwd), "stale"), /version conflict/);
    assert.equal(await readFile(result.target.path, "utf8"), old); assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});

test("registered migration command shows scope/versions, refuses TUI denial and refreshes the copied global skill without a model", async () => {
  let agentDir = "";
  const f = await isolatedSession("no model", { skillSources: async request => ({ version: 1, cwd: request.cwd,
    projectTrusted: request.projectTrusted, diagnostics: [], skills: [
      ...loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills,
      ...loadSkillsFromDir({ dir: join(agentDir, "skills"), source: "user" }).skills,
    ] }) }); agentDir = f.agentDir;
  try {
    const source = await new ManagedSkillStore(f.agentDir, f.cwd).save(proposal, snapshot(f.cwd), "command-source");
    const messages: unknown[] = []; let permit = false;
    const ui = f.session.extensionRunner.createCommandContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd,
      confirm: async (_title, text) => { const p = JSON.parse(text!); assert.equal(p.source.scope, "project"); assert.equal(p.targetScope, "global"); return permit; },
      notify: text => messages.push(JSON.parse(text)) } });
    await f.session.prompt(`/hermes-skills migrate ${source.id} global Applies to npm projects`);
    await assert.rejects(access(join(f.agentDir, "skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
    permit = true;
    await f.session.prompt(`/hermes-skills migrate ${source.id} global Applies to npm projects`);
    assert.ok(JSON.stringify(messages).includes('"sourceRetained":true'));
    const records = await new ManagedSkillStore(f.agentDir, f.cwd).catalog(); assert.equal(records.length, 2);
    await f.session.prompt(`/hermes-skills load ${records.find(r => r.scope === "global")!.id}`);
    assert.ok(JSON.stringify(messages).includes('"loaded"')); assert.equal(f.calls.length, 0);
    assert.equal((await readdir(join(f.agentDir, "hermes-skills/provenance/migrations"))).length, 1);
  } finally { f.session.dispose(); }
});

test("SDK explicit ancestor root is the discovery/write identity and existing installed target names are not shadowed", async () => {
  let agentDir = "";
  const f = await isolatedSession("no model", { projectRoot: cwd => dirname(cwd), skillSources: async request => ({
    version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [], skills: [
      ...loadSkillsFromDir({ dir: join(dirname(request.cwd), ".pi/skills"), source: "project" }).skills,
      ...loadSkillsFromDir({ dir: join(agentDir, "skills"), source: "user" }).skills,
    ],
  }) }); agentDir = f.agentDir;
  try {
    const source = await new ManagedSkillStore(f.agentDir, f.root).save(proposal, snapshot(f.cwd), "ancestor-source");
    const user = join(f.agentDir, "skills/user-release"); await mkdir(user, { recursive: true });
    const userPath = join(user, "SKILL.md"), content = "---\nname: release-check\ndescription: Existing global user rule\n---\n\nKeep user's release rule\n";
    await writeFile(userPath, content);
    const messages: unknown[] = [];
    const ui = f.session.extensionRunner.createCommandContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, notify: text => messages.push(JSON.parse(text)) } });
    await f.session.prompt(`/hermes-skills load ${source.id}`);
    assert.ok(JSON.stringify(messages).includes(source.id), "configured ancestor, not cwd, must identify the managed source");
    await f.session.prompt(`/hermes-skills migrate ${source.id} global User asks to share across projects`);
    assert.ok(JSON.stringify(messages).includes("target conflict"));
    assert.equal(await readFile(userPath, "utf8"), content);
    await assert.rejects(access(join(f.agentDir, "skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
    assert.equal(f.calls.length, 0);
  } finally { f.session.dispose(); }
});
