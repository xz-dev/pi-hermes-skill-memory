import type { SkillProposal } from "./store.ts";
import type { Snapshot } from "./context.ts";

export interface ContentProof {
  kind: "procedure-template" | "source-report" | "user-approved" | "restored-version";
  restoredFrom?: string;
  template?: "build-before-manifest";
  sources: { entryId: string; role: string; quote: string }[];
}

function sourceRole(entry: Snapshot["evidence"][number]): string {
  try {
    const messages: unknown = JSON.parse(entry.text);
    if (Array.isArray(messages) && messages.length && messages.every(message => message.role === "user")) return "user";
    if (Array.isArray(messages) && messages.length && messages.every(message => message.role === "toolResult")) return "tool-report";
  } catch { /* Unclassified evidence remains a source report, not an execution certification. */ }
  return "source-report";
}

function userText(entry: Snapshot["evidence"][number]): string | undefined {
  try {
    const messages = JSON.parse(entry.text);
    if (!Array.isArray(messages) || !messages.length || !messages.every(message => message?.role === "user")) return;
    return messages.map(message => typeof message.content === "string" ? message.content : Array.isArray(message.content) ?
      message.content.filter((part: { type?: string }) => part?.type === "text").map((part: { text: string }) => part.text).join("\n") : "").join("\n");
  } catch { return; }
}

const normalize = (text: string) => text.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
const instruction = /^(?:for this repo,? )?(?:please )?(?:build(?: this repo)? before (?:checking (?:the )?)?(?:release )?manifest(?: check)?|build(?: this repo)? first,? then check (?:the )?(?:release )?manifest)$/;
const paraphrases = new Set([
  "build first; check release manifest second", "build this repo first, then check the release manifest. no deployment authorization",
  "build this repo first, then check release manifest. not a deployment authorization",
  "build before manifest check. then validate the build output", "build before manifest check. validate the built manifest",
]);

/** Only attributed excerpts and this finite host-rendered procedure are automatic; other prose stays pending. */
export function assessContent(proposal: SkillProposal, snapshot: Snapshot): { proposal: SkillProposal; proof?: ContentProof; reason?: string } {
  const sources = proposal.evidence.map(item => {
    const entry = snapshot.evidence.find(entry => entry.entryId === item.entryId && entry.text.includes(item.quote));
    if (!entry) throw new Error("Content evidence not in effective snapshot");
    return { ...item, role: sourceRole(entry) };
  });
  if (proposal.contentKind === "source-report" && !proposal.files?.length || !proposal.files?.length && sources.some(source => source.role === "user" && source.quote.trim() === proposal.body.trim()) && !instruction.test(normalize(proposal.body)) && !/passed|succeeded|successful|测试已通过|已完成测试/i.test(proposal.body)) {
    const body = ["Source-reported excerpts — not independently certified by this plugin; consult the source for full context.",
      ...sources.map(source => `\nSource ${source.entryId} (${source.role}):\n${source.quote.split("\n").map(line => `> ${line}`).join("\n")}`)].join("\n");
    if (body.length <= 24000) return { proposal: { ...proposal, body, description: "Attributed source excerpts; not certified execution results." },
      proof: { kind: "source-report", sources } };
  }
  const bound = sources.some(source => {
    if (source.role !== "user") return false;
    const text = userText(snapshot.evidence.find(entry => entry.entryId === source.entryId)!);
    return text?.split(/[.!?\n]+/).some(sentence => instruction.test(normalize(sentence)) &&
      normalize(sentence).includes(normalize(source.quote)));
  });
  // No semantic guessing from a bag of words: unknown reformulations, including mixed-language claims, need approval.
  const requested = proposal.procedureTemplate === "build-before-manifest" || instruction.test(normalize(proposal.body)) || paraphrases.has(normalize(proposal.body));
  if (bound && requested && !proposal.files?.length) {
    return { proposal: { ...proposal, description: "Release ordering process: build before checking this project's release manifest.", body: "Build before manifest check.\n1. Build this repo first.\n2. Check the release manifest against the built output.\nDo not infer deployment authorization from this procedure." },
      proof: { kind: "procedure-template", template: "build-before-manifest", sources } };
  }
  return { proposal, reason: "content-proof-required: procedure, source report and execution result are distinct; this body/assets cannot be verified by the available host template" };
}
