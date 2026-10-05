import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { Skill, BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";
import { isolatedSession } from "./support.ts";
import { ReviewLedger } from "../src/ledger.ts";

async function skill(name: string, body: string, explicitOnly = false) {
  const root = await mkdtemp("/var/tmp/hermes-explicit-load-"); const dir = join(root, name); await mkdir(dir);
  const text = `---\nname: ${name}\ndescription: Fixture procedure\n${explicitOnly ? "disable-model-invocation: true\n" : ""}---\n${body}\n`;
  const path = join(dir, "SKILL.md"); await writeFile(path, text);
  return { path, text, metadata: loadSkillsFromDir({ dir, source: "user" }).skills[0]! };
}

async function search(f: Awaited<ReturnType<typeof isolatedSession>>, query = "") {
  return (await f.session.agent.state.tools.find(t => t.name === "hermes_skill_search")!.execute("fixture", { query })).details;
}

test("stable-ID command selects the requested duplicate or explicit-only source without a model request", async () => {
  const a = await skill("same-procedure", "GLOBAL_SELECTED_BODY");
  const b = await skill("same-procedure", "PROJECT_SELECTED_BODY");
  let allowed = [a.metadata, { ...b.metadata, sourceInfo: { ...b.metadata.sourceInfo, scope: "project" as const } }];
  const f = await isolatedSession("fake", { skills: [a.metadata], skillSources: async request => ({
    version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, skills: allowed, diagnostics: [],
  }) });
  try {
    await f.session.prompt("/hermes-skills refresh"); assert.equal(f.calls.length, 0);
    const hits = (await search(f)).items; assert.equal(hits.length, 2);
    const project = hits.find((h: { scope: string }) => h.scope === "project")!;
    assert.equal((await search(f, "missing-keyword")).items.length, 0);
    await f.session.prompt(`/hermes-skills load ${project.id}`); assert.equal(f.calls.length, 0);
    await f.session.prompt("Use the explicitly selected reference");
    assert.ok(JSON.stringify(f.calls.at(-1)?.messages).includes("PROJECT_SELECTED_BODY"));
    assert.ok(!JSON.stringify(f.calls.at(-1)?.messages).includes("GLOBAL_SELECTED_BODY"));
    allowed = [{ ...allowed[1]!, disableModelInvocation: true }];
    await f.session.prompt("/hermes-skills refresh"); assert.equal((await search(f)).items.length, 0);
    await writeFile(b.path, b.text.replace("PROJECT_SELECTED_BODY", "NEW_SELECTED_VERSION"));
    await f.session.prompt(`/hermes-skills load ${project.id}`); assert.equal(f.calls.length, 1);
    await f.session.prompt("Apply the new selected version");
    const loaded = f.session.sessionManager.getEntries().filter(e => e.type === "custom_message" && e.customType === "hermes.skill.loaded");
    assert.equal(loaded.length, 2);
    assert.ok(JSON.stringify(loaded.at(-1)).includes("NEW_SELECTED_VERSION"));
    assert.notEqual((loaded[0] as { details: { version: string } }).details.version, (loaded[1] as { details: { version: string } }).details.version);
    allowed = [];
    await f.session.prompt(`/hermes-skills load ${project.id}`);
    await f.session.prompt("Do not revive excluded sources");
    assert.equal(f.session.sessionManager.getEntries().filter(e => e.type === "custom_message" && e.customType === "hermes.skill.loaded").length, 2);
    assert.equal((await search(f)).items.length, 0);
  } finally { f.session.dispose(); }
});

test("search/native switches preserve other sections and default native files survive plugin disable/reload", async () => {
  const fixture = await skill("native-check", "NATIVE_STANDARD_BODY");
  const prompts: BeforeAgentStartEvent["systemPromptOptions"][] = [];
  const options = { skills: [fixture.metadata], nativeRead: true, pluginEnabled: true,
    setup: (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => pi.on("before_agent_start", event => {
      event.systemPromptOptions.sections.unrelated = "UNRELATED_SECTION_KEEP";
    }),
    observe: (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => pi.on("before_agent_start", event => {
      prompts.push(structuredClone(event.systemPromptOptions));
    }),
  };
  let api: import("@earendil-works/pi-coding-agent").ExtensionAPI;
  const observe = options.observe;
  options.observe = pi => { api = pi; return observe(pi); };
  const f = await isolatedSession("fake", options);
  try {
    const settingsBefore = JSON.stringify(f.session.settingsManager.getSettings());
    await f.session.prompt("Search mode"); assert.equal(prompts.at(-1)!.skills.length, 0);
    await f.session.prompt("/hermes-skills mode native"); assert.equal(f.calls.length, 1);
    await f.session.prompt("Native mode"); assert.equal(prompts.at(-1)!.skills[0]!.name, "native-check");
    assert.equal(prompts.at(-1)!.sections.hermes_skills, undefined);
    assert.equal(prompts.at(-1)!.sections.unrelated, "UNRELATED_SECTION_KEEP");
    await f.session.prompt("/hermes-skills mode search"); await f.session.prompt("Search again");
    assert.equal(prompts.at(-1)!.skills.length, 0);
    assert.equal(prompts.at(-1)!.sections.unrelated, "UNRELATED_SECTION_KEEP");
    options.pluginEnabled = false;
    await f.session.reload(); await f.session.bindExtensions({ mode: "print" });
    assert.ok(!f.session.getActiveToolNames().includes("hermes_skill_search"));
    assert.ok(api!.getCommands().some(c => c.name === "skill:native-check"));
    await f.session.prompt("Plugin disabled"); assert.equal(prompts.at(-1)!.skills[0]!.name, "native-check");
    await f.session.prompt("/skill:native-check Use the standard file");
    assert.ok(JSON.stringify(f.calls.at(-1)).includes("NATIVE_STANDARD_BODY"));
    assert.equal(await readFile(fixture.path, "utf8"), fixture.text);
    assert.equal(JSON.stringify(f.session.settingsManager.getSettings()), settingsBefore);
  } finally { f.session.dispose(); }
});

test("successful review save refreshes plugin immediately; native command catalog changes only on official reload", async () => {
  const native: Skill[] = []; let resolved!: () => void;
  const refreshed = new Promise<void>(resolve => { resolved = resolve; });
  let api: import("@earendil-works/pi-coding-agent").ExtensionAPI;
  const f = await isolatedSession("fake", { skills: native, nativeRead: true,
    observe: pi => { api = pi; },
    skillSources: async request => {
      const loaded = loadSkillsFromDir({ dir: join(request.cwd, ".pi", "skills"), source: "project" }).skills;
      if (loaded.length) native.splice(0, native.length, ...loaded);
      return { version: 1, cwd: request.cwd, projectTrusted: request.projectTrusted, skills: loaded, diagnostics: [] };
    },
    streamReply: context => {
      const user = context.messages.at(-1);
      const text = user?.role === "user" && typeof user.content === "string" ? user.content : "";
      if (!text.includes("Effective evidence:")) return { stopReason: "stop", content: [{ type: "text", text: "Foreground finished" }] };
      const evidence = JSON.parse(text.split("Effective evidence: ")[1]!) as { entryId: string; text: string }[];
      const source = evidence.find(e => e.text.includes("build before checking the release manifest"))!;
      return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ skills: [{
        action: "create", scope: "project", name: "release-check", description: "Check manifest after build",
        body: "Build first; check release manifest second.", reason: "Reusable project correction",
        evidence: [{ entryId: source.entryId, quote: "build before checking the release manifest" }],
      }] }) }] };
    },
  });
  try {
    const ui = f.session.extensionRunner.createCommandContext().ui;
    await f.session.bindExtensions({ mode: "tui", uiContext: { ...ui, input: async () => f.cwd,
      setStatus: (key, value) => { if (key === "hermes-review" && value?.includes("| saved")) resolved(); },
    } });
    await f.session.prompt("For this repo, build before checking the release manifest.");
    assert.equal((await search(f)).items.length, 0);
    await f.session.prompt("/hermes-review run");
    await Promise.race([refreshed, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("save refresh was not delivered")), 4000); timer.unref(); })]);
    // Saved is published only after the success callback has finished refreshing the plugin catalog.
    const hits = (await search(f)).items; assert.equal(hits[0]!.name, "release-check");
    assert.ok(!api!.getCommands().some(c => c.name === "skill:release-check"));
    assert.equal(f.calls.length, 2, "one foreground plus one metered explicit review; no refresh request");
    const records = (await new ReviewLedger(f.agentDir).inspect()).records;
    assert.equal(records.length, 1); assert.equal(records[0]!.status, "saved");
    assert.ok((await f.session.agent.state.tools.find(t => t.name === "hermes_skill_view")!.execute("fixture", { id: hits[0]!.id })).details.content.match(/Build.*first/));
    await f.session.reload(); await f.session.bindExtensions({ mode: "print" });
    assert.ok(api!.getCommands().some(c => c.name === "skill:release-check"));
    await f.session.prompt("/skill:release-check Apply the standard skill");
    assert.match(JSON.stringify(f.calls.at(-1)), /Build.*first/);
  } finally { f.session.dispose(); }
});
