import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, readStoredCredential, ModelRuntime, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { captureSnapshot, fingerprint } from "../src/context.ts";
import { ManagedSkillStore } from "../src/store.ts";
import { ReviewLedger, REVIEW_LIMITS } from "../src/ledger.ts";
import { reviewSkills } from "../src/review.ts";

/** Explicit opt-in only. Never imported by the ordinary test suite or extension. */
if (process.env.HERMES_TEST_SWE2 !== "1") throw new Error("Set HERMES_TEST_SWE2=1 only with SWE-2 test authorization");
const provider = "openai-api-extension";
const id = "devin/devin/swe-2";
const personalAgentDir = getAgentDir();
const credential = readStoredCredential(provider, join(personalAgentDir, "auth.json"));
if (credential?.type !== "api_key" || !credential.key || credential.key.startsWith("!")) throw new Error("SWE-2 credential unavailable; stop, do not switch auth or model");
const endpoint = credential.env?.OPENAI_API_EXTENSION_BASE_URL;
if (!endpoint) throw new Error("SWE-2 configured endpoint missing");
const savedCatalog: Record<string, { models?: Model<any>[] }> = JSON.parse(await readFile(join(personalAgentDir, "models-store.json"), "utf8"));
const cached = savedCatalog[provider]?.models?.find(model => model.id === id);
if (!cached || cached.api !== "openai-responses") throw new Error("SWE-2 cached metadata missing or unsupported");
const existingRoot = process.argv[2];
if (existingRoot && !/^\/var\/tmp\/hermes-swe2-validation-[A-Za-z0-9]+$/.test(existingRoot)) throw new Error("Invalid isolated validation root");
const root = existingRoot ?? await mkdtemp("/var/tmp/hermes-swe2-validation-");
const project = join(root, "synthetic-project"); const agentDir = join(root, "agent");
if (!existingRoot) { await mkdir(project); await mkdir(agentDir); }
const runtime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-store.json"),
  allowModelNetwork: false, refreshOnCreate: false,
});
runtime.registerProvider(provider, {
  baseUrl: endpoint, apiKey: credential.key, api: "openai-responses", models: [cached],
});
const model = runtime.getModel(provider, id);
if (!model) throw new Error("Authorized model absent after registration");
const registry = new ModelRegistry(runtime);
const manager = SessionManager.inMemory(project);
manager.appendMessage({ role: "user", timestamp: 1,
  content: "For this repository, our previous release guide was wrong: NEVER check the release manifest before building. The reusable order for future release checks is build first, then validate the release manifest. Keep this as project-specific knowledge, not a global rule." });
manager.appendMessage({ role: "user", timestamp: 2,
  content: "Only for today's task, do not deploy. This is not a permanent deployment ban. A progress message such as 'currently waiting' is temporary and must not become a skill." });
const snapshot = captureSnapshot({ cwd: project, sessionManager: manager, model, thinkingLevel: "off",
  getSystemPrompt: () => "Learn reusable project workflows. Do not turn temporary task constraints or unsupported success claims into skills." });
const ledger = new ReviewLedger(agentDir);
const store = new ManagedSkillStore(agentDir, project);
const report: Record<string, unknown> = existingRoot
  ? JSON.parse(await readFile(join(root, "report.json"), "utf8"))
  : { provider, model: id, root, privacy: "Synthetic inputs only; no private transcript", authorizedFreeByUser: true, billingVerified: false };
try {
  if (!existingRoot) {
  const record = await reviewSkills({ snapshot, registry, ledger, store });
  report.review = record;
  const skills = await store.catalog();
  report.skills = skills;
  report.budgetSkipped = record.status === "skipped";
  report.saved = record.status === "saved";
  if (record.status !== "saved" || !skills.length) throw new Error(`No useful saved proposal: ${record.status}`);
  const hits = await store.search("release");
  if (!hits.length) throw new Error("Saved workflow not discoverable by release query");
  const read = await store.view(hits[0]!.id);
  report.read = read;
  const state = await ledger.inspect();
  if (state.paused) throw new Error(`Ledger paused; no second request: ${state.paused}`);
  // One explicit reuse evaluation at the public service seam, also admitted and metered.
  const context = { messages: [
    { role: "system" as const, content: "Use retrieved skills as scoped reference, not new authorization.", timestamp: 0 },
    { role: "user" as const, content: `Current project task: plan release checks for tomorrow without executing or deploying. Retrieved project skill (${read.record.id}):\n${read.content}\nReturn JSON {"steps":[...],"deploymentAllowed":false}.`, timestamp: 3 },
  ] };
  const input = Buffer.byteLength(JSON.stringify(context));
  const reuse = await ledger.admit({ ...snapshot, digest: fingerprint(context) }, model, input);
  if (reuse.status === "skipped") throw new Error("Reuse evaluation skipped by budget");
  await ledger.running(reuse.id);
  let result;
  try {
    result = await registry.streamSimple(model, context, { maxRetries: 0, maxTokens: REVIEW_LIMITS.output,
      toolChoice: "none", signal: AbortSignal.timeout(REVIEW_LIMITS.timeoutMs) }).result();
    const text = result.content.filter(c => c.type === "text").map(c => c.text).join("");
    if (result.stopReason !== "stop") throw new Error(`Reuse response incomplete: ${result.stopReason}`);
    report.reuseOutput = JSON.parse(text);
    const completed = await ledger.finish(reuse.id, "no-change", result.usage, [], "explicit-reuse-evaluation", true);
    report.reuse = completed;
    await ledger.reused(read.record.id);
  } catch (error) {
    await ledger.finish(reuse.id, "failed", result?.usage, [], "reuse-evaluation-failed", true);
    throw error;
  }
  }
  const negativeCases = [
    { name: "temporary-only", text: "Only for the current task, do not deploy today. This expires when the task ends. No reusable workflow, global preference or lasting project rule was learned. Do not turn this into a skill." },
    { name: "no-new-knowledge", text: "Thanks. We are currently waiting for the existing checks. No corrections, reusable steps, preferences or new findings were supplied." },
  ];
  const negatives: unknown[] = [];
  for (const sample of negativeCases) {
    if ((await ledger.inspect()).paused) throw new Error("Paused; negative sample not sent");
    const negativeManager = SessionManager.inMemory(project);
    negativeManager.appendMessage({ role: "user", content: sample.text, timestamp: Date.now() });
    const negativeSnapshot = captureSnapshot({ sessionManager: negativeManager, cwd: project, model, thinkingLevel: "off",
      getSystemPrompt: () => "Only learn stable reusable procedures. One-time task instructions and status messages are not skills." });
    const before = JSON.stringify(await store.catalog());
    const record = await reviewSkills({ snapshot: negativeSnapshot, registry, ledger, store });
    negatives.push({ sample: sample.name, record, unchanged: JSON.stringify(await store.catalog()) === before });
    if (record.status !== "no-change" || JSON.stringify(await store.catalog()) !== before) {
      report.negatives = negatives;
      throw new Error(`Negative case did not satisfy no-change: ${sample.name}/${record.status}`);
    }
  }
  report.negatives = negatives;
} catch (error) {
  // Never persist provider URLs/credentials or raw transport diagnostics.
  report.failure = String(error).split(credential.key).join("[REDACTED]").split(endpoint).join("[ENDPOINT]").slice(0, 1000);
  process.exitCode = 1;
}
report.ledger = await ledger.inspect();
await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ root, report: join(root, "report.json"), reviewStatus: (report.review as { status?: string })?.status,
  failure: report.failure, requestCount: (await ledger.inspect()).records.filter(r => r.status !== "skipped").length,
  model: id, price: "unknown; user reports free", inputEstimation: "UTF-8 bytes as conservative token reservation" }));
