import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, readJson, scopedDirectory, withLock } from "./files.ts";
import { awaitWithAbort } from "./async.ts";
import { fingerprint } from "./context.ts";
import type { Snapshot } from "./context.ts";

export interface SkillFeedback {
  id: string; version: string; use: boolean; outcome: "success" | "failure" | "unknown";
  evidence: { entryId: string; quote: string }[];
}
const counters = ["views", "userUses", "reportedUses", "reportedSuccess", "reportedFailure", "confirmedSuccess", "confirmedFailure"] as const;
export type SkillActivity = Record<typeof counters[number], number> & { pinned?: boolean; lastView?: number; lastUse?: number };
interface ActivityEvent {
  key: string; id: string; version: string; kind: "view" | "use" | "outcome" | "report" | "pin";
  origin: "foreground" | "user" | "model-report"; sessionId: string; leafId: string | null; timestamp: number;
  outcome?: string; reason?: string; evidence?: SkillFeedback["evidence"]; requestId?: string; use?: boolean;
}
interface ActivityState { version: 1; skills: Record<string, SkillActivity>; seen: string[]; journal: ActivityEvent[]; seenEvicted?: number; journalEvicted?: number }
const empty = (): SkillActivity => ({ views: 0, userUses: 0, reportedUses: 0, reportedSuccess: 0, reportedFailure: 0, confirmedSuccess: 0, confirmedFailure: 0 });

export function validateFeedback(value: unknown, snapshot: Snapshot): SkillFeedback {
  const row = value as SkillFeedback;
  if (!row || typeof row.id !== "string" || !row.id || row.id.length > 2000 || !/^[a-f0-9]{64}$/.test(row.version) || typeof row.use !== "boolean" ||
    !["success", "failure", "unknown"].includes(row.outcome) || !Array.isArray(row.evidence) || !row.evidence.length || row.evidence.length > 8)
    throw new Error("Invalid skill feedback");
  if (!snapshot.skillReads?.some(read => read.id === row.id && read.version === row.version)) throw new Error("Reported skill identity/version not read in current snapshot");
  for (const source of row.evidence) {
    if (!source || typeof source.entryId !== "string" || source.entryId.length > 2000 || typeof source.quote !== "string" || !source.quote.trim() || source.quote.length > 2000 ||
      !snapshot.evidence.some(entry => entry.entryId === source.entryId && entry.text.includes(source.quote))) throw new Error("Reported outcome evidence not in effective snapshot");
  }
  return structuredClone(row); // An existing citation proves attribution, not task success.
}

/** Local evidence counters, never a success oracle or a provider/scheduler. Pin is set only by a user command. */
export class SkillActivityStore {
  readonly agentDir: string;
  constructor(agentDir: string) { this.agentDir = agentDir; }
  private directory() { return join(this.agentDir, "hermes-skills", "provenance", "activity"); }
  private async read(): Promise<ActivityState> {
    const directory = this.directory();
    if (!await scopedDirectory(this.agentDir, directory)) return { version: 1, skills: {}, seen: [], journal: [] };
    let value: ActivityState;
    try { value = await readJson(join(directory, "state.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if ((await readdir(directory)).some(file => !["state.lock", "pins.json", "pins.initialized"].includes(file))) throw new Error("Activity state missing; refusing to reset pins/counters");
      return { version: 1, skills: {}, seen: [], journal: [] };
    }
    if (value.version !== 1 || !value.skills || typeof value.skills !== "object" || Array.isArray(value.skills) || !Array.isArray(value.seen) || !Array.isArray(value.journal) ||
      value.journal.length > 128 || value.seen.some(key => typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) || !Number.isSafeInteger(value.seenEvicted ?? 0) || (value.seenEvicted ?? 0) < 0 ||
      !Number.isSafeInteger(value.journalEvicted ?? 0) || (value.journalEvicted ?? 0) < 0 || Object.values(value.skills).some(row => counters.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0) ||
        row.pinned !== undefined && typeof row.pinned !== "boolean")) throw new Error("Invalid activity state; writes blocked");
    return value;
  }
  private async change(event: ActivityEvent, apply: (row: SkillActivity) => void, current?: () => boolean, authorize?: () => Promise<void>, signal?: AbortSignal) {
    const directory = this.directory(); await scopedDirectory(this.agentDir, directory, true);
    return withLock(join(directory, "state.lock"), async () => {
      const value = await this.read();
      if (authorize) { const authorization = authorize(); await (signal ? awaitWithAbort(authorization, signal) : authorization); }
      signal?.throwIfAborted();
      if (current?.() === false) throw new Error("Stale activity eligibility");
      if (value.seen.includes(event.key)) return;
      if ((value.seenEvicted ?? 0) > 0) throw new Error("Historical dedup receipts were previously evicted; statistics incomplete, no silent reset");
      const row = value.skills[event.id] ?? empty(); apply(row); value.skills[event.id] = row;
      value.seen.push(event.key); value.journal.push(event);
      // Exact all-history fingerprints grow locally; only the display journal is bounded.
      const boundedSize = () => JSON.stringify({ ...value, seen: [] }).length;
      while (value.journal.length > 128 || boundedSize() > 1_000_000 && value.journal.length > 1) {
        value.journal.shift(); value.journalEvicted = (value.journalEvicted ?? 0) + 1;
      }
      if (boundedSize() > 1_000_000) throw new Error("Activity capacity exhausted; pins and counters retained");
      await open(join(directory, "initialized"), "a", 0o600).then(file => file.close());
      await atomicJson(join(directory, "state.json"), value);
    });
  }
  private async pins(): Promise<Record<string, { pinned: boolean; version: string; sessionId: string; reason: string }>> {
    const directory = this.directory();
    if (!await scopedDirectory(this.agentDir, directory)) return {};
    try {
      const value = await readJson<Record<string, { pinned: boolean; version: string; sessionId: string; reason: string }>>(join(directory, "pins.json"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(row => !row || typeof row !== "object" || typeof row.pinned !== "boolean" || !/^[a-f0-9]{64}$/.test(row.version) ||
        typeof row.sessionId !== "string" || typeof row.reason !== "string")) throw new Error("Invalid pin policy; writes blocked");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if ((await readdir(directory)).includes("pins.initialized")) throw new Error("Pin policy missing; do not reset protection");
      return {};
    }
  }
  async assertReady() {
    const value = await this.read(); await this.pins();
    if ((value.seenEvicted ?? 0) > 0) throw new Error("Historical dedup receipts missing; pause feedback, do not claim complete statistics");
  }
  async inspect(id: string) {
    const value = await this.read();
    return { ...structuredClone(value.skills[id] ?? empty()), pinned: await this.pinned(id), journal: value.journal.filter(event => event.id === id),
      dedup: { retained: value.seen.length, limit: null, evicted: value.seenEvicted ?? 0, complete: !(value.seenEvicted ?? 0), scope: "persistent all-history fingerprints; grows with history" },
      journalRetention: { retained: value.journal.length, limit: 128, evicted: value.journalEvicted ?? 0, cumulativeCountersPreserved: true } };
  }
  async pinned(id: string, fallback = false) { return (await this.pins())[id]?.pinned ?? (await this.read()).skills[id]?.pinned ?? fallback; }
  private event(id: string, version: string, kind: ActivityEvent["kind"], origin: ActivityEvent["origin"], snapshot: Pick<Snapshot, "sessionId" | "leafId">,
    identity: unknown, extra: Partial<ActivityEvent> = {}): ActivityEvent {
    return { key: fingerprint({ id, version, kind, origin, sessionId: snapshot.sessionId, identity }), id, version, kind, origin,
      sessionId: snapshot.sessionId, leafId: snapshot.leafId, timestamp: Date.now(), ...extra };
  }
  async view(id: string, version: string, snapshot: Pick<Snapshot, "sessionId" | "leafId">, callId: string, file: string, offset: number) {
    await this.change(this.event(id, version, "view", "foreground", snapshot, { callId, file, offset }), row => { row.views++; row.lastView = Date.now(); });
  }
  async user(id: string, version: string, kind: "use" | "outcome" | "pin", snapshot: Snapshot, reason: string, value?: "success" | "failure" | boolean) {
    if (!reason.trim() || reason.length > 2000) throw new Error("User activity needs a bounded explicit reason");
    if (kind === "pin") {
      if (typeof value !== "boolean") throw new Error("Explicit pin/unpin required");
      const directory = this.directory(); await scopedDirectory(this.agentDir, directory, true);
      await withLock(join(directory, "state.lock"), async () => {
        const pins = await this.pins(); pins[id] = { pinned: value, version, sessionId: snapshot.sessionId, reason };
        await open(join(directory, "pins.initialized"), "a", 0o600).then(file => file.close());
        await atomicJson(join(directory, "pins.json"), pins);
      }); return; // Protection policy cannot be exhausted by viewing/feedback statistics.
    }
    const event = this.event(id, version, kind, "user", snapshot, { leafId: snapshot.leafId, reason, value, operation: randomUUID() }, { reason, ...(kind === "outcome" ? { outcome: String(value) } : {}) });
    await this.change(event, row => {
      if (kind === "use") { row.userUses++; row.lastUse = Date.now(); }
      else if (value === "success") row.confirmedSuccess++;
      else if (value === "failure") row.confirmedFailure++;
      else throw new Error("Explicit outcome success/failure required");
    });
  }
  async report(feedback: SkillFeedback, snapshot: Snapshot, current?: () => boolean, requestId?: string, authorize?: () => Promise<void>, signal?: AbortSignal) {
    const row = validateFeedback(feedback, snapshot);
    const evidence = [...new Map(row.evidence.map(item => [JSON.stringify([item.entryId, item.quote]), item])).entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item);
    const event = this.event(row.id, row.version, "report", "model-report", snapshot, { use: row.use, outcome: row.outcome, evidence },
      { outcome: row.outcome, use: row.use, evidence: row.evidence, ...(requestId ? { requestId } : {}) });
    await this.change(event, activity => {
      if (row.use) { activity.reportedUses++; activity.lastUse = Date.now(); }
      if (row.outcome === "success") activity.reportedSuccess++;
      if (row.outcome === "failure") activity.reportedFailure++;
    }, current, authorize, signal);
  }
}
