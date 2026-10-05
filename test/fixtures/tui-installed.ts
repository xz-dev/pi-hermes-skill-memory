import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { createSkillsExtension } from "../../src/index.ts";

/** Native TUI fixture: isolated temp agentDir, deterministic fake provider, no network. */
export default function fixture(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  if (!agentDir.startsWith("/var/tmp/hermes-installed-tui-")) throw new Error("Fixture refuses non-isolated agentDir");
  pi.on("project_trust", () => ({ trusted: "yes", remember: false }));
  createSkillsExtension({ agentDir, projectRoot: process.cwd(), skillSources: async request => ({
    version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, diagnostics: [],
    skills: loadSkillsFromDir({ dir: join(request.cwd, ".pi/skills"), source: "project" }).skills,
  }) })(pi);
  let ctx: ExtensionContext;
  pi.on("session_start", (_event, context) => { ctx = context; });
  pi.registerProvider("hermes-installed-ui", {
    api: "openai-completions", apiKey: "fake-local-only", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Installed approval UI fake", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
    streamSimple: (model, context) => {
      const lastUser = context.messages.findLastIndex(message => message.role === "user");
      const results = context.messages.slice(lastUser + 1).filter(message => message.role === "toolResult");
      const last = results.at(-1);
      const data = last ? JSON.parse(last.content.filter(part => part.type === "text").map(part => part.text).join("")) : undefined;
      let content: AssistantMessage["content"];
      if (!last) content = [{ type: "toolCall", id: "ui-search", name: "hermes_skill_search", arguments: {} }];
      else if (last.toolName === "hermes_skill_search") content = [{ type: "toolCall", id: "ui-read", name: "hermes_skill_view", arguments: { id: data.items[0].id } }];
      else if (last.toolName === "hermes_skill_view") {
        const entry = ctx.sessionManager.buildSessionProjection().entries.findLast(entry => entry.sourceEntry.type === "message" && entry.sourceEntry.message.role === "user")!;
        content = [{ type: "toolCall", id: "ui-manage", name: "hermes_skill_manage", arguments: { proposal: {
          action: "update", scope: "project", id: data.id, baseVersion: data.version, name: "manual-rule", description: "Native UI approval fixture",
          body: ["Build before manifest check.", ...Array.from({ length: 65 }, (_, index) => `Reviewed procedure line ${index + 1}`), "FINAL NEW RULE"].join("\n"),
          reason: "Explicit isolated user correction", evidence: [{ entryId: entry.sourceEntry.id, quote: "Build before manifest check" }],
          files: [{ file: "references/check.md", content: "REFERENCE AFTER: check the built manifest" }],
        } } }];
      } else content = [{ type: "text", text: `Native fixture outcome: ${data.status}; no real provider request.` }];
      const message: AssistantMessage = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: content[0]!.type === "toolCall" ? "toolUse" : "stop",
        usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void appendFile(join(agentDir, "fake-calls.jsonl"), JSON.stringify({ tools: content.filter(part => part.type === "toolCall").map(part => part.name), network: false }) + "\n");
      const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); return stream;
    },
  });
}
