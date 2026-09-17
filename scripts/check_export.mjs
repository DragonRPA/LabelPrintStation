import fs from 'fs';
const content = fs.readFileSync('D:\\01.AntiGravity\\LabelPrintStation\\src\\components\\PCDashboard.jsx', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('handleExport') || l.includes('Export')) {
    console.log(`${i+1}: ${l}`);
  }
});
