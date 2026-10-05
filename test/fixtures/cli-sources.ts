import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Public CLI fixture: deterministic foreground provider; no network or package scripts. */
export default function fixture(pi: ExtensionAPI) {
  pi.registerProvider("hermes-source-test", {
    api: "openai-completions", apiKey: "fake-not-a-credential", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Source fake", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context) => {
      const toolResult = context.messages.filter(m => m.role === "toolResult").at(-1);
      if (toolResult) {
        const text = toolResult.content.filter(c => c.type === "text").map(c => c.text).join("");
        const found = JSON.parse(text);
        assert.equal(found.items.length, Number(process.env.HERMES_EXPECT_COUNT));
        if (found.items.length) {
          assert.deepEqual(found.items.map((i: { scope: string }) => i.scope), ["project", "global"]);
          assert.notEqual(found.items[0].id, found.items[1].id);
        }
      }
      const result: AssistantMessage = { role: "assistant", content: toolResult ? [{ type: "text", text: `CLI fake only: ${process.env.HERMES_EXPECT_COUNT} scoped sources` }]
        : [{ type: "toolCall", id: "source-fixture-search", name: "hermes_skill_search", arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: toolResult ? "stop" : "toolUse",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: result }); stream.push({ type: "done", reason: toolResult ? "stop" : "toolUse", message: result });
      return stream;
    },
  });
  pi.on("before_agent_start", event => { assert.equal(event.systemPromptOptions.skills.length, 0); });
  pi.on("agent_settled", async (_event, ctx) => {
    await appendFile(process.env.HERMES_SOURCE_REPORT!, JSON.stringify({ sessionId: ctx.sessionManager.getSessionId(), foreground: true }) + "\n");
  });
}
