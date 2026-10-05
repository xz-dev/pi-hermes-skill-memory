import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { captureSnapshot } from "../src/context.ts";
import { isolatedSession } from "./support.ts";

test("official SDK loads extension without a model call or a managed directory", async () => {
  const { session, calls, agentDir } = await isolatedSession();
  try {
    assert.equal(calls.length, 0);
    assert.equal((await readdir(agentDir)).includes("hermes-skills"), false);
    await session.prompt("Hello, fake provider.");
    assert.equal(session.getLastAssistantText(), "fake provider: no network");
    assert.equal(calls.length, 1, "only the explicit foreground fake request");
    assert.equal(session.sessionManager.getSessionFile(), undefined);
  } finally { session.dispose(); }
});

test("search-first removes the native catalog but preserves another extension's section", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-api-skills-"); const skillDir = join(dir, "release-check");
  await mkdir(skillDir);
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: release-check\ndescription: Check releases\n---\nSecret full body not in initial prompt.\n");
  const loaded = loadSkillsFromDir({ dir, source: "user" }); assert.equal(loaded.skills.length, 1);
  let metadata: Skill[] = [];
  const { session, calls } = await isolatedSession("fake", {
    skills: loaded.skills,
    setup: (pi) => pi.on("before_agent_start", (event) => {
      metadata = structuredClone(event.systemPromptOptions.skills);
      event.systemPromptOptions.sections.another_extension = "Keep this other section.";
    }),
  });
  try {
    await session.prompt("Hi");
    assert.equal(metadata[0]?.name, "release-check");
    const serialized = JSON.stringify(calls[0]);
    assert.ok(serialized.includes("hermes_skill_search"));
    assert.ok(serialized.includes("Keep this other section."));
    assert.ok(!serialized.includes("release-check"));
    assert.ok(!serialized.includes("Secret full body"));
  } finally { session.dispose(); }
});

test("current projection retains the compaction checkpoint, not all old history", () => {
  const manager = SessionManager.inMemory("/var/tmp/hermes-api-project");
  manager.appendMessage({ role: "user", content: "Old text removed by compaction", timestamp: 1 });
  manager.appendCompaction("Keep only release constraints", null, 100);
  manager.appendMessage({ role: "user", content: "Now fix release step", timestamp: 2 });
  const snapshot = captureSnapshot({ sessionManager: manager, cwd: manager.getCwd(), model: undefined,
    getSystemPrompt: () => "Isolated system prompt" });
  assert.equal(snapshot.messages[0]?.role, "system");
  assert.ok(JSON.stringify(snapshot.messages).includes("Keep only release constraints"));
  assert.ok(!JSON.stringify(snapshot.messages).includes("Old text removed"));
  assert.ok(snapshot.evidence.some(item => item.text.includes("Now fix release step")));
  snapshot.messages.length = 0;
  assert.ok(manager.buildSessionProjection().messages.length > 0);
});

test("public ModelRegistry independent request does not change session leaf or entries", async () => {
  let ctx: ExtensionContext | undefined;
  const { session, calls } = await isolatedSession("fake", {
    observe: (pi) => pi.on("agent_settled", (_event, context) => { ctx = context; }),
  });
  try {
    await session.prompt("Foreground work"); assert.ok(ctx?.model);
    const leaf = ctx.sessionManager.getLeafId(); const entries = JSON.stringify(ctx.sessionManager.getEntries());
    const snapshot = captureSnapshot(ctx);
    const result = await ctx.modelRegistry.streamSimple(ctx.model, { messages: snapshot.messages }, {
      maxRetries: 0, maxTokens: 4096, toolChoice: "none", signal: AbortSignal.timeout(1000),
    }).result();
    assert.equal(calls.length, 2);
    assert.equal(result.usage.totalTokens, 128);
    assert.equal(ctx.sessionManager.getLeafId(), leaf);
    assert.equal(JSON.stringify(ctx.sessionManager.getEntries()), entries);
  } finally { session.dispose(); }
});

test("inactive replacement tools leave native skill discovery available", async () => {
  const dir = await mkdtemp("/var/tmp/hermes-native-fallback-"); const skillDir = join(dir, "native-release");
  await mkdir(skillDir);
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: native-release\ndescription: Native fallback release guide\n---\nBody.\n");
  const loaded = loadSkillsFromDir({ dir, source: "user" });
  const { session, calls } = await isolatedSession("fake", { skills: loaded.skills, noReplacementTools: true });
  try {
    await session.prompt("Hi");
    assert.ok(JSON.stringify(calls[0]).includes("native-release"));
  } finally { session.dispose(); }
});
