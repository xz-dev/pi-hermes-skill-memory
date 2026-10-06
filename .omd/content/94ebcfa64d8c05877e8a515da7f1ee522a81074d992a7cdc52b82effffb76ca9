import assert from "node:assert/strict";
import { test } from "node:test";
import { access, readFile, symlink, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { captureSnapshot } from "../src/context.ts";
import { assessContent } from "../src/content.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { contentHash, ManagedSkillStore } from "../src/store.ts";
import { ReviewLedger } from "../src/ledger.ts";
import { reviewSkills } from "../src/review.ts";
import { isolatedSession } from "./support.ts";
import type { SkillProposal } from "../src/store.ts";

async function fixture(user: string, body: string) {
  const f = await isolatedSession("fake", { projectRoot: cwd => cwd,
    skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
      skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills }) });
  const entryId = f.session.sessionManager.appendMessage({ role: "user", content: user, timestamp: 1 });
  const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.runtime.getModel("hermes-test", "fake"), getSystemPrompt: () => "Fixture" });
  const proposal: SkillProposal = { action: "create", scope: "project", name: "release-check", description: "Release process", body,
    reason: "Reusable correction", evidence: [{ entryId, quote: user }] };
  const store = new ManagedSkillStore(f.agentDir, f.cwd), ledger = new ReviewLedger(f.agentDir);
  let calls = 0;
  const registry = { streamSimple: () => {
    calls++;
    const message: AssistantMessage = { role: "assistant", model: snapshot.model!.id, provider: snapshot.model!.provider, api: snapshot.model!.api,
      timestamp: 2, stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ skills: [proposal] }) }],
      usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream(); stream.end(message); return stream;
  } };
  return { ...f, snapshot, proposal, store, ledger, registry, count: () => calls };
}

test("an explicitly requested procedure template renders host instructions from bound user evidence", async () => {
  const f = await fixture("For this repo, build before checking the release manifest.", "Build first; check release manifest second.");
  try {
    const proposal = { ...f.proposal, procedureTemplate: "build-before-manifest" as const };
    const record = await reviewSkills({ ...f, registry: { streamSimple: () => {
      const stream = createAssistantMessageEventStream();
      void f.registry.streamSimple().result().then(message => {
        stream.end({ ...message, content: [{ type: "text", text: JSON.stringify({ skills: [proposal] }) }] });
      }); return stream;
    } } });
    assert.equal(record.status, "saved"); assert.equal(f.count(), 1);
    const skill = (await f.store.search("release"))[0]!;
    const read = await f.store.view(skill.id);
    assert.equal(read.record.contentProof?.kind, "procedure-template");
    assert.match(read.content, /Build this repo first/); assert.match(read.content, /release manifest against the built output/);
    assert.ok(!read.content.includes(f.proposal.body)); assert.ok(!/passed|succeeded|successfully/.test(read.content));
    assert.equal(read.record.contentProof?.sources[0]?.role, "user"); assert.equal((await f.ledger.inspect()).records.length, 1);
  } finally { f.session.dispose(); }
});

test("ordinary agent-notes keep name, description and body verbatim; coincidental wording is not opt-in", async () => {
  // Finding regressions: implicit source-report/template selection and description sanitization must not fire.
  const f = await fixture("Review code and CI together.", "Do not infer merge readiness solely from CI.");
  try {
    const note = { ...f.proposal, name: "ci-review-notes", description: "github-pr-workflow: a passed CI job is not enough to merge" };
    const first = assessContent(note, f.snapshot);
    assert.equal(first.proof?.kind, "agent-notes");
    assert.equal(first.proposal.description, "github-pr-workflow: a passed CI job is not enough to merge");
    assert.equal(first.proposal.body, "Do not infer merge readiness solely from CI.");

    const verbatim = assessContent({ ...f.proposal, name: "ci-review-notes", description: "github-pr-workflow review cautions",
      body: "Review code and CI together." }, f.snapshot);
    assert.equal(verbatim.proof?.kind, "agent-notes"); assert.equal(verbatim.proposal.body, "Review code and CI together.");

    const release = await fixture("For this repo, build before checking the release manifest.", "Build first; check release manifest second.");
    try {
      const paraphrase = assessContent({ ...release.proposal, name: "ci-review-notes", description: "github-pr-workflow release checks" }, release.snapshot);
      assert.equal(paraphrase.proof?.kind, "agent-notes");
      assert.equal(paraphrase.proposal.description, "github-pr-workflow release checks");
      assert.equal(paraphrase.proposal.body, "Build first; check release manifest second.");
      assert.ok(!paraphrase.proof?.template);
    } finally { release.session.dispose(); }

    // The preserved metadata is actually discoverable by the public name/description search.
    const noteEvidence = [{ entryId: f.proposal.evidence[0]!.entryId, quote: "Review code and CI together." }];
    const saved = await f.store.submitModel({ ...note, evidence: noteEvidence }, f.snapshot, "counterexample-save");
    assert.equal(saved.contentProof?.kind, "agent-notes");
    const hits = await f.store.search("github-pr-workflow");
    assert.equal(hits.length, 1); assert.equal(hits[0]!.id, saved.id);
    const read = await f.store.view(saved.id);
    assert.match(read.content, /Do not infer merge readiness/); assert.match(read.content, /github-pr-workflow/);
    const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "Correction: CI plus required review decide merge readiness.", timestamp: 2 });
    const current = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture" });
    const updated = await f.store.submitModel({ action: "update", id: saved.id, scope: "project", name: "ci-review-notes",
      description: "github-pr-workflow: a passed CI job is not enough to merge", body: "CI plus required review decide merge readiness.",
      reason: "New evidence corrects the old conclusion", baseVersion: saved.version,
      evidence: [{ entryId, quote: "CI plus required review" }] },
      { ...current, skillReads: [{ id: saved.id, file: "SKILL.md", version: saved.version }] }, "counterexample-update");
    assert.equal(updated.id, saved.id); assert.equal(updated.contentProof?.kind, "agent-notes");
    assert.match((await f.store.view(saved.id)).content, /required review/);
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0);
  } finally { f.session.dispose(); }
});

test("a request to run tests now saves as agent-notes; approval is no certification and ledger charge stays", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const record = await reviewSkills(f); assert.equal(record.status, "saved"); assert.equal(f.count(), 1);
    assert.equal(record.usage?.totalTokens, 110); assert.equal((await f.ledger.inspect()).records.length, 1);
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0);
    const path = join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md");
    assert.match(await readFile(path, "utf8"), /All tests passed/);
    const saved = (await f.store.catalog())[0]!; assert.equal(saved.contentProof?.kind, "agent-notes");
    assert.equal(saved.description, "Release process", "ordinary notes keep their authored description verbatim");
    assert.equal(saved.contentProof?.sources[0]?.role, "user");
  } finally { f.session.dispose(); }
});

test("a legacy pending row for an unverified body still approves locally as user-approved, not certified", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    // Enqueue exactly like the pre-agent-notes writer did: validated preview + content review flag.
    const preview = await f.store.previewManaged(f.proposal, f.snapshot);
    const permissions = new InstalledPermissions(f.agentDir);
    const id = await permissions.enqueue({ ...preview, contentReview: true }, f.snapshot, "legacy-row", () => true);
    const rows = (await permissions.status()).pending; assert.equal(rows.length, 1); assert.equal(rows[0]!.contentReview, true);
    const path = join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md"); await assert.rejects(access(path), /ENOENT/);
    const ui = f.session.extensionRunner.createCommandContext().ui; let seen = "", confirms = 0;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, editor: async (_title, text) => { seen = text ?? ""; return text; },
      confirm: async () => { confirms++; return true; }, notify: () => {}, setStatus: () => {}, setWidget: () => {} } });
    await f.session.prompt(`/hermes-skills approve ${id}`);
    assert.ok(seen.includes("All tests passed.")); assert.equal(confirms, 1);
    assert.match(await readFile(path, "utf8"), /All tests passed/);
    const saved = (await f.store.catalog())[0]!; assert.equal(saved.contentProof?.kind, "user-approved");
    assert.notEqual(saved.contentProof?.kind, "procedure-template"); assert.equal(f.count(), 0);
    assert.equal((await permissions.status()).pending.length, 0);
  } finally { f.session.dispose(); }
});

test("negated or quoted instructions and unrecognized assertions cannot authorize a procedure template", async () => {
  const f = await fixture("For this repo, build before checking the release manifest.", "Build first; check release manifest second.");
  try {
    for (const text of ["Do not build before checking the release manifest.", "Never build before checking the release manifest.",
      "The bad example says build before checking the release manifest.", "不要在 build before checking the release manifest 时保存规则"]) {
      const entryId = f.session.sessionManager.appendMessage({ role: "user", content: text, timestamp: 1 });
      const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture" });
      const result = assessContent({ ...f.proposal, procedureTemplate: "build-before-manifest", evidence: [{ entryId, quote: "build before checking the release manifest" }] }, snapshot);
      assert.equal(result.proof?.kind, "agent-notes", text); assert.ok(!result.proof?.template);
    }
    for (const body of ["Build before manifest check. 测试全绿", "Build before manifest check 123", "Never build before manifest check"])
      assert.equal(assessContent({ ...f.proposal, body }, f.snapshot).proof?.kind, "agent-notes", body);    // The template is reachable only via explicit opt-in with bound user evidence.
    const bound = await fixture("For this repo, build before checking the release manifest.", "Template");
    try {
      assert.equal(assessContent({ ...bound.proposal, procedureTemplate: "build-before-manifest" }, bound.snapshot).proof?.kind, "procedure-template");
    } finally { bound.session.dispose(); }
    const generated = assessContent({ ...f.proposal, description: "All tests passed", procedureTemplate: "build-before-manifest" }, f.snapshot);
    assert.equal(generated.proof?.kind, "procedure-template"); assert.ok(!generated.proposal.description.includes("passed"));
  } finally { f.session.dispose(); }
});

test("managed pending preview refuses root/member escape without exposing outside bytes", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const outside = join(f.root, "outside"); await mkdir(outside); await writeFile(join(outside, "SKILL.md"), "PRIVATE OUTSIDE");
    await mkdir(join(f.cwd, ".pi/skills"), { recursive: true });
    await symlink(outside, join(f.cwd, ".pi/skills/hermes-managed"));
    await assert.rejects(f.store.previewManaged(f.proposal, f.snapshot), /escapes/);
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0); assert.equal(f.count(), 0);
  } finally { f.session.dispose(); }
});
test("a legacy pending update row still rejects later edits locally and preserves its original charge", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const saved = await f.store.save({ ...f.proposal, body: "Existing rule" }, f.snapshot, "setup-managed");
    Object.assign(f.proposal, { action: "update", id: saved.id, baseVersion: saved.version });
    f.snapshot.skillReads = [{ id: saved.id, file: "SKILL.md", version: saved.version }];
    const preview = await f.store.previewManaged(f.proposal, f.snapshot);
    const permissions = new InstalledPermissions(f.agentDir), row = { id: await permissions.enqueue({ ...preview, contentReview: true }, f.snapshot, "legacy-update", () => true) };
    const accounting = JSON.stringify((await f.ledger.inspect()).records);
    await writeFile(saved.path, "Manual version after pending\n");
    const ui = f.session.extensionRunner.createCommandContext().ui; let dialogs = 0;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, editor: async (_title, text) => { dialogs++; return text; },
      confirm: async () => { dialogs++; return true; }, notify: () => {}, setStatus: () => {}, setWidget: () => {} } });
    await f.session.prompt(`/hermes-skills approve ${row.id}`);
    assert.equal(dialogs, 0); assert.equal(await readFile(saved.path, "utf8"), "Manual version after pending\n");
    assert.equal(JSON.stringify((await f.ledger.inspect()).records), accounting);
    assert.equal((await permissions.status()).pending.length, 1);
  } finally { f.session.dispose(); }
});

test("mixed classified members now save together as agent-notes with a single metered request", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => {
      const stream = createAssistantMessageEventStream();
      void f.registry.streamSimple().result().then(message => {
        const proposals = [f.proposal, { ...f.proposal, name: "testing-notes" }];
        stream.end({ ...message, content: [{ type: "text", text: JSON.stringify({ skills: proposals }) }] });
      }); return stream;
    } } });
    assert.equal(result.status, "saved"); assert.equal(f.count(), 1); assert.equal(result.usage?.totalTokens, 110);
    const catalog = await f.store.catalog(); assert.equal(catalog.length, 2);
    assert.ok(catalog.every(row => row.contentProof?.kind === "agent-notes"));
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0);
    assert.equal((await f.ledger.inspect()).records.length, 1);
  } finally { f.session.dispose(); }
});

test("source reports retain attribution and do not certify results; unknown business assertions stay pending", async () => {
  const f = await fixture("A user reports that tests passed, but no tool execution evidence is present.", "User report");
  try {
    const report = assessContent({ ...f.proposal, contentKind: "source-report" }, f.snapshot);
    assert.equal(report.proof?.kind, "source-report"); assert.match(report.proposal.body, /not independently certified/);
    assert.ok(report.proposal.body.includes(f.proposal.evidence[0]!.entryId)); assert.match(report.proposal.body, /\(user\)/);
    // Free synthesis outside the old template now saves as ordinary agent-notes, not fact certification.
    const unknown = assessContent({ ...f.proposal, body: "Use the production server 1.2.3.4; all tests passed." }, f.snapshot);
    assert.equal(unknown.proof?.kind, "agent-notes");
  } finally { f.session.dispose(); }
});

test("evidenced Chinese troubleshooting note with bounded support files saves as agent-notes without a fixed template", async () => {
  const f = await fixture("构建失败是因为 peerDependencies 版本过旧，先升级依赖再重新安装。", "中文排错总结");
  try {
    const proposal: SkillProposal = { action: "create", scope: "project", name: "build-failure-notes",
      description: "构建失败排错：先升级 peerDependencies 再重新安装", reason: "可复用排错经验",
      body: "排错步骤：\n1. 检查 peerDependencies 版本。\n2. 升级后重新安装。\n3. 重新运行构建验证。",
      files: [{ file: "references/checklist.txt", content: "升级依赖 → 重新安装 → 重新构建\n" }],
      evidence: [{ entryId: f.proposal.evidence[0]!.entryId, quote: "peerDependencies 版本过旧" }] };
    const record = await f.store.submitModel(proposal, f.snapshot, "agent-notes-create");
    assert.equal(record.contentProof?.kind, "agent-notes"); assert.equal(record.contentProof?.sources[0]?.role, "user");
    const skill = (await f.store.search("构建失败排错"))[0]!; assert.equal(skill.id, record.id);
    const read = await f.store.view(record.id);
    assert.match(read.content, /排错步骤/); assert.equal(read.record.contentProof?.kind, "agent-notes");
    assert.equal(read.record.files?.["references/checklist.txt"], contentHash("升级依赖 → 重新安装 → 重新构建\n"));
    assert.equal(await readFile(join(f.cwd, ".pi/skills/hermes-managed/build-failure-notes/references/checklist.txt"), "utf8"), "升级依赖 → 重新安装 → 重新构建\n");
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0);
    const history = await f.store.history(record.id);
    assert.equal(history.items[0]?.kind, "creation");
  } finally { f.session.dispose(); }
});

test("evidenced updates outside the old template revise the same note as agent-notes", async () => {
  const f = await fixture("先升级依赖再构建。", "第一次总结");
  try {
    const saved = await f.store.submitModel({ ...f.proposal, name: "build-notes", body: "原始排错笔记。" }, f.snapshot, "first-save");
    assert.equal(saved.contentProof?.kind, "agent-notes");
    const entryId = f.session.sessionManager.appendMessage({ role: "user", content: "更正：还需要清除缓存目录再构建。", timestamp: 2 });
    const snapshot = { ...captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture" }),
      skillReads: [{ id: saved.id, file: "SKILL.md", version: saved.version }] };
    const updated = await f.store.submitModel({ action: "update", id: saved.id, scope: "project", name: "build-notes",
      description: "构建排错笔记（含缓存清理）", body: "排错：升级依赖，清除缓存目录，再重新构建。",
      reason: "新证据纠正旧结论", baseVersion: saved.version, evidence: [{ entryId, quote: "清除缓存目录" }] }, snapshot, "revise-note");
    assert.equal(updated.contentProof?.kind, "agent-notes"); assert.equal(updated.id, saved.id);
    assert.match((await f.store.view(saved.id)).content, /清除缓存目录/);
    const history = await f.store.history(saved.id);
    assert.equal(history.items[0]?.kind, "update"); assert.equal(history.items[0]?.beforeVersion, saved.version);
  } finally { f.session.dispose(); }
});

test("agent-notes never bypasses evidence, path, structure, scope, pin or version validation", async () => {
  const f = await fixture("构建前先升级依赖。", "中文排错总结");
  try {
    const evidence = f.proposal.evidence;
    // Missing evidence and stale quotes still fail before any agent-notes save.
    for (const bad of [
      { ...f.proposal, evidence: [] },
      { ...f.proposal, evidence: [{ entryId: "missing-entry", quote: "x" }] },
      { ...f.proposal, evidence: [{ entryId: evidence[0]!.entryId, quote: "not in snapshot" }] },
    ]) await assert.rejects(f.store.submitModel(bad as SkillProposal, f.snapshot, "bad-evidence"));
    // Invalid structure/scope/name rejected by the same gates as before.
    for (const bad of [
      { ...f.proposal, name: "Invalid_Name" },
      { ...f.proposal, description: "" },
      { ...f.proposal, action: "create", scope: "external" },
      { ...f.proposal, action: "update", id: "nope", baseVersion: "z".repeat(64) },
      { ...f.proposal, files: [{ file: "../escape.txt", content: "x" }] },
      { ...f.proposal, files: [{ file: "SKILL.md", content: "x" }] },
      { ...f.proposal, files: [{ file: "/absolute.txt", content: "x" }] },
      { ...f.proposal, files: [{ file: "references/a.txt", content: "x" }, { file: "references/a.txt", content: "y" }] },
    ]) await assert.rejects(f.store.submitModel(bad as SkillProposal, f.snapshot, "bad-structure"));
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 0);
    assert.deepEqual(await f.store.catalog(), []);
    // Version conflict on update still rejects even though content would otherwise save.
    const saved = await f.store.submitModel({ ...f.proposal, name: "version-gate" }, f.snapshot, "version-gate-seed");
    const stale = { ...f.proposal, action: "update" as const, id: saved.id, name: "version-gate",
      baseVersion: "0".repeat(64), body: "更新内容" };
    f.snapshot.skillReads = [{ id: saved.id, file: "SKILL.md", version: saved.version }];
    await assert.rejects(f.store.submitModel(stale, f.snapshot, "stale-version"), /version|Version/i);
    assert.equal((await f.store.view(saved.id)).content.includes("更新内容"), false);
  } finally { f.session.dispose(); }
});

test("verbatim excerpt bodies need explicit source-report opt-in; default keeps them as agent-notes", async () => {
  const f = await fixture("For this repo, prefer the pinned toolchain over latest.", "excerpt");
  try {
    const implicit = assessContent({ ...f.proposal, body: f.proposal.evidence[0]!.quote }, f.snapshot);
    assert.equal(implicit.proof?.kind, "agent-notes"); assert.equal(implicit.proposal.body, f.proposal.evidence[0]!.quote);
    const excerpt = assessContent({ ...f.proposal, body: f.proposal.evidence[0]!.quote, contentKind: "source-report" }, f.snapshot);
    assert.equal(excerpt.proof?.kind, "source-report"); assert.match(excerpt.proposal.body, /not independently certified/);
  } finally { f.session.dispose(); }
});

test("restored-version and user-approved proofs survive history reads and local rollback recovery", async () => {
  const f = await fixture("Keep the original procedure.", "Original note");
  try {
    const snapshot = captureSnapshot({ cwd: f.cwd, sessionManager: f.session.sessionManager, model: f.snapshot.model, getSystemPrompt: () => "Fixture" });
    const original = await f.store.save({ ...f.proposal, name: "restore-check", body: "Original body." }, snapshot, "seed-save",
      { contentProof: { kind: "user-approved", sources: f.proposal.evidence.map(item => ({ ...item, role: "approval-source" })) } });
    assert.equal(original.contentProof?.kind, "user-approved");
    const updated = await f.store.save({ action: "update", id: original.id, scope: "project", name: "restore-check",
      description: "Updated", body: "Changed body.", reason: "Update for rollback fixture", baseVersion: original.version,
      evidence: f.proposal.evidence }, { ...snapshot, skillReads: [{ id: original.id, file: "SKILL.md", version: original.version }] }, "later-save");
    const items = (await f.store.history(original.id)).items;
    const change = items.find(row => row.requestId === "later-save")!;
    const preview = await f.store.previewRollback(change.key, { id: original.id, name: original.name, scope: original.scope,
      filePath: original.path, baseDir: dirname(original.path), version: updated.version, owner: "managed", source: "managed",
      namespace: "managed", readOnly: false, pinned: false, projectIdentity: f.cwd }, snapshot);
    assert.equal(preview.kind, "update");
    const restored = await f.store.save(preview.preview.proposal, preview.snapshot, "rollback-check", { rollbackOf: change.key });
    assert.equal(restored.contentProof?.kind, "restored-version"); assert.equal(restored.contentProof?.restoredFrom, change.key);
    assert.match((await f.store.view(original.id)).content, /Original body/);
    const reversal = (await f.store.history(original.id)).items.find(row => row.rollbackOf === change.key);
    assert.ok(reversal); assert.equal(reversal.afterVersion, restored.version);
    assert.deepEqual(await f.store.inspectRecovery(), []);
  } finally { f.session.dispose(); }
});
