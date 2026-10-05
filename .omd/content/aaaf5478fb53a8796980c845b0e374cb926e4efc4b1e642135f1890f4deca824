import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** A worktree is its own project identity; remotes and shared Git dirs never widen scope. */
export async function resolveProjectRoot(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">, selected?: string): Promise<string> {
  if (!ctx.isProjectTrusted()) throw new Error("Project is not trusted; review cannot write project knowledge");
  const cwd = await realpath(ctx.cwd);
  let root: string;
  if (selected) {
    if (!isAbsolute(selected)) throw new Error("Selected project root must be absolute");
    root = await realpath(selected);
  } else {
    const result = await promisify(execFile)("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    root = await realpath(result.stdout.trim());
  }
  const rel = relative(root, cwd);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Selected project root does not contain the working directory");
  return root;
}

export async function selectProjectRoot(ctx: ExtensionCommandContext, selected?: string): Promise<string> {
  try { return await resolveProjectRoot(ctx, selected); }
  catch (error) {
    if (selected || !ctx.isProjectTrusted() || ctx.mode !== "tui") throw error;
    const answer = await ctx.ui.input("Select this non-Git project's root", ctx.cwd);
    if (!answer) throw new Error("No project root selected");
    return resolveProjectRoot(ctx, answer);
  }
}
