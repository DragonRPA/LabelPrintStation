import fs from 'fs';
import path from 'path';

const ROOT = 'D:\\GoogleDrive\\RPA_dev\\01.AntiGravity\\LabelPrintStation';
const IGNORES = ['node_modules', '.git', 'dist', 'bin', 'obj', '.gemini', 'tasks'];

function walk(dir, results = []) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (IGNORES.includes(file)) continue;
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, results);
    } else {
      if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.cs') || file.endsWith('.html') || file.endsWith('.json') || file.endsWith('.md') || file.endsWith('.env') || file.endsWith('.cjs') || file.endsWith('.csproj')) {
        results.push(full);
      }
    }
  }
  return results;
}

const files = walk(ROOT);
console.log(`총 ${files.length}개 파일 검사 중...`);

const matches = [];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('imagescan') || line.includes('ImageScan') || line.includes('image_scan') || line.includes('IMAGE_SCAN')) {
      matches.push({ file: path.relative(ROOT, f), line: idx + 1, text: line.trim() });
    }
  });
}

console.log(`\n발견된 ImageScan 참조 (${matches.length}건):`);
matches.forEach(m => {
  console.log(`[${m.file}:${m.line}] ${m.text}`);
});
