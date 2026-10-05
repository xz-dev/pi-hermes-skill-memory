import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./context.ts";
import type { ReviewRecord } from "./ledger.ts";

export const REVIEW_CHANNEL = "hermes.review.v1";
// Wire compatibility includes accounting semantics, not just the event name.
export const REVIEW_COMPATIBILITY = "hermes-review-ledger/1;unknown-reservation-carry/1;single-request/1";
export type ReviewTarget = "skills" | "memory";
export interface ReviewBoundary {
  sessionId: string; cwd: string; leafId: string | null; digest: string; provider: string; model: string;
}
export function reviewBoundary(snapshot: Snapshot): ReviewBoundary {
  return { sessionId: snapshot.sessionId, cwd: snapshot.cwd, leafId: snapshot.leafId ?? null,
    digest: snapshot.digest, provider: snapshot.model?.provider ?? "", model: snapshot.model?.id ?? "" };
}
export function boundaryKey(boundary: ReviewBoundary): string {
  return JSON.stringify({ sessionId: boundary.sessionId, cwd: boundary.cwd, leafId: boundary.leafId,
    digest: boundary.digest, provider: boundary.provider, model: boundary.model });
}
export interface ReviewMemoryTarget {
  instruction: string;
  signal: AbortSignal;
  current: () => boolean;
  consume: (value: unknown, requestId: string, guard: { signal: AbortSignal; isCurrent: () => boolean }) => Promise<{ saved: string[]; pending?: string[] }>;
}
export interface ReviewOffer {
  target: ReviewTarget;
  version: 1;
  compatibility: string;
  ledgerRoot: string;
  boundary: ReviewBoundary;
  active: boolean;
  memory?: ReviewMemoryTarget;
  run: (offers: ReviewOffer[]) => Promise<ReviewRecord>;
}
interface Collect {
  type: "collect"; version: 1; boundary: ReviewBoundary; offers: ReviewOffer[]; retryOf?: string;
}

/** Optional, in-process rendezvous. The ledger, not this bounded memo, owns admission. */
export class ReviewCooperation {
  private readonly unsubscribe: () => void;
  private readonly jobs = new Map<string, Promise<ReviewRecord>>();
  private readonly events: ExtensionAPI["events"];
  private readonly knownMemoryInstalled: () => boolean;
  private readonly onConflict: (error: unknown) => Promise<void>;
  constructor(events: ExtensionAPI["events"], offer: (boundary: ReviewBoundary) => ReviewOffer | undefined,
    knownMemoryInstalled: () => boolean = () => false, onConflict: (error: unknown) => Promise<void> = async () => {}) {
    this.events = events; this.knownMemoryInstalled = knownMemoryInstalled; this.onConflict = onConflict;
    this.unsubscribe = events.on(REVIEW_CHANNEL, raw => {
      const event = raw as Partial<Collect> | undefined;
      if (event?.type !== "collect" || event.version !== 1 || !event.boundary || !Array.isArray(event.offers)) return;
      // Local declarations are supplied by the caller so explicit requests remain eligible with auto off.
      if (event.offers.some(offer => offer.target === "skills")) return;
      const own = offer(event.boundary);
      if (own) event.offers.push(this.wrap(own, event.retryOf));
    });
  }
  close(): void { this.unsubscribe(); }
  private wrap(offer: ReviewOffer, retryOf?: string): ReviewOffer {
    const key = `${boundaryKey(offer.boundary)}:${retryOf ?? ""}`;
    return { ...offer, run: async offers => {
      try { this.validate(offer, offers); }
      catch (error) { await this.onConflict(error); throw error; }
      const prior = this.jobs.get(key); if (prior) return prior;
      const job = Promise.resolve().then(() => offer.run(offers));
      this.jobs.set(key, job);
      void job.finally(() => { this.jobs.delete(key); }).catch(() => {});
      return job;
    } };
  }
  async run(local: ReviewOffer, retryOf?: string): Promise<ReviewRecord> {
    const event: Collect = { type: "collect", version: 1, boundary: local.boundary, offers: [this.wrap(local, retryOf)], retryOf };
    this.events.emit(REVIEW_CHANNEL, event);
    if (this.knownMemoryInstalled() && !event.offers.some(offer => offer.target === "memory")) throw new Error("review-protocol-incompatible: installed hermes_memory has no cooperative declaration");
    const active = this.validate(local, event.offers);
    // Fixed IDs, descending: skills owns a joint request; memory owns memory-only work.
    return active[0]!.run(active);
  }
  private validate(local: ReviewOffer, offers: ReviewOffer[]): ReviewOffer[] {
    const seen = new Set<string>();
    for (const offer of offers) {
      if (!offer || !["skills", "memory"].includes(offer.target) || seen.has(offer.target) || offer.version !== 1 ||
        typeof offer.active !== "boolean" || boundaryKey(offer.boundary) !== boundaryKey(local.boundary) ||
        typeof offer.run !== "function") throw new Error("review-protocol-incompatible: duplicate, malformed or mismatched participant");
      seen.add(offer.target);
      if (!offer.active) continue;
      if (offer.compatibility !== REVIEW_COMPATIBILITY || offer.ledgerRoot !== local.ledgerRoot) throw new Error("review-protocol-incompatible: fee/ledger contract differs; no independent paid fallback");
      if (offer.target === "memory" && (!offer.memory || typeof offer.memory.instruction !== "string" ||
        !(offer.memory.signal instanceof AbortSignal) || typeof offer.memory.current !== "function" || typeof offer.memory.consume !== "function")) throw new Error("review-protocol-incompatible: missing memory consumer");
    }
    const active = offers.filter(offer => offer.active).sort((a, b) => b.target.localeCompare(a.target));
    if (!active.length || !active.some(offer => offer.target === local.target)) throw new Error("review-protocol-incompatible: no eligible owner/local participant");
    return active;
  }
}
