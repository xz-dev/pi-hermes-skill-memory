import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { createSkillsExtension } from "../../src/index.ts";

/** Native four-choice acceptance. Refuses personal state; deterministic provider has no network path. */
export default function fixture(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  if (!agentDir.startsWith("/var/tmp/hermes-notebook-tui-")) throw new Error("Fixture refuses non-isolated agentDir");
  pi.on("project_trust", () => ({ trusted: "yes", remember: false }));
  createSkillsExtension({ agentDir, projectRoot: process.cwd(), skillSources: async request => ({
    version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
    skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills,
  }) })(pi);
  let ctx: ExtensionContext;
  pi.on("session_start", (_e, context) => { ctx = context; });
  pi.on("tool_execution_end", event => { void appendFile(join(agentDir, "tool-results.jsonl"), JSON.stringify({ tool: event.toolName, result: event.result }) + "\n"); });
  pi.registerProvider("hermes-notebook-ui", {
    api: "openai-completions", apiKey: "fake-local-only", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Notebook UI fake", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
    streamSimple: (model, context) => {
      const lastUser = context.messages.findLastIndex(m => m.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(m => m.role === "toolResult");
      const last = results.at(-1);
      const data = last ? JSON.parse(last.content.filter(p => p.type === "text").map(p => p.text).join("")) : undefined;
      let content: AssistantMessage["content"];
      const entry = ctx.sessionManager.buildSessionProjection().entries.findLast(e => e.sourceEntry.type === "message" && e.sourceEntry.message.role === "user")!;
      const review = context.messages.at(-1)?.role === "user" && JSON.stringify(context.messages.at(-1)).includes("Effective evidence:");
      if (review) content = [{ type: "text", text: JSON.stringify({ skills: [] }) }];
      else if (!last) content = [{ type: "toolCall", id: "s", name: "hermes_skill_search", arguments: { query: "manual-rule", sourceKind: "user-installed" } }];
      else if (data.status === "redirect") content = [{ type: "toolCall", id: "find-note", name: "hermes_skill_search", arguments: { query: "manual-rule", sourceKind: "managed" } }];
      else if (last.toolCallId === "find-note") content = [{ type: "toolCall", id: "save-note", name: "hermes_skill_manage", arguments: { proposal: {
        action: "create", scope: "project", name: "manual-rule-note", description: "manual-rule: a passed CI job is not enough to merge",
        body: "Do not infer merge readiness solely from CI.", reason: "Independent project note", evidence: [{ entryId: entry.sourceEntry.id, quote: "Build before manifest check" }],
      } } }];
      else if (last.toolName === "hermes_skill_search") content = [{ type: "toolCall", id: "v", name: "hermes_skill_view", arguments: { id: data.items[0].id } }];
      else if (last.toolName === "hermes_skill_view" && data.file === "SKILL.md" && data.content.includes("Review code and CI together.")) content = [{ type: "toolCall", id: "ref", name: "hermes_skill_view", arguments: { id: data.id, file: "references/check.md" } }];
      else if (last.toolName === "hermes_skill_view") {
        const primary = data.file === "SKILL.md" ? data : JSON.parse(results.findLast(r => r.toolName === "hermes_skill_view" && r.toolCallId === "v")!.content.filter(p => p.type === "text").map(p => p.text).join(""));
        content = [{ type: "toolCall", id: "m", name: "hermes_skill_manage", arguments: { proposal: {
        action: "update", scope: "project", id: primary.id, baseVersion: primary.version, name: "manual-rule", description: "Native notebook fixture",
        body: "Build before manifest check.\nReview code and CI together.", reason: "Explicit isolated correction",
        evidence: [{ entryId: entry.sourceEntry.id, quote: "Build before manifest check" }], files: [{ file: "references/check.md", content: "REFERENCE AFTER\n", ...(data.file !== "SKILL.md" ? { baseVersion: data.version } : {}) }],
      } } }]; }
      else content = [{ type: "text", text: `Native notebook outcome: ${JSON.stringify(data)}; no network.` }];
      const message: AssistantMessage = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: content[0]!.type === "toolCall" ? "toolUse" : "stop",
        usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void appendFile(join(agentDir, "fake-calls.jsonl"), JSON.stringify({ review, tools: content.filter(p => p.type === "toolCall").map(p => p.name), network: false }) + "\n");
      const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); return stream;
    },
  });
}
