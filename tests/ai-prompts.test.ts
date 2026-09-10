/**
 * Guards on the LLM prompts. These are not style opinions — each one exists
 * because a real response from the configured free-tier model was wrong:
 *
 *  - Groq's free models echoed the retrieved rows as raw JSON instead of prose.
 *  - They rewrote "RM 5,885" as "$5,885" — a currency change is a wrong answer,
 *    not a formatting nit.
 *  - They returned "last week" (handled in normalizeArgs, tested separately).
 *
 * A prompt is code here: if someone trims these instructions the tests fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server/ai-query.ts', import.meta.url), 'utf8');

test('the phrasing prompt forbids JSON output', () => {
  assert.match(src, /never output JSON/);
});

test('the phrasing prompt pins the currency to RM', () => {
  assert.match(src, /Write every amount as "RM <number>"/);
  assert.match(src, /never convert to \$, USD or any other currency/);
});

test('the phrasing prompt grounds the answer in the provided rows only', () => {
  assert.match(src, /ONLY the JSON rows provided/);
  assert.match(src, /Never invent jobs, amounts or technicians/);
});

test('the phrasing prompt tells the model to answer in the questioner\'s language', () => {
  assert.match(src, /same language as the question/);
});

test('the planner is forced to choose exactly one controlled query', () => {
  assert.match(src, /tool_choice: 'required'/);
  assert.match(src, /Choose exactly ONE function/);
  // and it is told what to do when a question is out of scope
  assert.match(src, /call business_overview and let the final answer explain the limitation/);
});

test('the catalog is the only thing the planner is shown', () => {
  // the tool list must be built from QUERY_CATALOG, never hand-written
  assert.match(src, /const tools = QUERY_CATALOG\.map/);
});

test('model arguments are normalised before use', () => {
  assert.match(src, /args: normalizeArgs\(args\)/);
});
