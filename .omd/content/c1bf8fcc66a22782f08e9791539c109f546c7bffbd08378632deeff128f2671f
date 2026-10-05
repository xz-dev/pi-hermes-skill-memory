import assert from "node:assert/strict";
import { test } from "node:test";
import { watch } from "node:fs";
import { readFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createSkillsExtension } from "../src/index.ts";
import { ReviewLedger } from "../src/ledger.ts";
import type { ReviewState } from "../src/ledger.ts";
import { isolatedSession } from "./support.ts";

// Observe atomic ledger publication, not sleep/poll or UI that may already have retired.
async function published(agentDir: string, predicate: (state: ReviewState) => boolean) {
  const directory = join(agentDir, "hermes-review"), path = join(directory, "ledger.json");
  return new Promise<ReviewState>((resolve, reject) => {
    const monitor = watch(directory, (_event, file) => { if (file?.toString() === "ledger.json") void check(); });
    const timer = setTimeout(() => { monitor.close(); reject(new Error("Expected ledger publication was not observed")); }, 3000);
    const check = async () => {
      try {
        const state = JSON.parse(await readFile(path, "utf8")) as ReviewState;
        if (predicate(state)) { monitor.close(); clearTimeout(timer); resolve(state); }
      } catch (error) { monitor.close(); clearTimeout(timer); reject(error); }
    };
    void check();
  });
}

async function replacement(f: Awaited<ReturnType<typeof isolatedSession>>, cwd: string): Promise<AgentSession> {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  settings.setProjectTrusted(true);
  const resources = new DefaultResourceLoader({ cwd, agentDir: f.agentDir, settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [createSkillsExtension({ agentDir: f.agentDir, projectRoot: cwd,
      skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
        diagnostics: [], skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills }) })] });
  await resources.reload(); assert.deepEqual(resources.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: f.agentDir, modelRuntime: f.runtime,
    model: f.runtime.getModel("hermes-test", "fake")!, thinkingLevel: "off", settingsManager: settings,
    sessionManager: SessionManager.inMemory(cwd), resourceLoader: resources, noTools: "builtin" });
  await session.bindExtensions({ mode: "print" }); return session;
}

for (const operation of ["input", "branch", "reload", "shutdown", "project"] as const) {
  test(`SDK ${operation} retires one blocked review; late output only settles its original usage`, { timeout: 10000 }, async () => {
    let release!: () => void, start!: () => void, analyses = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { start = resolve; });
    const f = await isolatedSession("Foreground done", { projectRoot: cwd => cwd,
      skillSources: async request => ({ version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
        skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills }),
      deferReply: context => {
        const last = context.messages.at(-1);
        if (last?.role === "user" && typeof last.content === "string" && last.content.includes("Effective evidence:")) { start(); return waiting; }
      },
      streamReply: context => {
        const last = context.messages.at(-1);
        if (last?.role !== "user" || typeof last.content !== "string" || !last.content.includes("Effective evidence:"))
          return { stopReason: "stop", content: [{ type: "text", text: "Foreground done" }] };
        analyses++;
        const evidence = JSON.parse(last.content.split("Effective evidence: ")[1]!) as { entryId: string; text: string }[];
        const source = evidence.find(entry => entry.text.includes("build before checking the release manifest"))!;
        return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ skills: [{ action: "create", scope: "project", name: "release-check",
          description: "Release ordering", body: "Build first; check release manifest second.", reason: "Reusable project correction",
          evidence: [{ entryId: source.entryId, quote: "build before checking the release manifest" }] }] }) }] };
      } });
    let other: AgentSession | undefined;
    try {
      const manager = f.session.sessionManager;
      const first = manager.appendMessage({ role: "user", content: "Earlier task", timestamp: 1 });
      manager.appendMessage({ role: "user", content: "For this repo, build before checking the release manifest.", timestamp: 2 });
      const otherCwd = join(f.root, "other-project"); await mkdir(otherCwd);
      await f.session.prompt("/hermes-review run"); await started;
      const originalLeaf = manager.getLeafId();
      const initial = (await new ReviewLedger(f.agentDir).inspect()).records[0]!;
      assert.equal(analyses, 1); assert.equal(initial.status, "running");
      const cancelled = published(f.agentDir, state => state.records[0]?.status === "cancelled");
      if (operation === "input") await f.session.prompt("New task: unrelated work");
      if (operation === "branch") {
        const navigation = await f.session.navigateTree(first, { summarize: false }); assert.equal(navigation.cancelled, false);
        assert.notEqual(manager.getLeafId(), originalLeaf);
      }
      if (operation === "reload") { await f.session.reload(); await f.session.bindExtensions({ mode: "print" }); }
      if (operation === "shutdown" || operation === "project")
        await f.session.extensionRunner.emit({ type: "session_shutdown", reason: operation === "shutdown" ? "quit" : "new" });
      if (operation === "project") {
        f.session.dispose(); other = await replacement(f, otherCwd);
        assert.equal(other.extensionRunner.createContext().cwd, otherCwd);
        assert.notEqual(other.sessionManager.getSessionId(), initial.sessionId);
      }
      const stopped = (await cancelled).records[0]!;
      assert.equal(stopped.id, initial.id); assert.equal(stopped.usageUnknown, true); assert.ok(stopped.reservation.input > 0);
      assert.deepEqual(stopped.saved, []);
      const active = other ?? f.session;
      const unchanged = JSON.stringify({ leaf: active.sessionManager.getLeafId(), entries: active.sessionManager.getEntries(), tools: active.getActiveToolNames() });
      const late = published(f.agentDir, state => state.records[0]?.status === "cancelled" && !state.records[0].usageUnknown);
      release(); const settled = await late;
      assert.equal(settled.records.length, 1); assert.equal(settled.records[0]!.id, initial.id);
      assert.equal(settled.records[0]!.usage?.totalTokens, 128); assert.deepEqual(settled.records[0]!.saved, []); assert.equal(analyses, 1);
      assert.equal(JSON.stringify({ leaf: active.sessionManager.getLeafId(), entries: active.sessionManager.getEntries(), tools: active.getActiveToolNames() }), unchanged);
      for (const cwd of [f.cwd, otherCwd]) await assert.rejects(access(join(cwd, ".pi/skills/hermes-managed/release-check/SKILL.md")), /ENOENT/);
      assert.equal(f.calls.length, operation === "input" ? 2 : 1, "only the original review, plus explicitly requested foreground input");
    } finally { release(); other?.dispose(); f.session.dispose(); }
  });
}
