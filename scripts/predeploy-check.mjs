import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const lines = source.split(/\r?\n/);

const violations = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (/\b(?:await\s+)?db\.prepare\s*\(/.test(line)) {
    const trimmed = line.trim();
    const helperSignature = /^(?:async\s+)?function\s+\w*db\w*\s*\(/i.test(trimmed)
      || /^(?:const|let|var)\s+\w*db\w*\s*=\s*(?:async\s*)?\(/i.test(trimmed);
    if (!helperSignature) {
      violations.push(`${i + 1}: ${trimmed}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Predeploy check failed: disallowed db.prepare usage found in worker.js');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Predeploy check passed: no disallowed db.prepare usage in worker.js');
