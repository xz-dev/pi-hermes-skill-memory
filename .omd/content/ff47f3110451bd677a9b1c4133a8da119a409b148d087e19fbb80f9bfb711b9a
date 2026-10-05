// Read-only stock CLI temporary-package resolution, using only the public SDK.
// PI_OFFLINE is child-scoped so missing packages and unpinned Git sources never install/fetch.
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
if (process.env.PI_OFFLINE !== "1") throw new Error("Source resolver requires child-scoped offline mode");
const [cwd, agentDir, encoded] = process.argv.slice(2);
const settings = SettingsManager.inMemory();
const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
const result = await manager.resolveExtensionSources(JSON.parse(encoded), { temporary: true });
process.stdout.write(JSON.stringify(result.skills));
