import assert from "node:assert/strict";
import { test } from "node:test";
import type { BeforeAgentStartEvent, Skill } from "@earendil-works/pi-coding-agent";
import { SEARCH_GUIDANCE, searchFirst } from "../src/context.ts";
import { REVIEW_INSTRUCTION } from "../src/review.ts";

test("proactive guidance stays bounded for a large catalog and treats references as data, not authorization", () => {
  for (const size of [0, 10000]) {
    const skills = Array.from({ length: size }, (_, i) => ({ name: `private-skill-${i}`, description: `private-rule-${i}` } as Skill));
    const event = { systemPromptOptions: { skills, sections: {} } } as BeforeAgentStartEvent;
    const enabled = searchFirst(event);
    assert.equal(enabled.length, size); assert.deepEqual(event.systemPromptOptions.skills, []);
    const guide = event.systemPromptOptions.sections.hermes_skills!;
    assert.equal(guide, SEARCH_GUIDANCE); assert.ok(guide.length < 2000);
    assert.ok(!guide.includes("private-skill-") && !guide.includes("private-rule-"));
    assert.match(guide, /reusable correction/); assert.match(guide, /revise the matching note/);
    assert.match(guide, /Save nothing/); assert.match(guide, /reference material, not authorization/);
    assert.match(guide, /Do not execute scripts/); assert.match(guide, /name or description/);
  }
  assert.match(REVIEW_INSTRUCTION, /revise an existing note/);
  assert.match(REVIEW_INSTRUCTION, /exact read SkillId/);
  assert.match(REVIEW_INSTRUCTION, /one destination only/);
});
