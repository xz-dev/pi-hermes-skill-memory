import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ReviewLedger } from "../../src/ledger.ts";
import { randomUUID } from "node:crypto";

/** Isolated UI fixture only, never exported by the package manifest. */
export default function fixture(pi: ExtensionAPI) {
  pi.registerProvider("hermes-ui-test", {
    api: "openai-completions", apiKey: "not-a-real-credential", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "UI fake", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
    streamSimple: model => {
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "Foreground fake answer. No external model was called." }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message });
      return stream;
    },
  });
  pi.registerCommand("inject-review-failure", {
    description: "Test-only: persist one unknown-usage failure",
    handler: async (_args, ctx) => {
      const ledger = new ReviewLedger(getAgentDir());
      const r = await ledger.admit({ digest: randomUUID(), sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd },
        { provider: "hermes-ui-test", id: "fake" }, 500);
      await ledger.running(r.id);
      await ledger.finish(r.id, "failed", undefined, [], "fixture-disconnect");
      pi.events.emit("hermes.review.v1", { version: 1, type: "status-changed" });
    },
  });
}
