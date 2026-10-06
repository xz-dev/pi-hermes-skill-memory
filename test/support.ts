import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { watch } from "node:fs";
import type { ReviewState } from "../src/ledger.ts";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import type { SkillRestorePolicy } from "../src/restore-sources.ts";
import type { SkillSources } from "../src/sources.ts";
import { createSkillsExtension } from "../src/index.ts";

export async function isolatedSession(reply = "fake provider: no network", options: {
  projectRoot?: (cwd: string) => string;
  streamReply?: (context: Context) => Pick<AssistantMessage, "content" | "stopReason"> & Partial<Pick<AssistantMessage, "usage" | "errorMessage">>;
  unknownPrice?: boolean;
  deferReply?: (context: Context) => Promise<void> | undefined;
  noReplacementTools?: boolean;
  nativeRead?: boolean;
  pluginEnabled?: boolean;
  skills?: Skill[];
  restorePolicy?: SkillRestorePolicy;
  skillSources?: SkillSources;
  setup?: (pi: ExtensionAPI) => void;
  observe?: (pi: ExtensionAPI) => void;
} = {}) {
  const root = await mkdtemp("/var/tmp/hermes-skills-test-");
  const cwd = join(root, "project"); const agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  const calls: Context[] = [];
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
    modelsStorePath: join(agentDir, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false,
  });
  runtime.registerProvider("hermes-test", {
    api: "openai-completions", apiKey: "fake-not-a-credential", baseUrl: "https://invalid.test",
    models: [{ id: "fake", name: "Hermes test only", input: ["text"], reasoning: false,
      contextWindow: 128000, maxTokens: 4096, cost: options.unknownPrice ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }],
    streamSimple: (model, context) => {
      calls.push(structuredClone(context));
      const frame = options.streamReply?.(context);
      const result: AssistantMessage = {
        role: "assistant", content: frame?.content ?? [{ type: "text", text: reply }],
        api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(),
        usage: frame?.usage ?? { input: 120, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 128,
          cost: { input: .00012, output: .000008, cacheRead: 0, cacheWrite: 0, total: .000128 } },
        stopReason: frame?.stopReason ?? "stop", errorMessage: frame?.errorMessage,
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: result });
      const done = () => stream.push({ type: "done", reason: result.stopReason === "toolUse" ? "toolUse" : "stop", message: result });
      const delay = options.deferReply?.(context);
      if (delay) void delay.then(done);
      else done();
      return stream;
    },
  });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  settings.setProjectTrusted(true); // This isolated fixture is explicitly approved, not a real user project.
  const resources = new DefaultResourceLoader({
    cwd, agentDir, settingsManager: settings, noExtensions: true, noSkills: true,
    noThemes: true, noPromptTemplates: true, noContextFiles: true,
    skillsOverride: () => ({ skills: options.skills ?? [], diagnostics: [] }),
    extensionFactories: [pi => {
      options.setup?.(pi);
      if (options.noReplacementTools) pi.on("session_start", () => { pi.setActiveTools(["read"]); });
    }, pi => {
      if (options.pluginEnabled !== false) createSkillsExtension({ agentDir, projectRoot: options.projectRoot?.(cwd), restorePolicy: options.restorePolicy, skillSources: options.skillSources ?? (async request => ({
        version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted,
        skills: options.skills ?? [], diagnostics: [],
      })) })(pi);
    }, options.observe ?? (() => {})],
  });
  await resources.reload();
  assert.deepEqual(resources.getExtensions().errors, []);
  const model = runtime.getModel("hermes-test", "fake"); assert.ok(model);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(cwd), settingsManager: settings,
    resourceLoader: resources, noTools: options.noReplacementTools || options.nativeRead ? undefined : "builtin",
    tools: options.noReplacementTools ? ["read"] : options.nativeRead ? ["read", "hermes_skill_search", "hermes_skill_view"] : undefined,
  });
  await session.bindExtensions({ mode: "print" });
  const monitors: ReturnType<typeof watch>[] = [];
  const onReviewState = (listener: (state: ReviewState) => void) => {
    // Observe durable publication instead of coupling completion to status-bar rendering.
    const directory = join(agentDir, "hermes-review");
    const check = async () => listener(JSON.parse(await readFile(join(directory, "ledger.json"), "utf8")) as ReviewState);
    const monitor = watch(directory, (_event, file) => { if (file?.toString() === "ledger.json") void check(); });
    monitors.push(monitor);
    void check();
    return () => monitor.close();
  };
  const dispose = session.dispose.bind(session);
  session.dispose = () => { for (const monitor of monitors) monitor.close(); dispose(); };
  return { root, cwd, agentDir, calls, session, runtime, resources, onReviewState };
}
