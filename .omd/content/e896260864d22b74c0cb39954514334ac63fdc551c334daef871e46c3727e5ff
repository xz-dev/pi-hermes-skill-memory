import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { ReviewLedger } from "../src/ledger.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { isolatedSession } from "./support.ts";

/** Real session harness: proposal reaches hermes_skill_manage through the registered tool path. */
async function fixture(choices: { select?: (title: string, options: string[]) => string | undefined | Promise<string | undefined> } = {}) {
  let proposal!: { action: "update"; scope: "project"; name: string; description: string; body: string;
    reason: string; id?: string; baseVersion?: string; evidence: { entryId: string; quote: string }[] };
  const notices: string[] = [], selects: { title: string; options: string[] }[] = [];
  const f = await isolatedSession("fixture", { projectRoot: cwd => cwd,
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
      skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills }),
    streamReply: context => {
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(m => m.role === "toolResult");
      const managed = results.some(r => r.toolName === "hermes_skill_manage");
      if (!results.length) return { stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "s", name: "hermes_skill_search", arguments: {} }] };
      if (results.at(-1)!.toolName === "hermes_skill_search" && managed) {
        // After a redirect the agent searches managed notes, then submits the improvement as a managed note.
        return { stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "note", name: "hermes_skill_manage",
          arguments: { proposal: { action: "create", scope: "project", name: "manual-rule-note", description: "manual-rule: corrected release ordering",
            body: "Build before manifest check.", reason: proposal.reason, evidence: proposal.evidence } } }] };
      }
      const result = JSON.parse(results.at(-1)!.content.filter(p => p.type === "text").map(p => p.text).join(""));
      if (results.at(-1)!.toolName === "hermes_skill_search") { const id: string = result.items.find((item: { name: string }) => item.name === "manual-rule")!.id; proposal.id = id; return { stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "v", name: "hermes_skill_view", arguments: { id } }] }; }
      if (result.status === "redirect") return { stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "find-note", name: "hermes_skill_search", arguments: { query: "manual-rule", sourceKind: "managed" } }] };
      if (results.at(-1)!.toolName === "hermes_skill_view") { proposal.baseVersion = result.version;
        return { stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "m", name: "hermes_skill_manage", arguments: { proposal: JSON.parse(JSON.stringify(proposal)) } }] }; }
      return { stopReason: "stop" as const, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } });
  const path = join(f.cwd, ".pi/skills/manual-rule/SKILL.md"); await mkdir(dirname(path), { recursive: true });
  const before = "---\nname: manual-rule\ndescription: Release ordering\n---\n\nBuild first.\n";
  await writeFile(path, before);
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Build before manifest check", timestamp: 1 });
  proposal = { action: "update", scope: "project", name: "manual-rule", description: "Release ordering", body: "Build before manifest check",
    reason: "Explicit user correction", evidence: [{ entryId, quote: "Build before manifest check" }] };
  const ui = f.session.extensionRunner.createCommandContext().ui;
  await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui,
    editor: async (_t: string, text?: string) => text,
    select: async (title: string, options: string[]) => { selects.push({ title, options }); return choices.select?.(title, options); },
    confirm: async () => true, notify: (text: string) => notices.push(text), setStatus: () => {}, setWidget: () => {} } });
  const command = async (text: string) => { notices.length = 0; await f.session.prompt(`/hermes-skills ${text}`); return JSON.parse(notices.at(-1)!); };
  return { ...f, path, before, proposal, selects, notices, command, permissions: new InstalledPermissions(f.agentDir),
    store: new ManagedSkillStore(f.agentDir, f.cwd) };
}

test("notes-only policy redirects the installed update to the managed-note flow without touching the original", async () => {
  const f = await fixture();
  try {
    await f.permissions.setPolicy("notes-only");
    await f.session.prompt("Apply the release correction, then save a managed note");
    assert.equal(await readFile(f.path, "utf8"), f.before, "notes-only never writes the installed original");
    assert.equal(f.selects.length, 0, "policy redirect does not prompt");
    // The follow-up managed note is a normal managed save in the same turn.
    const saved = await f.store.catalog();
    const note = saved.find(row => row.name === "manual-rule-note");
    assert.ok(note, "redirected improvement is saved as a managed note");
    assert.equal(note!.contentProof?.kind, "agent-notes");
    assert.equal(await f.store.ownership(f.path, "project"), undefined, "no ownership transfer");
    assert.deepEqual((await new ReviewLedger(f.agentDir).inspect()).records, [], "transcription uses no auxiliary request");
  } finally { f.session.dispose(); }
});

test("fourth choice redirects once without mutating global policy; the note keeps the original name searchable", async () => {
  const f = await fixture({ select: (_t, o) => o.includes("Keep original; save as Hermes note") ? "Keep original; save as Hermes note" : undefined });
  try {
    await f.session.prompt("Apply the release correction, then save a managed note");
    assert.equal(await readFile(f.path, "utf8"), f.before);
    assert.equal((await f.permissions.read()).policy, "ask", "the fourth choice must not mutate the global policy");
    assert.equal((await f.permissions.read()).allowlist.length, 0);
    const note = (await f.store.catalog()).find(row => row.name === "manual-rule-note")!;
    assert.ok(note);
    const hits = await f.store.search("manual-rule");
    assert.ok(hits.some(hit => hit.id === note.id), "note discoverable by the original skill name");
  } finally { f.session.dispose(); }
});

test("always allow persists the exact identity and skips the prompt next time; revoke restores ask", async () => {
  const f = await fixture({ select: () => "Always allow changes to this skill" });
  try {
    await f.session.prompt("Apply the release correction");
    assert.match(await readFile(f.path, "utf8"), /Build before manifest check/);
    assert.deepEqual((await f.permissions.read()).allowlist, [f.proposal.id]);
    // Next proposal under allowlist needs no prompt.
    await f.session.prompt("Apply the release correction again");
    assert.equal(f.selects.length, 1, "allowlist hit does not prompt again");
    await f.permissions.removeAllowlist(f.proposal.id!);
    await f.session.prompt("Apply the release correction once more");
    assert.equal(f.selects.length, 2, "removal restores the global ask policy");
  } finally { f.session.dispose(); }
});

test("reject leaves the original untouched, grants nothing and records no pending row", async () => {
  const f = await fixture({ select: () => "Do not modify this time" });
  try {
    await f.session.prompt("Apply the release correction");
    assert.equal(await readFile(f.path, "utf8"), f.before);
    assert.equal((await f.permissions.status()).pending.length, 0);
    assert.equal((await f.permissions.read()).policy, "ask");
    assert.deepEqual(await f.store.catalog(), []);
  } finally { f.session.dispose(); }
});

test("cancelled decision grants nothing and does not persist a denial", async () => {
  const f = await fixture({ select: () => undefined });
  try {
    await f.session.prompt("Apply the release correction");
    assert.equal(await readFile(f.path, "utf8"), f.before);
    assert.equal((await f.permissions.read()).allowlist.length, 0);
    assert.equal((await f.permissions.status()).pending.length, 0);
  } finally { f.session.dispose(); }
});

test("notes-only blocks installed archive with an explicit non-completion result", async () => {
  const f = await fixture();
  try {
    await f.permissions.setPolicy("notes-only");
    await f.session.prompt("Find the release rule");
    const result = await f.command(`archive ${f.proposal.id} Relocate this installed skill`);
    assert.notEqual(result.status, "changed");
    assert.match(result.failed ?? JSON.stringify(result), /notes-only/);
    assert.equal(await readFile(f.path, "utf8"), f.before);
  } finally { f.session.dispose(); }
});

test("one-time approval cannot bypass a policy that changed to notes-only before commit", async () => {
  let permissions!: InstalledPermissions;
  const f = await fixture({ select: async () => { await permissions.setPolicy("notes-only"); return "Allow this change once"; } });
  permissions = f.permissions;
  try {
    await f.session.prompt("Apply the release correction");
    assert.equal(await readFile(f.path, "utf8"), f.before);
    assert.notEqual(JSON.parse(f.session.getLastAssistantText()!).status, "saved");
    assert.deepEqual((await f.permissions.read()).allowlist, []);
  } finally { f.session.dispose(); }
});
