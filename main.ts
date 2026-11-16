// Entry point the harness runs as `node /bot/main.ts` (Node 22 strips the
// types natively). It reads every case from /input/cases.json — or from
// MAKEFUN_INPUT_DIR outside a container — renders each one on its own with
// parse() from parse.js, and writes the HTML strings, in the cases' order,
// as a JSON array to /output/html.json (MAKEFUN_OUTPUT_DIR outside a
// container). No case is cached or shared with another: each parse call
// stands alone.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; markdown: string }[];
const html: string[] = new Array(cases.length);
for (let k = 0; k < cases.length; k++) html[k] = parse(cases[k].markdown);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
