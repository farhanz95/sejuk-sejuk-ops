/**
 * Bundles the AI endpoint into api/ai-query.js.
 *
 * Why this exists: Vercel ships a TypeScript file in api/ as plain ESM without
 * bundling, so `import { … } from '../src/lib/analytics'` (no file extension, as
 * TypeScript allows) exploded at runtime with
 *   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/lib/analytics'
 * and every request answered 500. Compiling the endpoint to a single
 * self-contained .js file — with the shared analytics/domain code inlined —
 * removes the whole class of problem, and keeps ONE source of truth for the
 * business rules (src/lib/*) used by the UI, the tests and the AI.
 */
import { build } from 'esbuild';

const entries = [
  ['server/ai-query.ts', 'api/ai-query.js'],
  ['server/extract-document.ts', 'api/extract-document.js'],
];

for (const [entry, outfile] of entries) {
const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  // ESM: package.json sets type=module, and Vercel's Node runtime picks up the
  // default export cleanly this way (CJS bundling left the handler only on
  // module.exports.default, which the runtime did not invoke).
  format: 'esm',
  sourcemap: false,
  logLevel: 'warning',
  // Keep the runtime's own modules out of the bundle.
  external: [],
  banner: {
    js: '/* AUTO-GENERATED from server/ai-query.ts by scripts/build-api.mjs — do not edit. */',
  },
});

if (result.errors.length) {
  console.error(`bundle failed: ${entry}`);
  process.exit(1);
}
console.log(`${outfile} bundled from ${entry}`);
}
