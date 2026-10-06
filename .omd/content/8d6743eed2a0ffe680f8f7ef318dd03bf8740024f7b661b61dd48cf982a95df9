import type { SkillProposal } from "./store.ts";
import type { Snapshot } from "./context.ts";

export interface ContentProof {
  kind: "agent-notes" | "procedure-template" | "source-report" | "user-approved" | "restored-version";
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

/**
 * Default: every valid evidenced proposal is a model-synthesized note, never an
 * execution/fact certification; name, description, body and files are preserved verbatim
 * so the original skill and task keywords stay searchable. Only an explicit opt-in keeps
 * the legacy rendered kinds: contentKind "source-report" renders attributed excerpts, and
 * procedureTemplate "build-before-manifest" still requires user evidence for that exact
 * instruction. Evidence-less or invalid proposals never reach this assessment.
 */
export function assessContent(proposal: SkillProposal, snapshot: Snapshot): { proposal: SkillProposal; proof?: ContentProof; reason?: string } {
  const sources = proposal.evidence.map(item => {
    const entry = snapshot.evidence.find(entry => entry.entryId === item.entryId && entry.text.includes(item.quote));
    if (!entry) throw new Error("Content evidence not in effective snapshot");
    return { ...item, role: sourceRole(entry) };
  });
  if (proposal.contentKind === "source-report" && !proposal.files?.length) {
    const body = ["Source-reported excerpts — not independently certified by this plugin; consult the source for full context.",
      ...sources.map(source => `\nSource ${source.entryId} (${source.role}):\n${source.quote.split("\n").map(line => `> ${line}`).join("\n")}`)].join("\n");
    if (body.length <= 24000) return { proposal: { ...proposal, body, description: "Attributed source excerpts; not certified execution results." },
      proof: { kind: "source-report", sources } };
  }
  if (proposal.procedureTemplate === "build-before-manifest" && !proposal.files?.length) {
    const bound = sources.some(source => {
      if (source.role !== "user") return false;
      const text = userText(snapshot.evidence.find(entry => entry.entryId === source.entryId)!);
      return text?.split(/[.!?\n]+/).some(sentence => instruction.test(normalize(sentence)) &&
        normalize(sentence).includes(normalize(source.quote)));
    });
    if (bound) {
      return { proposal: { ...proposal, description: "Release ordering process: build before checking this project's release manifest.", body: "Build before manifest check.\n1. Build this repo first.\n2. Check the release manifest against the built output.\nDo not infer deployment authorization from this procedure." },
        proof: { kind: "procedure-template", template: "build-before-manifest", sources } };
    }
    // An unbound template request cannot render the host procedure; the proposal stays an ordinary note.
  }
  return { proposal, proof: { kind: "agent-notes", sources } };
}
