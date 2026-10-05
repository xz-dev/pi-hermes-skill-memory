import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, resolve, relative, join, sep, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.new`;
  const file = await open(tmp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally { await file.close(); }
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function scopedDirectory(root: string, path: string, create = false): Promise<string | undefined> {
  const canonicalRoot = await realpath(root);
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Metadata directory escapes selected scope");
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    let canonical: string;
    try { canonical = await realpath(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return undefined;
      await mkdir(current); canonical = await realpath(current);
    }
    if (canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + sep)) throw new Error("Directory escapes selected scope");
  }
  return realpath(current);
}

const queues = new Map<string, Promise<unknown>>();

/** Serialize local users; foreign contention/crash-left locks still fail closed, never reset usage. */
export async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(path);
  const previous = queues.get(key) ?? Promise.resolve();
  const transaction = previous.catch(() => {}).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const lock = await open(path, "wx", 0o600);
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, created: Date.now() }));
      return await action();
    } finally {
      await lock.close();
      await unlink(path);
    }
  });
  queues.set(key, transaction);
  try { return await transaction; }
  finally { if (queues.get(key) === transaction) queues.delete(key); }
}
