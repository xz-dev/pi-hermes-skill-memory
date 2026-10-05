// Read-only location rules for official Pi 0.99.2. No private SDK runtime imports or cache scans.
// Git source parsing is adapted from Pi's MIT-licensed utils/git.ts; see THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import hostedGitInfo from "hosted-git-info";

function splitRef(value: string) {
  const scp = value.match(/^git@([^:]+):(.+)$/);
  const url = !scp && value.includes("://") ? new URL(value) : undefined;
  const prefix = scp ? `git@${scp[1]}:` : url ? "" : value.includes("/") ? value.slice(0, value.indexOf("/") + 1) : "";
  const path = scp ? scp[2]! : url ? url.pathname.replace(/^\/+/, "") : value.slice(prefix.length);
  const index = path.indexOf("@");
  if (index < 1 || index === path.length - 1 || !scp && !url && !prefix) return { repo: value, ref: undefined };
  const ref = path.slice(index + 1), repoPath = path.slice(0, index);
  if (url) { url.pathname = `/${repoPath}`; return { repo: url.toString().replace(/\/$/, ""), ref }; }
  return { repo: prefix + repoPath, ref };
}
function safePart(value: string, slash: boolean) {
  try { return [value, decodeURIComponent(value)].every(part => !part.includes("\0") && !part.includes("\\") && !part.startsWith("/") &&
    (slash || !part.includes("/")) && !part.split("/").includes("..")); } catch { return false; }
}
function gitSource(source: string): { host: string; path: string; ref?: string } | undefined {
  const trimmed = source.trim(), explicit = trimmed.startsWith("git:"), value = explicit ? trimmed.slice(4).trim() : trimmed;
  if (!explicit && !/^(https?|ssh|git):\/\//i.test(value)) return undefined;
  const { repo, ref } = splitRef(value);
  const candidates = [ref ? `${repo}#${ref}` : undefined, value, ref ? `https://${repo}#${ref}` : undefined, `https://${value}`];
  let host = "", path = "", revision = ref;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const info = hostedGitInfo.fromUrl(candidate);
    if (!info || ref && info.project?.includes("@")) continue;
    host = info.domain; path = `${info.user}/${info.project}`; revision = info.committish || ref; break;
  }
  if (!host) {
    const scp = repo.match(/^git@([^:]+):(.+)$/);
    if (scp) { host = scp[1]!; path = scp[2]!; }
    else if (/^(https?|ssh|git):\/\//.test(repo)) { const url = new URL(repo); host = url.hostname; path = url.pathname.replace(/^\/+/, ""); }
    else {
      const slash = repo.indexOf("/"); if (slash < 0) return undefined;
      host = repo.slice(0, slash); path = repo.slice(slash + 1);
      if (!host.includes(".") && host !== "localhost") return undefined;
    }
  }
  if (path.startsWith("/")) return undefined;
  path = path.replace(/\.git$/, "").replace(/^\/+/, "");
  return host && path.split("/").length >= 2 && safePart(host, false) && safePart(path, true) ? { host, path, ref: revision } : undefined;
}
function bounded(root: string, ...parts: string[]) {
  const base = resolve(root), path = resolve(base, ...parts);
  if (path !== base && !path.startsWith(base + sep) || path.includes("\0")) throw new Error("Temporary package location escapes its declared cache root");
  return path;
}

/** Computes one declared source's location, never a guessed directory search or an installation. */
export function stockTemporaryRoot(agentDir: string, source: string): string {
  const cache = join(agentDir, "tmp/extensions");
  if (source.startsWith("npm:")) {
    const spec = source.slice(4).trim(), name = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/)?.[1] ?? spec;
    const bucket = createHash("sha256").update("npm-").digest("hex").slice(0, 8);
    return bounded(join(cache, "npm", bucket, "node_modules"), name);
  }
  const git = gitSource(source);
  if (!git) throw new Error("Unknown cached temporary source; a host restore policy is required");
  const prefix = `git-${git.host}`, bucket = createHash("sha256").update(`${prefix}-${git.path}${git.ref ? `@${git.ref}` : ""}`).digest("hex").slice(0, 8);
  return bounded(join(cache, prefix), bucket, git.path);
}
