import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createCliSkillSources } from "../../src/sources.ts";
import { EnabledCatalog } from "../../src/catalog.ts";
import { ManagedSkillStore, contentHash } from "../../src/store.ts";
import { captureSnapshot } from "../../src/context.ts";

/** Test-only setup/observer. Production index.ts is loaded separately via the stock CLI. */
export default function fixture(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  if (!agentDir.startsWith("/var/tmp/hermes-maintenance-tui-")) throw new Error("Fixture requires isolated agentDir");
  pi.on("project_trust", () => ({ trusted: "yes", remember: false }));
  pi.registerProvider("hermes-maintenance-test", {
    api: "openai-completions", apiKey: "fake-local-only", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Maintenance local fake", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: () => { appendFileSync(join(agentDir, "unexpected-model-call"), "called\n"); throw new Error("This command-only fixture must not call a model"); },
  });
  pi.registerCommand("maintenance-fixture", { description: "Isolated history setup, not approval evidence", handler: async (_args, ctx) => {
    const sources = await createCliSkillSources(agentDir)({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), nativeSkills: [] });
    const catalog = new EnabledCatalog(agentDir); await catalog.capture(sources.skills, true, [], ctx.cwd);
    const hit = (await catalog.search("manual-rule")).items[0]!, target = await catalog.inspect(hit.id);
    const path = target.filePath, before = await readFile(path, "utf8"), reference = join(target.baseDir, "references/shared.txt");
    const referenceBefore = await readFile(reference, "utf8"), entryId = "native-fixture-setup";
    const captured = captureSnapshot(ctx);
    const snapshot = { ...captured, evidence: [...captured.evidence, { entryId, role: "user", text: "Preserve this isolated fixture procedure" }], skillReads: [{ id: hit.id, file: relative(target.baseDir, path), version: contentHash(before) },
      { id: hit.id, file: "references/shared.txt", version: contentHash(referenceBefore) }] };
    const store = new ManagedSkillStore(agentDir, ctx.cwd);
    await store.save({ action: "update", id: hit.id, scope: "project", name: target.name, description: "Updated fixture procedure", body: "UPDATED FIXTURE BODY",
      baseVersion: contentHash(before), files: [{ file: "references/shared.txt", content: "UPDATED SHARED FIXTURE", baseVersion: contentHash(referenceBefore) },
        { file: "references/introduced.txt", content: "INTRODUCED FIXTURE MEMBER" }], reason: "Test-only setup of saved history", evidence: [{ entryId, quote: "Preserve this isolated fixture procedure" }] },
      snapshot, "tui-history-setup", { installed: target, approveInstalled: async () => true });
    const history = await store.history(hit.id);
    await writeFile(join(agentDir, "fixture.json"), JSON.stringify({ id: hit.id, path, before, referenceBefore, history }));
    ctx.ui.notify("Fixture history ready; use production rollback/archive/restore commands for actual UI verification", "info");
  } });
}
