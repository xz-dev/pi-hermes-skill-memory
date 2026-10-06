import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./context.ts";
import { REVIEW_LIMITS, ReviewLedger } from "./ledger.ts";
import type { ReviewRecord, ReviewStatus } from "./ledger.ts";
import { ManagedSkillStore, validateProposal } from "./store.ts";
import type { SkillProposal } from "./store.ts";
import { SkillActivityStore, validateFeedback } from "./activity.ts";
import type { SkillFeedback } from "./activity.ts";
import { PendingApproval } from "./permissions.ts";
import { awaitWithAbort } from "./async.ts";
import type { ReviewMemoryTarget, ReviewTarget } from "./cooperation.ts";

export const REVIEW_INSTRUCTION = `Review current effective conversation once. Return JSON only: {"skills":[]},
  or {"skills":[{"action":"create","scope":"project","name":"lowercase-hyphen-name",
  "description":"brief use condition","body":"reusable steps, not task diary",
  "reason":"why reusable","evidence":[{"entryId":"supplied ID","quote":"exact evidence substring"}]}]}.
  Use project for project-specific rules. Global requires crossProject explanation.
  Search the supplied managed-note candidates first: revise an existing note for a repeated lesson before creating a new one.
  For updates use action:update with the exact read SkillId in id and baseVersion; preserve scope/name.
  Repeated lessons revise the same read rule and link new evidence; never create duplicate skills or date-named references for the same lesson.
  Supporting files need file/content and their own read baseVersion when replacing existing bytes.
  When the current policy marks an installed target notes-only, keep that original unchanged and submit an ordinary managed note
  carrying the lesson instead; include the original skill's name in the note name or description so it stays searchable.
  If no managed note candidate was actually read, do not claim one was updated; create a new note or report none.
  Use procedureTemplate:"build-before-manifest" only for an evidenced build-before-manifest instruction: the host renders instructions, not claims that work ran.
  contentKind:"source-report" quotes attributed source material, not independently certified execution results.
  Optional feedback:[{id:"exact read SkillId",version:"read hash",use:true,outcome:"success|failure|unknown",evidence:[{entryId:"ID",quote:"exact substring"}]}]
  reports foreground use/outcomes, not independently confirmed success. Do not report review's own reads as use. No request solely for feedback.
  No secrets, invented success claims, temporary instructions, tool calls or other operations.
  If nothing useful, return empty skills. Do not claim an unrun test passed.
  An installed improvement may instead be one item {"proposal":{...},"managedAlternative":{...}}:
  the host selects one destination only by current policy/decision. The alternative is an ordinary
  managed note, never another installed target; a flat proposal remains supported. Never split one
  improvement into separate original/alternative items. Alternatives need the same valid evidence,
  scope safeguards and actual prior read/version for updates. No alternative means redirect needs continuation.`;

/** One-request service. No automatic scheduling or model fallback. */
export async function reviewSkills(options: {
  cooperation?: { boundary: string; targets: ReviewTarget[]; owner: string; memory?: ReviewMemoryTarget };
  curation?: { keepId: string; absorbId: string };
  snapshot: Snapshot;
  registry: Pick<ExtensionContext["modelRegistry"], "streamSimple">;
  ledger: ReviewLedger; store: ManagedSkillStore;
  signal?: AbortSignal; timeoutMs?: number; retryOf?: string;
  isCurrent?: () => boolean;
  onSaved?: () => Promise<void>;
  reportFeedback?: (feedback: SkillFeedback, snapshot: Snapshot, guard: { signal: AbortSignal; isCurrent: () => boolean; requestId: string }) => Promise<void>;
  /** Caller-supplied bounded policy/candidate context for THIS request only; charged inside the original input estimate. */
  briefing?: (snapshot: Snapshot) => Promise<string>;
  submit?: (proposal: SkillProposal, snapshot: Snapshot, requestId: string, guard: { signal?: AbortSignal; isCurrent?: () => boolean }, managedAlternative?: SkillProposal) =>
    Promise<{ id: string } | { status: "redirect"; saved: false; [key: string]: unknown }>;
  preflight?: (proposal: SkillProposal, alternative: SkillProposal | undefined, snapshot: Snapshot) => Promise<void>;
  authorizeCommit?: (target?: { path: string; version: string }) => Promise<void>;
}): Promise<ReviewRecord> {
  const { snapshot, registry, ledger, store } = options;
  if (!snapshot.model) throw new Error("No selected model");
  const timeoutMs = options.timeoutMs ?? REVIEW_LIMITS.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REVIEW_LIMITS.timeoutMs) throw new Error("Timeout can only tighten the global limit");
  options.signal?.throwIfAborted();
  options.cooperation?.memory?.signal.throwIfAborted();
  if (options.cooperation?.memory?.current() === false) throw new Error("Stale review participation");
  try { await store.assertReady(); }
  catch (error) {
    const reason = /store-recovery/.test(String(error)) ? String(error) : `store-check-failed: ${String(error)}`;
    const skipped = await ledger.skip(snapshot, snapshot.model, reason.slice(0, 1000));
    await ledger.pause(reason.slice(0, 500));
    return skipped;
  }
  const messages = structuredClone(snapshot.messages);
  const briefing = options.briefing ? (await options.briefing(snapshot)).slice(0, 8000) : "";
  messages.push({ role: "user", content: `${REVIEW_INSTRUCTION}${options.curation ? `\nExplicit semantic curation ONLY: return zero or one update to ${options.curation.keepId}. The other skill ${options.curation.absorbId} is NOT directly edited/deleted. No feedback; background reading is not use.` : ""}` +
    (briefing ? `\nCurrent installed-write policy and managed-note candidates (metadata only, not authorization):\n${briefing}` : "") +
    `\nEffective evidence: ${JSON.stringify(snapshot.evidence)}` +
    (options.cooperation?.memory ? `\nAlso classify the memory target in the same JSON object's memory field. Memory participant instruction/evidence:\n${options.cooperation.memory.instruction}` : ""), timestamp: Date.now() });
  // ponytail: Conservative UTF-8 byte estimate, not a measured token count.
  const input = Buffer.byteLength(JSON.stringify(messages));
  const record = await ledger.admit(snapshot, snapshot.model, input, Date.now(), options.retryOf, options.cooperation);
  if (record.status === "skipped") return record;
  await ledger.running(record.id);
  let usage: Usage | undefined; let costUnknown = true;
  let terminal: Promise<ReviewRecord> | undefined;
  const saved: string[] = [], pending: string[] = [];
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("review-timeout")), timeoutMs);
  const signal = AbortSignal.any([deadline.signal, ...options.signal ? [options.signal] : [], ...options.cooperation?.memory ? [options.cooperation.memory.signal] : []]);
  const isCurrent = () => {
    try { return !signal.aborted && options.isCurrent?.() !== false && options.cooperation?.memory?.current() !== false; }
    catch { return false; }
  };
  const finish = (status: ReviewStatus, reason?: string) => {
    terminal = ledger.finish(record.id, status, usage, saved, reason, costUnknown);
    return terminal;
  };
  try {
    signal.throwIfAborted();
    const response = registry.streamSimple(snapshot.model, { messages }, {
      maxRetries: 0, maxTokens: REVIEW_LIMITS.output, toolChoice: "none", signal,
      reasoning: snapshot.thinking === "off" ? undefined : snapshot.thinking,
    }).result();
    const observed = response.then(async result => {
      usage = result.usage;
      costUnknown = !Number.isFinite(usage?.cost?.total) ||
        Object.values(snapshot.model!.cost).every(rate => typeof rate !== "number" || rate === 0);
      // A provider may ignore cancellation. Late response can settle usage only.
      if (signal.aborted && terminal) {
        await terminal;
        await ledger.finish(record.id, "cancelled", usage, [], "late-usage-only", costUnknown);
      }
      return result;
    });
    const result: AssistantMessage = await awaitWithAbort(observed, signal);
    if (!isCurrent()) return await finish("cancelled", "stale-or-cancelled");
    if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error(result.errorMessage ?? result.stopReason);
    if (result.stopReason !== "stop" || result.content.some(c => c.type === "toolCall")) throw new Error("Incomplete or tool-request output");
    const text = result.content.filter(c => c.type === "text").map(c => c.text).join("");
    if (!text.trim()) return await finish("no-proposal", "empty-or-reasoning-only");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !("skills" in parsed) || !Array.isArray(parsed.skills) || parsed.skills.length > 4) throw new Error("Invalid skill response");
    if (options.cooperation?.memory && !("memory" in parsed)) throw new Error("Missing classified memory result");
    const proposals = parsed.skills.map(value => {
      if (value && typeof value === "object" && "proposal" in value) {
        if (Object.keys(value).some(key => !["proposal", "managedAlternative"].includes(key))) throw new Error("Invalid improvement envelope");
        return { proposal: validateProposal(value.proposal, snapshot), managedAlternative: value.managedAlternative === undefined ? undefined : validateProposal(value.managedAlternative, snapshot) };
      }
      return { proposal: validateProposal(value, snapshot), managedAlternative: undefined };
    });
    const reports = "feedback" in parsed ? parsed.feedback : [];
    if (!Array.isArray(reports) || reports.length > 16) throw new Error("Invalid or excessive skill feedback");
    if (options.curation && (proposals.length > 1 || proposals.some(({ proposal, managedAlternative }) => managedAlternative || proposal.action !== "update" || proposal.id !== options.curation!.keepId) || reports.length)) throw new Error("Curation response must contain at most one keep update and no feedback");
    const feedback = reports.map(value => validateFeedback(value, snapshot));
    if (!proposals.length && !feedback.length && !options.cooperation?.memory) return await finish("no-change");
    // Validate candidate destinations for the entire response before feedback or any write.
    for (const { proposal, managedAlternative } of proposals) await options.preflight?.(proposal, managedAlternative, snapshot);
    for (const report of feedback) {
      signal.throwIfAborted();
      const guard = { signal, isCurrent, requestId: record.id };
      if (options.reportFeedback) await options.reportFeedback(report, snapshot, guard);
      else await new SkillActivityStore(store.agentDir).report(report, snapshot, guard.isCurrent, record.id);
    }
    for (const { proposal, managedAlternative } of proposals) {
      signal.throwIfAborted();
      if (!isCurrent()) return await finish("cancelled", "stale-result");
      try {
        // Do not declare a terminal storage outcome until the controlled writer has exited.
        const guard = { signal, isCurrent, authorize: options.authorizeCommit };
        const outcome = await (options.submit ? options.submit(proposal, snapshot, record.id, guard, managedAlternative) : managedAlternative ? Promise.reject(new Error("Managed alternative requires host destination policy")) : store.submitModel(proposal, snapshot, record.id, guard));
        if (outcome && typeof outcome === "object" && "status" in outcome && outcome.status === "redirect") {
          // A policy/directive redirect is a transcription intent, never a saved id; keep this request's accounting honest.
          pending.push(`redirect: ${(outcome as { targetId?: string }).targetId ?? proposal.id ?? proposal.name}`);
          continue;
        }
        saved.push((outcome as { id: string }).id);
        if (options.onSaved) await awaitWithAbort(options.onSaved(), signal);
      }
      catch (error) {
        if (error instanceof PendingApproval) { pending.push(error.message); continue; }
        if (/conflict|Unowned|pinned|version not read|identity\/version not read|Read-only/i.test(String(error))) return await finish("conflict", String(error));
        throw error;
      }
    }
    if (options.cooperation?.memory) {
      if (!isCurrent()) return await finish("cancelled", "stale-participant");
      const result = await options.cooperation.memory.consume("memory" in parsed ? parsed.memory : undefined, record.id, { signal, isCurrent });
      if (!Array.isArray(result.saved) || result.saved.some(id => typeof id !== "string") ||
        result.pending && (!Array.isArray(result.pending) || result.pending.some(item => typeof item !== "string"))) throw new Error("Invalid memory commit receipt");
      saved.push(...result.saved); pending.push(...result.pending ?? []);
      if (!isCurrent()) return await finish("cancelled", "stale-participant");
    }
    return await finish(pending.length ? "pending" : saved.length ? "saved" : "no-change",
      pending.length ? pending.join("\n") : feedback.length ? `model-reports:${feedback.length}; unconfirmed, no independent success certification` : undefined);
  } catch (error) {
    if (error && typeof error === "object" && "usage" in error) usage = error.usage as Usage;
    return await finish(deadline.signal.aborted ? "failed" : !isCurrent() || /Stale commit/.test(String(error)) ? "cancelled" : "failed", String(error));
  } finally { clearTimeout(timer); }
}
