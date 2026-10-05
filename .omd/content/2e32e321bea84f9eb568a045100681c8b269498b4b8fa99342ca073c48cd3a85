import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** Native CLI acceptance only; never load against a personal agentDir. */
export default function deliveryFixture(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  if (!agentDir.startsWith("/var/tmp/hermes-delivery-")) throw new Error("Delivery fixture requires an isolated agentDir");
  pi.on("project_trust", () => ({ trusted: "yes", remember: false }));
  pi.registerProvider("hermes-delivery-test", {
    api: "openai-completions", apiKey: "fake-local-only", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Command-only delivery fixture", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: () => {
      appendFileSync(join(agentDir, "unexpected-model-call"), "called\n");
      throw new Error("Command-only acceptance must not invoke a provider");
    },
  });
}
