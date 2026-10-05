import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DefaultPackageManager, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = process.argv[2]!;
const cwd = join(root, "project"); const agentDir = join(root, "agent");
for (const path of [join(agentDir, "skills/release-check"), join(cwd, ".pi/skills/release-check")]) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), "---\nname: release-check\ndescription: Scoped release procedure\n---\nSteps.\n");
}
const settings = SettingsManager.inMemory(); settings.setProjectTrusted(true);
const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
const resolved = await manager.resolve(async () => "skip");
const normal = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
  noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true });
await normal.reload();
const disabled = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
  noSkills: true, noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true });
await disabled.reload();
console.log(JSON.stringify({
  configuredEnabled: resolved.skills.filter(r => r.enabled).length,
  normalVisible: normal.getSkills().skills.length,
  collisionReported: normal.getSkills().diagnostics.some(d => d.type === "collision"),
  disabledVisible: disabled.getSkills().skills.length,
  configuredStillEnabled: (await manager.resolve(async () => "skip")).skills.filter(r => r.enabled).length,
  noSkillsInSettings: "noSkills" in settings.getSettings(),
}));
