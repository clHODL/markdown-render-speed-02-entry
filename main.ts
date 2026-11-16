// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` (Node 22, which strips types). It
// reads the case list from /input/cases.json — or from MAKEFUN_INPUT_DIR
// when that is set, for local runs — renders every case with parse() from
// ./parse.js, and writes the HTML strings, in the cases' order, as a JSON
// array to /output/html.json (or MAKEFUN_OUTPUT_DIR).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(inputDir, 'cases.json'), 'utf8');
const cases = JSON.parse(raw) as { id: string; markdown: string }[];

const out: string[] = new Array(cases.length);
for (let n = 0; n < cases.length; n++) out[n] = parse(cases[n].markdown);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(out));
