import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import type { Usage } from "@earendil-works/pi-ai";
import { atomicJson, readJson, withLock } from "./files.ts";

export const REVIEW_LIMITS = {
  input: 64000, output: 4096, timeoutMs: 90000,
  dailyJobs: 4, dailyInput: 256000, dailyOutput: 16384,
};
export type ReviewStatus = "admitted" | "running" | "skipped" | "no-proposal" | "no-change" | "pending" | "conflict" | "saved" | "failed" | "cancelled";
export interface ReviewRecord {
  id: string; digest: string; sessionId: string; project: string;
  provider: string; model: string; day: string; started: number; ended?: number;
  status: ReviewStatus; reservation: { input: number; output: number };
  usage?: Usage; reportedUsage?: Usage; usageUnknown: boolean; costUnknown: boolean;
  estimateKind: "utf8-bytes-as-token-upper-estimate";
  reason?: string; saved: string[];
  ownerPid: number; retryOf?: string;
  targets?: ("skills" | "memory")[]; reviewOwner?: string; boundary?: string;
}
export interface ReviewState { version: 1; lastDay: string; paused?: string; records: ReviewRecord[]; reused: string[]; acknowledged?: string[];
  autoEnabled?: boolean; projectRoots?: Record<string, string>;
}

const statuses = new Set<ReviewStatus>(["admitted", "running", "skipped", "no-proposal", "no-change", "pending", "conflict", "saved", "failed", "cancelled"]);
function validUsage(usage: Usage | undefined): usage is Usage {
  return !!usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens]
    .every(n => Number.isFinite(n) && n >= 0) && usage.totalTokens > 0;
}
function validateState(value: ReviewState): void {
  if (value?.version !== 1 || typeof value.lastDay !== "string" || !Array.isArray(value.records) || !Array.isArray(value.reused)) throw new Error("Review ledger invalid; refusing to reset usage");
  if (value.autoEnabled !== undefined && typeof value.autoEnabled !== "boolean") throw new Error("Invalid automatic review state");
  if (value.projectRoots !== undefined && (!value.projectRoots || Array.isArray(value.projectRoots) || typeof value.projectRoots !== "object" ||
    Object.values(value.projectRoots).some(root => typeof root !== "string" || !root.startsWith("/")))) throw new Error("Invalid selected project roots");
  const ids = new Set<string>();
  for (const r of value.records) {
    if (!r || typeof r.id !== "string" || ids.has(r.id) || !statuses.has(r.status) ||
      typeof r.digest !== "string" || typeof r.sessionId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
      !Number.isFinite(r.started) || !Number.isSafeInteger(r.ownerPid) ||
      ![r.reservation?.input, r.reservation?.output].every(n => Number.isSafeInteger(n) && n >= 0) ||
      typeof r.usageUnknown !== "boolean" || !Array.isArray(r.saved) ||
      (!r.usageUnknown && r.status !== "skipped" && !validUsage(r.usage))) throw new Error("Review record corrupt; refusing new requests");
    if ((r.boundary !== undefined || r.targets !== undefined || r.reviewOwner !== undefined) &&
      (typeof r.boundary !== "string" || !r.boundary || !Array.isArray(r.targets) || !r.targets.length || r.targets.length > 2 ||
        new Set(r.targets).size !== r.targets.length || r.targets.some(target => target !== "skills" && target !== "memory") ||
        !r.targets.includes(r.reviewOwner as "skills" | "memory"))) throw new Error("Review participation record corrupt; refusing new requests");
    ids.add(r.id);
  }
}
function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export class ReviewLedger {
  readonly root: string;
  private listeners = new Set<(state: ReviewState) => void>();
  constructor(agentDir: string) { this.root = join(agentDir, "hermes-review"); }
  subscribe(listener: (state: ReviewState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async transaction<T>(action: (state: ReviewState) => T | Promise<T>): Promise<T> {
    return withLock(join(this.root, "ledger.lock"), async () => {
      const path = join(this.root, "ledger.json");
      let state: ReviewState;
      const files = await readdir(this.root);
      if (!files.includes("ledger.json")) {
        if (files.some(name => name !== "ledger.lock")) throw new Error("Review ledger missing; refusing to reset usage");
        await writeFile(join(this.root, "initialized"), "hermes.review.v1\n", { flag: "wx", mode: 0o600 });
        state = { version: 1, lastDay: "", records: [], reused: [] };
      } else {
        state = await readJson<ReviewState>(path);
        validateState(state);
      }
      let recovered = false;
      for (const record of state.records) {
        if ((record.status === "running" || record.status === "admitted") &&
          (!processExists(record.ownerPid) || Date.now() - record.started > REVIEW_LIMITS.timeoutMs + 10000)) {
          Object.assign(record, { status: "failed", ended: Date.now(), usageUnknown: true, reason: "interrupted-usage-unknown" });
          state.paused = "interrupted-usage-unknown";
          recovered = true;
        }
      }
      // Recovery is durable even when the following admission is denied.
      if (recovered) await atomicJson(path, state);
      const result = await action(state);
      await atomicJson(path, state);
      for (const listener of this.listeners) {
        try { listener(structuredClone(state)); }
        catch { this.listeners.delete(listener); } // Losing UI must not lose accounting.
      }
      return result;
    });
  }

  async inspect(): Promise<ReviewState> {
    return this.transaction(state => structuredClone(state));
  }

  async admit(snapshot: { digest: string; sessionId: string; cwd: string },
    model: { provider: string; id: string }, input: number, now = Date.now(), retryOf?: string,
    cooperation?: { boundary: string; targets: ("skills" | "memory")[]; owner: string }): Promise<ReviewRecord> {
    if (!Number.isSafeInteger(input) || input < 0) throw new Error("Invalid input estimate");
    return this.transaction(state => {
      const day = [new Date(now).toISOString().slice(0, 10), state.lastDay].sort().at(-1)!;
      state.lastDay = day;
      const running = state.records.filter(r => r.status === "admitted" || r.status === "running");
      if (running.length) throw new Error("Review already running or unresolved; no new request");
      const prior = state.records.find(r => r.sessionId === snapshot.sessionId &&
        (r.digest === snapshot.digest || cooperation && r.boundary === cooperation.boundary));
      if (prior && !retryOf) throw new Error(`Snapshot already handled by ${prior.id}`);
      if (retryOf && !state.records.some(r => r.id === retryOf && r.digest === snapshot.digest && r.sessionId === snapshot.sessionId && r.ended !== undefined)) throw new Error("Retry does not identify a completed request for this snapshot");
      if (state.paused && !retryOf) throw new Error(`Review paused: ${state.paused}`);
      const charged = state.records.filter(r => r.status !== "skipped" && (r.day === day || r.usageUnknown));
      const inputUsed = charged.reduce((sum, r) => sum + (r.usageUnknown ? r.reservation.input : r.usage!.input + r.usage!.cacheRead + r.usage!.cacheWrite), 0);
      const outputUsed = charged.reduce((sum, r) => sum + (r.usageUnknown ? r.reservation.output : r.usage!.output), 0);
      const over = input > REVIEW_LIMITS.input || charged.length >= REVIEW_LIMITS.dailyJobs ||
        inputUsed + input > REVIEW_LIMITS.dailyInput || outputUsed + REVIEW_LIMITS.output > REVIEW_LIMITS.dailyOutput;
      const record: ReviewRecord = {
        id: randomUUID(), digest: snapshot.digest, sessionId: snapshot.sessionId, project: snapshot.cwd,
        provider: model.provider, model: model.id, day, started: now,
        status: over ? "skipped" : "admitted", reason: over ? "skipped-budget" : undefined,
        reservation: { input: over ? 0 : input, output: over ? 0 : REVIEW_LIMITS.output },
        usageUnknown: !over, costUnknown: true, saved: [], ownerPid: process.pid, retryOf,
        estimateKind: "utf8-bytes-as-token-upper-estimate",
        ...(cooperation ? { boundary: cooperation.boundary, targets: cooperation.targets, reviewOwner: cooperation.owner } : {}),
      };
      state.records.push(record);
      return structuredClone(record);
    });
  }

  async running(id: string): Promise<void> {
    await this.transaction(state => {
      const record = state.records.find(r => r.id === id);
      if (!record || record.status !== "admitted" || record.ownerPid !== process.pid) throw new Error("Request not admitted to this process");
      record.status = "running";
    });
  }

  async finish(id: string, status: ReviewStatus, usage: Usage | undefined,
    saved: string[], reason?: string, costUnknown = true): Promise<ReviewRecord> {
    return this.transaction(state => {
      const record = state.records.find(r => r.id === id);
      if (!record) throw new Error("Unknown request");
      if (record.ended !== undefined && (!record.usageUnknown || !validUsage(usage))) return structuredClone(record);
      const known = validUsage(usage);
      if (record.ended !== undefined) {
        // Late usage reconciles the old request only; it cannot revive a cancelled/failed job.
        Object.assign(record, { usage: structuredClone(usage), reportedUsage: structuredClone(usage), usageUnknown: false, costUnknown });
        if (usage!.input + usage!.cacheRead + usage!.cacheWrite > record.reservation.input || usage!.output > record.reservation.output) state.paused = "usage-over-reservation";
        return structuredClone(record);
      }
      Object.assign(record, { status, ended: Date.now(), usage: known ? structuredClone(usage) : undefined,
        reportedUsage: usage ? structuredClone(usage) : undefined,
        usageUnknown: !known, costUnknown, saved, reason });
      const over = known && (usage.input + usage.cacheRead + usage.cacheWrite > record.reservation.input ||
        usage.output > record.reservation.output);
      if (status === "failed" || !known || over) state.paused = reason ?? (over ? "usage-over-reservation" : "usage-unknown");
      return structuredClone(record);
    });
  }

  async configureAutomatic(enabled: boolean, project?: { cwd: string; root: string }): Promise<void> {
    await this.transaction(state => {
      state.autoEnabled = enabled;
      if (project) state.projectRoots = { ...state.projectRoots, [project.cwd]: project.root };
    });
  }

  async skip(snapshot: { digest: string; sessionId: string; cwd: string }, model: { provider: string; id: string } | undefined,
    reason: string): Promise<ReviewRecord> {
    return this.transaction(state => {
      const prior = state.records.find(r => r.digest === snapshot.digest && r.sessionId === snapshot.sessionId);
      if (prior) return structuredClone(prior);
      const record: ReviewRecord = { id: randomUUID(), digest: snapshot.digest, sessionId: snapshot.sessionId, project: snapshot.cwd,
        provider: model?.provider ?? "unknown", model: model?.id ?? "unknown", day: new Date().toISOString().slice(0, 10),
        started: Date.now(), ended: Date.now(), status: "skipped", reason, reservation: { input: 0, output: 0 },
        usageUnknown: false, costUnknown: true, saved: [], ownerPid: process.pid,
        estimateKind: "utf8-bytes-as-token-upper-estimate" };
      state.records.push(record);
      return structuredClone(record);
    });
  }

  async pause(reason = "user-paused"): Promise<void> {
    await this.transaction(state => { state.paused = reason; });
  }

  async resume(): Promise<void> {
    await this.transaction(state => {
      // Acknowledgment does not assert that unresolved requests cost zero.
      state.acknowledged = state.records.filter(r => r.status === "failed" || r.usageUnknown).map(r => r.id);
      delete state.paused;
    });
  }

  async reused(id: string): Promise<void> {
    await this.transaction(state => { if (!state.reused.includes(id)) state.reused.push(id); });
  }
}
