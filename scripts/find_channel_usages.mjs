import fs from 'fs';
import path from 'path';

const SRC = 'D:\\01.AntiGravity\\LabelPrintStation\\src';

function walk(dir, results = []) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, results);
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      results.push(full);
    }
  }
  return results;
}

const files = walk(SRC);
const matches = [];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('channel') || line.includes('unsubscribe') || line.includes('removeChannel')) {
      matches.push({ file: path.relative(SRC, f), line: idx + 1, text: line.trim() });
    }
  });
}

console.log(`발견된 channel/unsubscribe 사용처 (${matches.length}건):`);
matches.forEach(m => console.log(`[${m.file}:${m.line}] ${m.text}`));
