// Node stand-in for `import "./query_compiler_fast_bg.wasm?module"` in the workerd Prisma client:
// wrangler bundles that import for the Worker; Jest maps it here (test/jest-e2e.json).
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = new WebAssembly.Module(
  readFileSync(join(__dirname, '../../src/generated/prisma/internal/query_compiler_fast_bg.wasm')),
);
