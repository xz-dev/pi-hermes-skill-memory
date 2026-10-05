import assert from "node:assert/strict";
import { test } from "node:test";
import { access, readFile, symlink, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { captureSnapshot } from "../src/context.ts";
import { assessContent } from "../src/content.ts";
import { InstalledPermissions } from "../src/permissions.ts";
import { ManagedSkillStore } from "../src/store.ts";
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

test("evidenced procedural paraphrase saves through a host template, not verbatim copying or an execution claim", async () => {
  const f = await fixture("For this repo, build before checking the release manifest.", "Build first; check release manifest second.");
  try {
    const record = await reviewSkills(f); assert.equal(record.status, "saved"); assert.equal(f.count(), 1);
    const skill = (await f.store.search("release"))[0]!;
    const read = await f.store.view(skill.id);
    assert.equal(read.record.contentProof?.kind, "procedure-template");
    assert.match(read.content, /Build this repo first/); assert.match(read.content, /release manifest against the built output/);
    assert.ok(!read.content.includes(f.proposal.body)); assert.ok(!/passed|succeeded|successfully/.test(read.content));
    assert.equal(read.record.contentProof?.sources[0]?.role, "user"); assert.equal((await f.ledger.inspect()).records.length, 1);
  } finally { f.session.dispose(); }
});

test("a request to run tests cannot prove they passed: bounded pending then local approval stays user-approved", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const record = await reviewSkills(f); assert.equal(record.status, "pending"); assert.equal(f.count(), 1);
    assert.equal(record.usage?.totalTokens, 110); assert.deepEqual(await f.store.catalog(), []);
    const permissions = new InstalledPermissions(f.agentDir), rows = (await permissions.status()).pending;
    assert.equal(rows.length, 1); assert.equal(rows[0]!.contentReview, true);
    const path = join(f.cwd, ".pi/skills/hermes-managed/release-check/SKILL.md"); await assert.rejects(access(path), /ENOENT/);
    const accounting = JSON.stringify((await f.ledger.inspect()).records);
    const ui = f.session.extensionRunner.createCommandContext().ui; let seen = "", confirms = 0; const notices: string[] = [];
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, editor: async (_title, text) => { seen = text ?? ""; return text; },
      confirm: async () => { confirms++; return true; }, notify: text => { notices.push(text); }, setStatus: () => {}, setWidget: () => {} } });
    const primaryCalls = f.calls.length;
    await f.session.prompt(`/hermes-skills approve ${rows[0]!.id}`);
    assert.ok(seen.includes("not certify") && seen.includes("All tests passed.")); assert.equal(confirms, 1);
    assert.ok(!notices.some(text => text.includes('"failed"')), notices.join("\n"));
    assert.match(await readFile(path, "utf8"), /All tests passed/);
    const saved = (await f.store.catalog())[0]!; assert.equal(saved.contentProof?.kind, "user-approved");
    assert.notEqual(saved.contentProof?.kind, "procedure-template"); assert.equal(f.calls.length, primaryCalls); assert.equal(f.count(), 1);
    assert.equal(JSON.stringify((await f.ledger.inspect()).records), accounting); assert.equal((await permissions.status()).pending.length, 0);
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
      assert.equal(result.proof, undefined, text);
    }
    for (const body of ["Build before manifest check. 测试全绿", "Build before manifest check 123", "Never build before manifest check"])
      assert.equal(assessContent({ ...f.proposal, body }, f.snapshot).proof, undefined, body);
    const generated = assessContent({ ...f.proposal, description: "All tests passed", procedureTemplate: "build-before-manifest" }, f.snapshot);
    assert.ok(generated.proof); assert.ok(!generated.proposal.description.includes("passed"));
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
test("managed unverified update approval rejects later edits locally and preserves its original charge", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const saved = await f.store.save({ ...f.proposal, body: "Existing rule" }, f.snapshot, "setup-managed");
    Object.assign(f.proposal, { action: "update", id: saved.id, baseVersion: saved.version });
    f.snapshot.skillReads = [{ id: saved.id, file: "SKILL.md", version: saved.version }];
    const result = await reviewSkills(f); assert.equal(result.status, "pending"); assert.equal(f.count(), 1);
    const permissions = new InstalledPermissions(f.agentDir), row = (await permissions.status()).pending[0]!;
    const accounting = JSON.stringify((await f.ledger.inspect()).records);
    await writeFile(saved.path, "Manual version after pending\n");
    const ui = f.session.extensionRunner.createCommandContext().ui; let dialogs = 0;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, editor: async (_title, text) => { dialogs++; return text; },
      confirm: async () => { dialogs++; return true; }, notify: () => {}, setStatus: () => {}, setWidget: () => {} } });
    await f.session.prompt(`/hermes-skills approve ${row.id}`);
    assert.equal(dialogs, 0); assert.equal(await readFile(saved.path, "utf8"), "Manual version after pending\n");
    assert.equal(JSON.stringify((await f.ledger.inspect()).records), accounting); assert.equal(f.calls.length, 0);
    assert.equal((await permissions.status()).pending.length, 1);
  } finally { f.session.dispose(); }
});

test("all pending members from a classified response remain inspectable with a single metered request", async () => {
  const f = await fixture("Please run tests", "All tests passed.");
  try {
    const result = await reviewSkills({ ...f, registry: { streamSimple: () => {
      const stream = createAssistantMessageEventStream();
      void f.registry.streamSimple().result().then(message => {
        const proposals = [f.proposal, { ...f.proposal, name: "testing-notes" }];
        stream.end({ ...message, content: [{ type: "text", text: JSON.stringify({ skills: proposals }) }] });
      }); return stream;
    } } });
    assert.equal(result.status, "pending"); assert.equal(f.count(), 1); assert.equal(result.usage?.totalTokens, 110);
    assert.equal((await new InstalledPermissions(f.agentDir).status()).pending.length, 2);
    assert.equal((await f.ledger.inspect()).records.length, 1); assert.deepEqual(await f.store.catalog(), []);
  } finally { f.session.dispose(); }
});

test("source reports retain attribution and do not certify results; unknown business assertions stay pending", async () => {
  const f = await fixture("A user reports that tests passed, but no tool execution evidence is present.", "User report");
  try {
    const report = assessContent({ ...f.proposal, contentKind: "source-report" }, f.snapshot);
    assert.equal(report.proof?.kind, "source-report"); assert.match(report.proposal.body, /not independently certified/);
    assert.ok(report.proposal.body.includes(f.proposal.evidence[0]!.entryId)); assert.match(report.proposal.body, /\(user\)/);
    const unknown = assessContent({ ...f.proposal, body: "Use the production server 1.2.3.4; all tests passed." }, f.snapshot);
    assert.equal(unknown.proof, undefined);
    const misleading = assessContent({ ...f.proposal, body: "Build before checking manifest. Production server is 1.2.3.4." }, f.snapshot);
    assert.equal(misleading.proof, undefined);
  } finally { f.session.dispose(); }
});
