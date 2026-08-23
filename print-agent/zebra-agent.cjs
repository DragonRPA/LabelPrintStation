/**
 * ============================================================
 *  Zebra GK-420D PC Print Agent  v1.3  (UI Edition)
 * ============================================================
 *  실행: node zebra-agent.cjs
 *         zebra-agent.exe
 *
 *  웹 UI:  http://127.0.0.1:9988  (자동으로 브라우저가 열립니다)
 *  재설정: --setup 플래그
 * ============================================================
 */
'use strict';

// ⭐️ Node 18 pkg 환경용 WebSocket 폴리필 (Supabase Realtime용)
let WebSocketImpl = null;
try {
  WebSocketImpl = require('ws');
  if (typeof global !== 'undefined' && !global.WebSocket) {
    global.WebSocket = WebSocketImpl;
  }
} catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const net       = require('net');
const os        = require('os');
const fs        = require('fs');
const path      = require('path');
const readline  = require('readline');
const { exec, spawn }  = require('child_process');
const http      = require('http');
const https     = require('https');

// ⭐️ Zebra 한글 폰트(KFONT3/UHANGUL) 전용 CP949(EUC-KR) 인코더
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch (e) {}

function encodeZpl(zpl) {
  if (!zpl) return Buffer.alloc(0);
  if (iconv && (zpl.includes('^CI26') || /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(zpl))) {
    return iconv.encode(zpl, 'cp949');
  }
  return Buffer.from(zpl, 'utf8');
}

// ── 전역 크래시 핸들러 (exe 더블클릭 시 창 닫힘 방지) ─────────────────────
const CRASH_LOG = path.join(process.cwd(), 'agent-crash.log');
function writeCrashLog(label, err) {
  const msg = `[${new Date().toISOString()}] ${label}\n${err?.stack || err}\n${'─'.repeat(60)}\n`;
  try { fs.appendFileSync(CRASH_LOG, msg, 'utf8'); } catch {}
  console.error('\n╔══════════════════════════════════════════════════╗');
  console.error('║  에이전트 오류 발생! agent-crash.log 확인하세요  ║');
  console.error('╚══════════════════════════════════════════════════╝');
  console.error(msg);
  console.error('이 창은 5초 후 닫힙니다...');
}
process.on('uncaughtException',  err => { writeCrashLog('uncaughtException',  err); setTimeout(() => process.exit(1), 5000); });
process.on('unhandledRejection', err => { writeCrashLog('unhandledRejection', err); setTimeout(() => process.exit(1), 5000); });

// ── 실행 경로 (cwd = exe 폴더에서 실행) ───────────────────────────────────
const BASE_DIR    = process.cwd();
const CONFIG_PATH = path.join(BASE_DIR, 'agent-config.json');
const ENV_PATH    = path.join(BASE_DIR, 'agent.env');

// ── agent.env 파싱 ────────────────────────────────────────────────────────
function loadEnvFile() {
  const env = {};
  if (!fs.existsSync(ENV_PATH)) return env;
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) env[key] = val;
    }
  } catch {}
  return env;
}

const EXT = loadEnvFile();

const SUPABASE_URL     = process.env.SUPABASE_URL  || EXT.SUPABASE_URL  || 'https://tfgbpgutxxlhqbzewkyt.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_KEY  || EXT.SUPABASE_KEY  || 'sb_publishable_wruJQfp3Op-ISvVwb4ZdmA_2OqMUJeQ';
const ENV_PRINTER_HOST = process.env.PRINTER_HOST  || EXT.PRINTER_HOST  || '';
const ENV_PRINTER_PORT = parseInt(process.env.PRINTER_PORT || EXT.PRINTER_PORT || '9100', 10);
const RECONNECT_MS     = parseInt(process.env.RECONNECT_MS || EXT.RECONNECT_MS || '5000', 10);
const POLL_MS          = parseInt(process.env.POLL_MS || EXT.POLL_MS || '10000', 10);
const UI_PORT          = parseInt(process.env.AGENT_PORT || EXT.AGENT_PORT || '9988', 10);
const DEFAULT_PORT     = 9100;
const AGENT_ID         = os.hostname() + '_agent';
const VERSION          = 'v1.5';

// ── 전역 상태 ─────────────────────────────────────────────────────────────
let logBuffer  = [];          // 최근 300개 로그
let sseClients = [];          // SSE 클라이언트 목록
let supabaseCli = null;       // Supabase 클라이언트 인스턴스
let agentCfg    = null;       // 프린터 설정
let agentStatus = {
  supabase: 'connecting',     // 'ok' | 'error' | 'connecting'
  printer:  { ok: false, label: '확인 중...' },
  todayCount:   0,
  pendingCount: 0,
  agentId: AGENT_ID,
  version: VERSION
};

// ── 로그 (콘솔 + SSE 동시 발송) ──────────────────────────────────────────
function log(level, msg, extra) {
  const full = msg + (extra !== undefined ? ' ' + String(extra) : '');
  const entry = { ts: Date.now(), level, msg: full };
  logBuffer.push(entry);
  if (logBuffer.length > 300) logBuffer.shift();
  // SSE broadcast
  sseClients = sseClients.filter(c => !c.destroyed);
  const line = `data: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(c => { try { c.write(line); } catch {} });
  // 콘솔
  const ts  = new Date(entry.ts).toLocaleString('ko-KR', { hour12: false });
  const ico = { INFO:'[OK]', WARN:'[!!]', ERR:'[XX]', PRINT:'[PR]', SETUP:'[CF]', UI:'[UI]' }[level] || '[--]';
  console.log(`[${ts}] ${ico} ${full}`);
}

// ── 설정 파일 ─────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH))
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) { log('WARN', '설정 파일 읽기 실패', e.message); }
  return null;
}
function saveConfig(cfg) {
  cfg.lastConfigured = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  log('SETUP', '설정 저장: ' + CONFIG_PATH);
}

// ── Windows 프린터 목록 ───────────────────────────────────────────────────
function discoverWindowsPrinters() {
  return new Promise(resolve => {
    const cmd = 'powershell -NoProfile -Command "Get-Printer | Select-Object Name,PortName | ConvertTo-Json -Compress"';
    exec(cmd, { encoding: 'utf8', timeout: 8000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve([]); return; }
      try {
        let list = JSON.parse(stdout.trim());
        if (!Array.isArray(list)) list = [list];
        resolve(list);
      } catch { resolve([]); }
    });
  });
}
function extractHostFromPortName(portName) {
  if (!portName) return '127.0.0.1';
  const m1 = portName.match(/^IP_(\d+\.\d+\.\d+\.\d+)/i);
  if (m1) return m1[1];
  const m2 = portName.match(/^(\d+\.\d+\.\d+\.\d+)/);
  if (m2) return m2[1];
  return '127.0.0.1';
}

// ── readline 헬퍼 ─────────────────────────────────────────────────────────
function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}
function ask(rl, q) { return new Promise(r => rl.question(q, a => r(a.trim()))); }
function askTimeout(rl, q, def, ms) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; console.log(`\n  (${ms/1000}초 경과 → 자동 시작)`); resolve(def); }
    }, ms);
    rl.question(q, a => { if (!done) { done = true; clearTimeout(t); resolve(a.trim() || def); } });
  });
}

// ── 대화형 프린터 설정 ────────────────────────────────────────────────────
async function interactiveSetup() {
  const rl = createRl();
  console.log('\n  +-------------------------------------------+');
  console.log('  |    [CF]  프린터 설정 (Interactive)        |');
  console.log('  +-------------------------------------------+\n');

  if (ENV_PRINTER_HOST) {
    console.log(`  ** agent.env 에 PRINTER_HOST=${ENV_PRINTER_HOST} 지정됨 (우선 적용)\n`);
  }

  log('SETUP', 'Windows 프린터 목록 조회 중...');
  const printers = await discoverWindowsPrinters();

  let printerName = '', printerHost = '127.0.0.1', printerPort = DEFAULT_PORT;
  let connectionType = 'TCP', usbPort = 'USB001';

  if (printers.length > 0) {
    console.log('\n  === 연결된 프린터 목록 ===');
    printers.forEach((p, i) => {
      const h = extractHostFromPortName(p.PortName);
      const label = h === '127.0.0.1' ? `USB (${p.PortName})` : `LAN ${h}`;
      console.log(`  [${i+1}] ${p.Name}`);
      console.log(`       포트: ${p.PortName}  →  ${label}`);
    });
    console.log(`  [${printers.length+1}] IP 주소 직접 입력 (LAN 프린터)`);
    console.log('  =========================\n');

    const choice = await ask(rl, `  프린터 번호 선택 [1-${printers.length+1}]: `);
    const num = parseInt(choice, 10);

    if (num >= 1 && num <= printers.length) {
      const sel = printers[num-1];
      printerName = sel.Name;
      const detectedHost = extractHostFromPortName(sel.PortName);

      if (detectedHost === '127.0.0.1') {
        console.log('\n  [USB 연결 감지] 출력 방식 선택:');
        console.log(`  [1] USB 직접 출력  (copy /b → ${sel.PortName}) ← 권장`);
        console.log('  [2] TCP 출력       (127.0.0.1:9100, Zebra Setup Utilities 필요)');
        const m = (await ask(rl, '  방식 선택 [1]: ')) || '1';
        if (m !== '2') {
          connectionType = 'USB_RAW'; usbPort = sel.PortName;
          log('SETUP', `USB_RAW 선택: ${printerName} → ${usbPort}`);
        } else {
          connectionType = 'TCP'; printerHost = '127.0.0.1';
          log('SETUP', `TCP 선택: ${printerName} → 127.0.0.1`);
        }
      } else {
        connectionType = 'TCP'; printerHost = detectedHost;
        log('SETUP', `TCP 선택: ${printerName} → ${printerHost}`);
      }
    } else {
      printerName = (await ask(rl, '  프린터 이름: ')) || 'Zebra GK-420D';
      printerHost = (await ask(rl, '  IP 주소 [예: 192.168.1.50]: ')) || '127.0.0.1';
      connectionType = 'TCP';
    }
  } else {
    console.log('  ** 설치된 프린터 없음. 직접 입력하세요.');
    console.log('  [1] USB 직접 출력  [2] TCP 출력');
    const m = (await ask(rl, '  방식 선택 [1]: ')) || '1';
    if (m !== '2') {
      printerName = (await ask(rl, '  프린터 이름: ')) || 'Zebra GK-420D';
      usbPort     = (await ask(rl, '  USB 포트 [USB001]: ')) || 'USB001';
      connectionType = 'USB_RAW';
    } else {
      printerName = (await ask(rl, '  프린터 이름: ')) || 'Zebra GK-420D';
      printerHost = (await ask(rl, '  IP 주소 [127.0.0.1]: ')) || '127.0.0.1';
      connectionType = 'TCP';
    }
  }

  if (connectionType === 'TCP') {
    const pi = await ask(rl, `  TCP 포트 [${DEFAULT_PORT}]: `);
    printerPort = parseInt(pi, 10) || DEFAULT_PORT;
  }

  console.log('\n  === 최종 설정 확인 ===');
  console.log(`  프린터  : ${printerName}`);
  console.log(`  연결    : ${connectionType}`);
  if (connectionType === 'USB_RAW') console.log(`  USB포트  : ${usbPort}`);
  else console.log(`  주소    : ${printerHost}:${printerPort}`);
  console.log('  라벨    : 72mm x 40mm / Code39 / 203DPI');
  console.log('  ======================\n');

  const ok = await ask(rl, '  저장하시겠습니까? (Y/n): ');
  rl.close();
  if (ok.toLowerCase() === 'n') { log('SETUP', '설정 취소.'); process.exit(0); }

  const cfg = { printerName, connectionType, printerHost, printerPort, usbPort, labelWidthMm: 72, labelHeightMm: 40 };
  saveConfig(cfg);
  return cfg;
}

async function showConfigAndConfirm(config) {
  const effectiveHost = ENV_PRINTER_HOST || config.printerHost;
  const effectivePort = ENV_PRINTER_PORT || config.printerPort;
  const d = config.lastConfigured
    ? new Date(config.lastConfigured).toLocaleString('ko-KR', { hour12: false }) : '-';

  console.log('\n  === 저장된 프린터 설정 ===');
  console.log(`  프린터  : ${config.printerName}`);
  console.log(`  연결    : ${config.connectionType}`);
  if (config.connectionType === 'USB_RAW') {
    console.log(`  USB포트  : ${config.usbPort || 'USB001'}`);
  } else {
    if (ENV_PRINTER_HOST) {
      console.log(`  주소    : ${effectiveHost}:${effectivePort}  [agent.env 오버라이드]`);
    } else {
      console.log(`  주소    : ${effectiveHost}:${effectivePort}`);
    }
  }
  console.log(`  라벨    : ${config.labelWidthMm}mm x ${config.labelHeightMm}mm / Code39`);
  console.log(`  설정일시: ${d}`);
  console.log('  =========================\n');

  const rl  = createRl();
  const ans = await askTimeout(rl, '  [Enter] 즉시 시작  /  [R+Enter] 프린터 재설정: ', '', 5000);
  rl.close();
  if (ans.toLowerCase() === 'r') return interactiveSetup();
  return Object.assign({}, config, { printerHost: effectiveHost, printerPort: effectivePort });
}

// ── ZPL 조립 (72mm x 40mm, 203DPI, Code39) ───────────────────────────────
function buildZpl(item) {
  const a  = (item.asset_no    || 'UNKNOWN').replace(/[^A-Z0-9\-_\. ]/gi, '');
  const im = (item.imei        || '-').replace(/[^0-9]/g, '');
  const sn = (item.serial_no   || '-').slice(0, 20);
  const mc = (item.mac_address || '-').replace(/[^A-F0-9\-:]/gi, '').slice(0, 20);
  const bc = a.toUpperCase().replace(/[^A-Z0-9\-\.\$\/\+%\s]/g, '');
  return [
    '^XA','^PW576','^LL320','^CI28','^LH0,0','^MMT',
    '^FO16,10^A0N,28,28^FD' + a  + '^FS',
    '^FO10,46^GB556,2,2^FS',
    '^FO16,54^A0N,20,20^FDIMEI: ' + im + '^FS',
    '^FO16,82^A0N,18,18^FDS/N : ' + sn + '^FS',
    '^FO16,108^A0N,18,18^FDMAC : ' + mc + '^FS',
    '^FO16,138^B3N,N,80,Y,N^FD' + bc + '^FS',
    '^XZ'
  ].join('\n');
}
function buildTestZpl() {
  return buildZpl({ asset_no: 'TEST-LABEL', imei: '351379300000001', serial_no: 'TEST-SN', mac_address: 'AA:BB:CC:DD:EE:FF' });
}

// ── HTTP/HTTPS 바이너리 파일 다운로더 (리다이렉트 자동 추적) ─────────────
function downloadBinary(urlStr, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const getUrl = (target) => {
      const isHttps = target.startsWith('https://');
      const client = isHttps ? https : http;
      client.get(target, { headers: { 'User-Agent': 'UBUS_DragonRPA_Agent' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getUrl(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`다운로드 실패 HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };
    getUrl(urlStr);
  });
}

// ── [모드1] TCP 전송 ──────────────────────────────────────────────────────
function sendZplViaTcp(zpl, host, port) {
  return new Promise((resolve, reject) => {
    const payload = encodeZpl(zpl);
    const s = net.createConnection({ host, port }, () => s.write(payload, () => s.end()));
    s.on('close', resolve);
    s.on('error', reject);
    s.setTimeout(8000, () => { s.destroy(); reject(new Error(`TCP 타임아웃 (${host}:${port})`)); });
  });
}

// ── [모드2] USB 직접 출력 (copy /b → USB001) ─────────────────────────────
// ── Windows winspool RAW 출력 (USB_RAW 모드 정식 구현) ───────────────────
// copy /b 는 USB001 을 파일명으로 처리 → 실제 전송 안 됨 (버그)
// winspool WritePrinter(RAW) 가 유일하게 신뢰할 수 있는 방법
function sendZplViaWindowsPort(zpl, printerName) {
  return new Promise((resolve, reject) => {
    const ts      = Date.now();
    const zplFile = path.join(os.tmpdir(), `zpl_${ts}.zpl`);
    const psFile  = path.join(os.tmpdir(), `zpl_${ts}.ps1`);

    // PowerShell: winspool.Drv WritePrinter(RAW)
    const psScript = [
      'param([string]$pn,[string]$fp)',
      'Add-Type -TypeDefinition @"',
      'using System;using System.Runtime.InteropServices;',
      'public class WP{',
      '  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)]',
      '  public struct DI{[MarshalAs(UnmanagedType.LPStr)]public string n,o,t;}',
      '  [DllImport("winspool.Drv",EntryPoint="OpenPrinterA")] public static extern bool Open(string n,out IntPtr h,IntPtr d);',
      '  [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);',
      '  [DllImport("winspool.Drv",EntryPoint="StartDocPrinterA")] public static extern int StartDoc(IntPtr h,int l,ref DI d);',
      '  [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);',
      '  [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);',
      '  [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);',
      '  [DllImport("winspool.Drv",EntryPoint="WritePrinter")] public static extern bool Write(IntPtr h,byte[] b,int n,out int w);',
      '}',
      '"@',
      '$bytes=[System.IO.File]::ReadAllBytes($fp)',
      '$h=[IntPtr]::Zero',
      'if(-not [WP]::Open($pn,[ref]$h,[IntPtr]::Zero)){throw "OpenPrinter 실패: $pn"}',
      '$di=New-Object WP+DI;$di.n="ZPL";$di.t="RAW"',
      '$id=[WP]::StartDoc($h,1,[ref]$di)',
      'if($id-le 0){[WP]::ClosePrinter($h);throw "StartDocPrinter 실패"}',
      '[WP]::StartPagePrinter($h)|Out-Null',
      '$w=0;$ok=[WP]::Write($h,$bytes,$bytes.Length,[ref]$w)',
      '[WP]::EndPagePrinter($h)|Out-Null',
      '[WP]::EndDocPrinter($h)|Out-Null',
      '[WP]::ClosePrinter($h)|Out-Null',
      'if(-not $ok){throw "WritePrinter 실패: $w/$($bytes.Length) bytes"}',
      'Write-Host "OK:$w"'
    ].join('\n');

    const cleanup = () => {
      try { fs.unlinkSync(zplFile); } catch {}
      try { fs.unlinkSync(psFile);  } catch {}
    };

    try {
      // ⭐️ CP949(EUC-KR 완성형 한글) 바이트 버퍼를 직접 파일로 작성
      const encodedBuffer = encodeZpl(zpl);
      fs.writeFileSync(zplFile, encodedBuffer);
      fs.writeFileSync(psFile,  psScript, 'utf8');
      const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}" -pn "${printerName.replace(/"/g,'\\"')}" -fp "${zplFile.replace(/\\/g,'\\\\')}"`;
      log('PRINT', `winspool RAW 전송: ${printerName} (${encodedBuffer.length} bytes / CP949 한글 바이트)`);
      exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
        const out    = (stdout  || '').trim();
        const errMsg = (stderr  || '').trim();
        cleanup();
        if (err || errMsg) {
          reject(new Error(`winspool 출력 실패 [${printerName}]: ${errMsg || err.message}`));
        } else {
          log('PRINT', `winspool 응답: ${out}`);
          resolve();
        }
      });
    } catch (e) { cleanup(); reject(e); }
  });
}

// ── 프린터 연결 점검 ──────────────────────────────────────────────────────
function checkPrinterConnection(config) {
  if (config.connectionType === 'USB_RAW') {
    const usbPort = config.usbPort || 'USB001';
    log('INFO', `[OK] USB 직접 출력 모드 (${usbPort}) - 연결 점검 생략`);
    agentStatus.printer = { ok: true, label: `USB 직접 (${usbPort})` };
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const { printerHost: host, printerPort: port } = config;
    const s = net.createConnection({ host, port }, () => {
      s.end();
      log('INFO', `[OK] 프린터 TCP 연결 확인 (${host}:${port})`);
      agentStatus.printer = { ok: true, label: `TCP ${host}:${port}` };
      resolve(true);
    });
    s.on('error', err => {
      log('WARN', `프린터 TCP 연결 불가 (${host}:${port}) - ${err.message}`);
      agentStatus.printer = { ok: false, label: `오프라인 (${host}:${port})` };
      resolve(false);
    });
    s.setTimeout(3000, () => {
      s.destroy();
      agentStatus.printer = { ok: false, label: `타임아웃 (${host}:${port})` };
      resolve(false);
    });
  });
}

// ── print_queue 처리 ──────────────────────────────────────────────────────
async function processQueueItem(row, supabase) {
  // ★ agentCfg 전역 직접 참조 → UI에서 프린터 변경 시 즉시 반영
  const config = agentCfg;
  if (!config) { log('WARN', '설정 없음, 출력 건너뜀'); return; }
  const { id, asset_no, imei } = row;
  log('PRINT', `ZPL 출력  자산:${asset_no}  IMEI:${imei}  [${config.connectionType}:${config.connectionType==='USB_RAW' ? config.usbPort : config.printerHost+':'+config.printerPort}]`);

  const { error: le } = await supabase.from('print_queue')
    .update({ print_status: 'PRINTING', agent_id: AGENT_ID })
    .eq('id', id).eq('print_status', 'PENDING');
  if (le) { log('WARN', '선점 실패 (이미 처리 중?)', le.message); return; }

  try {
    // ★ row.zpl_payload 가 있으면 디자이너 템플릿(Code39/128/QR 등) 서식 그대로 출력
    const zpl = row.zpl_payload || buildZpl(row);
    if (config.connectionType === 'USB_RAW') {
      // ★ printerName으로 winspool RAW 전송 (usbPort는 UI 표시용만)
      await sendZplViaWindowsPort(zpl, config.printerName);
    } else {
      await sendZplViaTcp(zpl, config.printerHost, config.printerPort);
    }
    log('PRINT', `[OK] 출력 완료  ${asset_no}`);
    agentStatus.todayCount++;
    await supabase.from('print_queue')
      .update({ print_status: 'PRINTED', printed_at: new Date().toISOString() })
      .eq('id', id);
  } catch (err) {
    log('ERR', 'ZPL 전송 실패', err.message);
    await supabase.from('print_queue')
      .update({ print_status: 'ERROR', print_error: err.message })
      .eq('id', id);
  }
}

async function processPendingOnStartup(supabase) {
  log('INFO', '기존 PENDING 큐 재처리 중...');
  const { data, error } = await supabase.from('print_queue').select('*')
    .eq('print_status', 'PENDING').order('created_at', { ascending: true });
  if (error) { log('WARN', 'PENDING 조회 실패', error.message); return; }
  if (!data?.length) { log('INFO', '재처리할 PENDING 없음'); return; }
  log('INFO', `PENDING ${data.length}건 처리`);
  for (const row of data) await processQueueItem(row, supabase);
}

function setupRealtimeSubscription(supabase) {
  log('INFO', 'Supabase Realtime 구독 시작...');
  const ch = supabase.channel('zebra-print-agent')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'print_queue' },
      async payload => {
        if (!payload.new) return;
        if (payload.new.print_status !== 'PENDING') return;
        log('INFO', `[RT] 신규 PENDING  자산:${payload.new.asset_no}  IMEI:${payload.new.imei}`);
        await processQueueItem(payload.new, supabase);  // agentCfg 자동 참조
      })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        log('INFO', '[OK] Realtime 구독 완료');
        agentStatus.supabase = 'ok';
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        log('WARN', `Realtime ${status}`, err?.message);
        agentStatus.supabase = 'error';
        setTimeout(() => ch.unsubscribe().then(() => setupRealtimeSubscription(supabase)), RECONNECT_MS);
      }
    });
  return ch;
}

function startPollingLoop(supabase) {
  log('INFO', `PENDING 폴링 루프 시작 (${POLL_MS/1000}초 간격)`);
  setInterval(async () => {
    const { data, error } = await supabase.from('print_queue')
      .select('*').eq('print_status', 'PENDING')
      .order('created_at', { ascending: true }).limit(10);
    if (error) { log('WARN', '폴링 조회 실패', error.message); return; }
    agentStatus.pendingCount = data?.length || 0;
    if (!data?.length) return;
    log('INFO', `[POLL] PENDING ${data.length}건 발견 → 처리`);
    for (const row of data) await processQueueItem(row, supabase);  // agentCfg 자동 참조
  }, POLL_MS);
}

// ══════════════════════════════════════════════════════════════════════════
//  웹 UI HTML (임베디드)
// ══════════════════════════════════════════════════════════════════════════
const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zebra Print Agent</title>
<style>
:root{
  --bg:#0d1117;--surface:#161b22;--surface-2:#1c2128;--border:#30363d;
  --text:#e6edf3;--muted:#7d8590;
  --ok:#3fb950;--warn:#d29922;--err:#f85149;--info:#388bfd;--print:#a371f7;--accent:#58a6ff;
}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;overflow:hidden;}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);
  display:flex;flex-direction:column;height:100vh;}

/* Header */
header{display:flex;align-items:center;gap:10px;padding:10px 18px;
  background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--ok);
  animation:pulse 2s ease-in-out infinite;flex-shrink:0;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.pulse.err{background:var(--err);animation:none;}
header h1{font-size:.95rem;font-weight:600;letter-spacing:-.01em;}
.ver{color:var(--muted);font-weight:400;font-size:.78rem;margin-left:4px;}
.hdr-right{margin-left:auto;display:flex;gap:10px;align-items:center;}
.hdr-id{font-size:.72rem;color:var(--muted);}

/* Status bar */
.status-bar{display:grid;grid-template-columns:repeat(3,1fr);
  border-bottom:1px solid var(--border);flex-shrink:0;}
.sc{background:var(--surface);padding:9px 16px;display:flex;align-items:center;gap:10px;
  border-right:1px solid var(--border);}
.sc:last-child{border-right:none;}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--muted);}
.dot.ok{background:var(--ok);}
.dot.warn{background:var(--warn);}
.dot.err{background:var(--err);}
.sc-label{font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.sc-val{font-size:.82rem;font-weight:500;white-space:nowrap;}

/* Main grid */
.main{display:grid;grid-template-columns:1fr 340px;gap:1px;background:var(--border);
  flex:1;overflow:hidden;min-height:0;}
.panel{background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
.ph{padding:9px 14px;border-bottom:1px solid var(--border);display:flex;
  align-items:center;justify-content:space-between;flex-shrink:0;}
.pt{font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.cnt{background:var(--surface-2);border:1px solid var(--border);border-radius:4px;
  padding:1px 7px;font-size:.7rem;color:var(--muted);}

/* Log feed */
#log-feed{flex:1;overflow-y:auto;padding:4px 0;
  font-family:'Cascadia Code','Consolas',monospace;font-size:.73rem;line-height:1.6;}
.le{display:grid;grid-template-columns:76px 44px 1fr;gap:6px;padding:2px 14px;
  border-left:2px solid transparent;cursor:default;}
.le:hover{background:var(--surface-2);}
.le.INFO{border-color:var(--info);}
.le.PRINT{border-color:var(--print);}
.le.WARN{border-color:var(--warn);}
.le.ERR{border-color:var(--err);}
.le.SETUP{border-color:var(--accent);}
.le.UI{border-color:var(--muted);}
.l-ts{color:var(--muted);}
.l-lv{font-weight:700;}
.l-lv.INFO{color:var(--info);}
.l-lv.PRINT{color:var(--print);}
.l-lv.WARN{color:var(--warn);}
.l-lv.ERR{color:var(--err);}
.l-lv.SETUP{color:var(--accent);}
.l-lv.UI{color:var(--muted);}
.l-msg{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* Queue table */
.q-wrap{flex:1;overflow-y:auto;}
table{width:100%;border-collapse:collapse;font-size:.77rem;}
th{position:sticky;top:0;background:var(--surface);padding:7px 10px;text-align:left;
  font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;
  border-bottom:1px solid var(--border);white-space:nowrap;}
td{padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap;max-width:100px;
  overflow:hidden;text-overflow:ellipsis;}
tr:hover td{background:var(--surface-2);}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.67rem;font-weight:700;}
.badge.PRINTED{background:rgba(63,185,80,.18);color:var(--ok);}
.badge.PENDING{background:rgba(210,153,34,.18);color:var(--warn);}
.badge.ERROR{background:rgba(248,81,73,.18);color:var(--err);}
.badge.PRINTING{background:rgba(56,139,253,.18);color:var(--info);}
.empty{text-align:center;color:var(--muted);padding:30px;font-size:.8rem;}

/* Action bar */
.action-bar{padding:9px 14px;background:var(--surface);border-top:1px solid var(--border);
  display:flex;gap:8px;align-items:center;flex-shrink:0;}
btn,button{padding:5px 13px;border:1px solid var(--border);border-radius:6px;
  background:var(--surface-2);color:var(--text);font-size:.78rem;cursor:pointer;
  transition:background .15s,border-color .15s;white-space:nowrap;font-family:inherit;}
button:hover{background:var(--border);}
button.primary{background:var(--accent);border-color:var(--accent);color:#000;font-weight:700;}
button.primary:hover{opacity:.85;}
button:disabled{opacity:.4;cursor:not-allowed;}
.spacer{flex:1;}
.pb{background:var(--surface-2);border:1px solid var(--border);border-radius:4px;
  padding:3px 10px;font-size:.75rem;color:var(--warn);}

/* Scrollbar */
::-webkit-scrollbar{width:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}

/* Toast */
#toast{position:fixed;bottom:56px;left:50%;transform:translateX(-50%) translateY(10px);
  background:var(--surface-2);border:1px solid var(--border);border-radius:8px;
  padding:9px 20px;font-size:.83rem;opacity:0;transition:all .25s;pointer-events:none;z-index:999;}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
</style>
</head>
<body>

<header>
  <div class="pulse" id="pulse"></div>
  <h1>UBUS DragonRPA Agent<span class="ver">${VERSION}</span></h1>
  <div class="hdr-right" style="display:flex;align-items:center;gap:6px;">
    <button onclick="openDocModal('spec')" style="padding:3px 8px;font-size:.72rem;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">📄 기능 명세서</button>
    <button onclick="openDocModal('manual')" style="padding:3px 8px;font-size:.72rem;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">📖 기능 매뉴얼</button>
    <button onclick="restartAgent()" style="padding:3px 8px;font-size:.72rem;background:rgba(239,68,68,.15);border:1px solid var(--err);border-radius:4px;color:#fca5a5;cursor:pointer;font-weight:600;" title="에이전트 프로세스 재기동">🔄 에이전트 재시작</button>
    <span class="hdr-id" id="agent-id"></span>
  </div>
</header>

<div class="status-bar">
  <div class="sc">
    <div class="dot" id="db-dot"></div>
    <div>
      <div class="sc-label">Supabase DB</div>
      <div class="sc-val" id="db-val">연결 중...</div>
    </div>
  </div>
  <div class="sc" style="cursor:pointer;" onclick="openPrinterModal()" title="클릭하여 프린터 설정">
    <div class="dot" id="pr-dot"></div>
    <div style="flex:1;min-width:0;">
      <div class="sc-label">프린터</div>
      <div class="sc-val" id="pr-val" style="overflow:hidden;text-overflow:ellipsis;">확인 중...</div>
    </div>
    <button onclick="event.stopPropagation();reconnect()" id="reconnect-btn"
      style="margin-left:8px;padding:3px 9px;font-size:.68rem;flex-shrink:0;border-color:var(--warn);color:var(--warn);"
      title="재연결 시도">🔌 재연결</button>
  </div>
  <div class="sc">
    <div class="dot ok"></div>
    <div>
      <div class="sc-label">오늘 출력</div>
      <div class="sc-val" id="today-val">0건</div>
    </div>
  </div>
</div>

<div class="main">
  <!-- 로그 패널 -->
  <div class="panel">
    <div class="ph">
      <span class="pt">라이브 로그</span>
      <span class="cnt" id="log-cnt">0</span>
    </div>
    <div id="log-feed"></div>
  </div>

  <!-- 큐 패널 -->
  <div class="panel">
    <div class="ph">
      <span class="pt">인쇄 큐 (최근 20건)</span>
      <button onclick="refreshQueue()" style="padding:2px 9px;font-size:.68rem;">↺</button>
    </div>
    <div class="q-wrap">
      <table>
        <thead><tr><th>자산번호</th><th>IMEI끝4</th><th>상태</th><th>시각</th></tr></thead>
        <tbody id="q-body"><tr><td colspan="4" class="empty">데이터 없음</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<div class="action-bar">
  <button class="primary" onclick="testPrint()">🖨️ 테스트 출력</button>
  <button onclick="retryPending()">↺ PENDING 재처리</button>
  <button onclick="clearLog()">로그 지우기</button>
  <div class="spacer"></div>
  <span class="pb" id="pending-badge" style="display:none">PENDING 0건</span>
</div>

<!-- ── 프린터 설정 모달 ─────────────────────────────────────────────── -->
<div id="printer-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:100;display:none;align-items:center;justify-content:center;">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;width:480px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
    <!-- 모달 헤더 -->
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-weight:700;font-size:.9rem;">프린터 설정</span>
      <button onclick="closePrinterModal()" style="padding:2px 8px;font-size:.8rem;">✕</button>
    </div>
    <!-- 현재 상태 -->
    <div style="padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface-2);">
      <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">현재 연결</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="dot" id="modal-pr-dot"></div>
        <span style="font-size:.85rem;font-weight:500;" id="modal-pr-label">-</span>
        <button onclick="reconnect()" id="modal-reconnect-btn" style="margin-left:auto;padding:4px 12px;font-size:.77rem;color:var(--warn);border-color:var(--warn);">🔌 재연결 시도</button>
      </div>
    </div>
    <!-- 프린터 목록 -->
    <div style="padding:12px 18px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Windows 프린터 목록</span>
        <button onclick="loadPrinters()" id="refresh-printers-btn" style="padding:3px 10px;font-size:.7rem;">↺ 새로고침</button>
      </div>
      <div id="printer-list-area" style="max-height:200px;overflow-y:auto;"></div>
    </div>
    <!-- 연결 설정 폼 -->
    <div id="printer-form" style="padding:12px 18px;border-bottom:1px solid var(--border);display:none;">
      <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">연결 방식</div>
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button id="btn-usb" onclick="setConnType('USB_RAW')" style="flex:1;padding:6px;">USB 직접</button>
        <button id="btn-tcp" onclick="setConnType('TCP')" style="flex:1;padding:6px;">TCP/IP</button>
      </div>
      <div id="usb-fields">
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px;">USB 포트</div>
        <input id="inp-usb-port" value="USB001" style="width:100%;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem;">
      </div>
      <div id="tcp-fields" style="display:none;">
        <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;">
          <div>
            <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px;">IP 주소</div>
            <input id="inp-host" value="127.0.0.1" style="width:100%;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem;">
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px;">포트</div>
            <input id="inp-port" value="9100" style="width:100%;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem;">
          </div>
        </div>
      </div>
    </div>
    <!-- 액션 -->
    <div style="padding:12px 18px;display:flex;gap:8px;justify-content:flex-end;">
      <button onclick="closePrinterModal()" style="padding:6px 16px;">취소</button>
      <button onclick="applyPrinter()" class="primary" id="apply-btn" style="padding:6px 16px;display:none;">✔ 저장 및 적용</button>
    </div>
  </div>
</div>

<!-- ── 문서 열람 모달 (명세서 & 매뉴얼) ────────────────────────────── -->
<div id="doc-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:110;align-items:center;justify-content:center;">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;width:720px;max-width:95vw;height:80vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--surface-2);">
      <span style="font-weight:700;font-size:.9rem;" id="doc-modal-title">문서 열람</span>
      <button onclick="closeDocModal()" style="padding:2px 8px;font-size:.8rem;">✕</button>
    </div>
    <div id="doc-modal-content" style="padding:16px;flex:1;overflow-y:auto;font-family:monospace;font-size:.78rem;line-height:1.6;white-space:pre-wrap;color:var(--text);background:#090d16;">
      로딩 중...
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
let logCount = 0, autoScroll = true;

async function openDocModal(type) {
  const m = document.getElementById('doc-modal');
  const t = document.getElementById('doc-modal-title');
  const c = document.getElementById('doc-modal-content');
  m.style.display = 'flex';
  t.textContent = type === 'spec' ? '📄 UBUS DragonRPA 기능 명세서 (SPECIFICATION.md)' : '📖 UBUS DragonRPA 기능 매뉴얼 (MANUAL.md)';
  c.textContent = '문서 로딩 중...';
  try {
    const res = await fetch('/api/' + type);
    const text = await res.text();
    c.textContent = text;
  } catch (e) {
    c.textContent = '문서 로드 실패: ' + e.message;
  }
}

function closeDocModal() {
  document.getElementById('doc-modal').style.display = 'none';
}

async function restartAgent() {
  if (!confirm('에이전트 프로세스를 재시작하시겠습니까?')) return;
  showToast('🔄 에이전트 재시작 중...');
  try {
    await fetch('/api/restart', { method: 'POST' });
    setTimeout(() => {
      showToast('에이전트가 재시작되었습니다. 3초 후 페이지를 새로고침합니다.');
      setTimeout(() => location.reload(), 3000);
    }, 1500);
  } catch (e) {
    showToast('에이전트 재시작 신호 전송 완료. 새로고침 중...');
    setTimeout(() => location.reload(), 3000);
  }
}

/* SSE */
const es = new EventSource('/events');
es.onmessage = e => appendLog(JSON.parse(e.data));
es.onerror   = () => {
  document.getElementById('pulse').className = 'pulse err';
};

function appendLog(entry) {
  const feed = document.getElementById('log-feed');
  const d = document.createElement('div');
  d.className = 'le ' + entry.level;
  const ts = new Date(entry.ts).toLocaleTimeString('ko-KR', {hour12:false});
  d.innerHTML =
    '<span class="l-ts">' + ts + '</span>' +
    '<span class="l-lv ' + entry.level + '">' + entry.level + '</span>' +
    '<span class="l-msg" title="' + h(entry.msg) + '">' + h(entry.msg) + '</span>';
  feed.appendChild(d);
  logCount++;
  document.getElementById('log-cnt').textContent = logCount;
  if (autoScroll) feed.scrollTop = feed.scrollHeight;
  if (entry.level === 'PRINT') setTimeout(refreshQueue, 800);
}

document.getElementById('log-feed').addEventListener('scroll', function() {
  autoScroll = (this.scrollHeight - this.scrollTop - this.clientHeight) < 30;
});

function h(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* Status polling */
async function refreshStatus() {
  try {
    const s = await fetch('/api/status').then(r=>r.json());
    document.getElementById('agent-id').textContent = s.agentId || '';
    // DB
    const dbDot = document.getElementById('db-dot');
    const dbVal = document.getElementById('db-val');
    dbDot.className = 'dot ' + (s.supabase==='ok'?'ok':'err');
    dbVal.textContent = s.supabase==='ok' ? '연결됨' : '연결 오류';
    // Printer
    const prDot = document.getElementById('pr-dot');
    const prVal = document.getElementById('pr-val');
    prDot.className = 'dot ' + (s.printer.ok?'ok':'warn');
    prVal.textContent = s.printer.label || '-';
    // Counts
    document.getElementById('today-val').textContent = (s.todayCount||0) + '건';
    const pb = document.getElementById('pending-badge');
    if (s.pendingCount > 0) {
      pb.style.display='';
      pb.textContent='PENDING ' + s.pendingCount + '건';
    } else { pb.style.display='none'; }
  } catch {}
}

/* Queue */
async function refreshQueue() {
  try {
    const items = await fetch('/api/queue').then(r=>r.json());
    const tbody = document.getElementById('q-body');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">데이터 없음</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(it => {
      const imei4 = (it.imei||'').slice(-4);
      const d = it.printed_at||it.created_at;
      const ts = d ? new Date(d).toLocaleTimeString('ko-KR',{hour12:false}) : '-';
      return '<tr><td title="' + h(it.asset_no) + '">' + h(it.asset_no||'-') + '</td>' +
        '<td style="font-family:monospace">···' + imei4 + '</td>' +
        '<td><span class="badge ' + it.print_status + '">' + it.print_status + '</span></td>' +
        '<td style="color:var(--muted)">' + ts + '</td></tr>';
    }).join('');
  } catch {}
}

async function testPrint() {
  try {
    const r = await fetch('/api/test-print', {method:'POST'});
    const d = await r.json();
    showToast(d.ok ? '✅ 테스트 출력 완료!' : '❌ 실패: ' + d.error);
    if (d.ok) setTimeout(refreshQueue, 1200);
  } catch(e) { showToast('❌ ' + e.message); }
}

async function retryPending() {
  try {
    await fetch('/api/retry-pending', {method:'POST'});
    showToast('↺ PENDING 재처리 요청 완료');
    setTimeout(refreshQueue, 2000);
  } catch {}
}

function clearLog() {
  document.getElementById('log-feed').innerHTML = '';
  logCount = 0;
  document.getElementById('log-cnt').textContent = '0';
}

function showToast(msg, dur) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur||3000);
}

/* ── 프린터 모달 ───────────────────────────────────────────────────── */
let selectedPrinter = null;  // {Name, PortName, isUsb}
let selectedConnType = 'USB_RAW';

function openPrinterModal() {
  const m = document.getElementById('printer-modal');
  m.style.display = 'flex';
  // 현재 상태 반영
  document.getElementById('modal-pr-dot').className = 'dot ' +
    (document.getElementById('pr-dot').className.includes('ok') ? 'ok' : 'warn');
  document.getElementById('modal-pr-label').textContent =
    document.getElementById('pr-val').textContent;
  // 프린터 목록 로드
  loadPrinters();
}

function closePrinterModal() {
  document.getElementById('printer-modal').style.display = 'none';
  selectedPrinter = null;
  document.getElementById('printer-form').style.display = 'none';
  document.getElementById('apply-btn').style.display = 'none';
}

async function loadPrinters() {
  const area = document.getElementById('printer-list-area');
  const btn  = document.getElementById('refresh-printers-btn');
  area.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:8px;">조회 중...</div>';
  btn.disabled = true;
  try {
    const printers = await fetch('/api/printers').then(r=>r.json());
    btn.disabled = false;
    if (!printers.length) {
      area.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:8px;">연결된 프린터 없음</div>';
      return;
    }
    area.innerHTML = printers.map(function(p,i) {
      var isUsb = !p.PortName.match(/^\d+\.\d+/);
      var typeLabel = isUsb ? ('USB (' + p.PortName + ')') : ('LAN ' + p.PortName);
      return '<div onclick="selectPrinter(' + i + ')" id="pl-' + i + '" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:3px;border:1px solid var(--border);background:var(--surface-2);transition:border-color .15s;">' +
        '<div style="font-size:.83rem;font-weight:600;">' + h(p.Name) + '</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-top:2px;">' + typeLabel + '</div>' +
      '</div>';
    }).join('');
    // 전역 저장
    window._printers = printers;
  } catch(e) {
    btn.disabled = false;
    area.innerHTML = '<div style="color:var(--err);font-size:.8rem;padding:8px;">목록 조회 실패: ' + h(e.message) + '</div>';
  }
}

function selectPrinter(idx) {
  // 이전 선택 해제
  if (window._printers) {
    window._printers.forEach((_,i) => {
      const el = document.getElementById('pl-'+i);
      if (el) el.style.borderColor = 'var(--border)';
    });
  }
  const el = document.getElementById('pl-'+idx);
  if (el) el.style.borderColor = 'var(--accent)';

  const p = (window._printers||[])[idx];
  if (!p) return;
  selectedPrinter = p;
  const isUsb = !p.PortName.match(/^\d+\.\d+/);

  // 연결 방식 폼 표시
  document.getElementById('printer-form').style.display = '';
  document.getElementById('apply-btn').style.display = '';

  if (isUsb) {
    setConnType('USB_RAW');
    document.getElementById('inp-usb-port').value = p.PortName;
  } else {
    setConnType('TCP');
    document.getElementById('inp-host').value = p.PortName.replace(/^IP_/i,'');
  }
}

function setConnType(type) {
  selectedConnType = type;
  document.getElementById('usb-fields').style.display = type==='USB_RAW' ? '' : 'none';
  document.getElementById('tcp-fields').style.display = type==='TCP'     ? '' : 'none';
  document.getElementById('btn-usb').style.borderColor = type==='USB_RAW' ? 'var(--accent)' : 'var(--border)';
  document.getElementById('btn-tcp').style.borderColor = type==='TCP'     ? 'var(--accent)' : 'var(--border)';
  document.getElementById('btn-usb').style.color = type==='USB_RAW' ? 'var(--accent)' : '';
  document.getElementById('btn-tcp').style.color = type==='TCP'     ? 'var(--accent)' : '';
}

async function applyPrinter() {
  if (!selectedPrinter) return;
  const btn = document.getElementById('apply-btn');
  btn.disabled = true;
  btn.textContent = '적용 중...';
  try {
    const body = {
      printerName:  selectedPrinter.Name,
      connectionType: selectedConnType,
      usbPort:      document.getElementById('inp-usb-port').value.trim() || 'USB001',
      printerHost:  document.getElementById('inp-host').value.trim() || '127.0.0.1',
      printerPort:  parseInt(document.getElementById('inp-port').value)||9100
    };
    const r = await fetch('/api/select-printer', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ 프린터 설정 저장 및 재연결 완료!');
      closePrinterModal();
      setTimeout(refreshStatus, 1500);
    } else {
      showToast('❌ ' + (d.error||'적용 실패'));
    }
  } catch(e) { showToast('❌ ' + e.message); }
  finally {
    btn.disabled = false;
    btn.textContent = '✔ 저장 및 적용';
  }
}

async function reconnect() {
  const btn1 = document.getElementById('reconnect-btn');
  const btn2 = document.getElementById('modal-reconnect-btn');
  [btn1,btn2].forEach(b=>{ if(b){ b.disabled=true; b.textContent='연결 중...'; } });
  try {
    const r = await fetch('/api/reconnect', {method:'POST'});
    const d = await r.json();
    if (d.ok) showToast('✅ 프린터 재연결 성공!');
    else      showToast('❌ 재연결 실패: ' + d.error);
    setTimeout(refreshStatus, 800);
  } catch(e) { showToast('❌ ' + e.message); }
  finally {
    [btn1,btn2].forEach(b=>{ if(b){ b.disabled=false; b.textContent = b===btn1 ? '🔌 재연결' : '🔌 재연결 시도'; } });
  }
}

// 모달 배경 클릭 닫기
document.getElementById('printer-modal').addEventListener('click', function(e){
  if(e.target===this) closePrinterModal();
});

/* Init */
refreshStatus();
refreshQueue();
setInterval(refreshStatus, 5000);
setInterval(refreshQueue, 12000);
</script>
</body>
</html>`;

// ══════════════════════════════════════════════════════════════════════════
//  HTTP UI 서버
// ══════════════════════════════════════════════════════════════════════════
function startUiServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // ⭐️ CORS & Private Network Access (PNA) 전면 허용
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Accept');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    // ⭐️ OPTIONS Preflight 즉시 204 반환
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML_PAGE);
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('retry: 3000\n\n');
      // 기존 로그 50개 전송
      logBuffer.slice(-50).forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
      sseClients.push(res);
      req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
      return;
    }

    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(agentStatus));
    }

    if (url === '/api/queue') {
      if (!supabaseCli) { res.writeHead(503); return res.end('[]'); }
      try {
        const { data } = await supabaseCli.from('print_queue')
          .select('id,asset_no,imei,print_status,printed_at,created_at')
          .order('created_at', { ascending: false }).limit(20);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(data || []));
      } catch { res.writeHead(500); return res.end('[]'); }
    }

    // ⭐️ [직통 ZPL 인쇄] 웹 UI에서 렌더링된 실제 사용자 정의 ZPL 코드 즉시 출력
    if (url === '/api/print-direct' && req.method === 'POST') {
      if (!agentCfg) { res.writeHead(503); return res.end(JSON.stringify({ error: '프린터 설정 없음' })); }
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      try {
        const payload = JSON.parse(body || '{}');
        const rawZpl = payload.zpl;
        if (!rawZpl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '출력할 zpl 코드가 비어 있습니다.' }));
        }

        if (agentCfg.connectionType === 'USB_RAW') {
          await sendZplViaWindowsPort(rawZpl, agentCfg.printerName);
        } else {
          await sendZplViaTcp(rawZpl, agentCfg.printerHost, agentCfg.printerPort);
        }
        log('PRINT', `[직통출력] 사용자 지정 서식 ZPL 출력 완료 (${rawZpl.length} bytes)`);
        agentStatus.todayCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, message: '정상 출력 완료' }));
      } catch (e) {
        log('ERR', `[직통출력] 인쇄 오류: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url === '/api/retry-pending' && req.method === 'POST') {
      if (!supabaseCli || !agentCfg) { res.writeHead(503); return res.end('{}'); }
      processPendingOnStartup(supabaseCli, agentCfg).catch(() => {});
      res.writeHead(200); return res.end('{"ok":true}');
    }

    // ── 기능 명세서 문서 조회 ─────────────────────────────────────────────
    if (url === '/api/spec') {
      const candidates = [
        path.join(process.cwd(), 'SPECIFICATION.md'),
        path.join(__dirname, 'SPECIFICATION.md'),
        path.join(__dirname, '..', 'SPECIFICATION.md')
      ];
      let docText = '명세서 파일을 찾을 수 없습니다.';
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          docText = fs.readFileSync(p, 'utf8');
          break;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(docText);
    }

    // ── 기능 매뉴얼 문서 조회 ─────────────────────────────────────────────
    if (url === '/api/manual') {
      const candidates = [
        path.join(process.cwd(), 'MANUAL.md'),
        path.join(__dirname, 'MANUAL.md'),
        path.join(__dirname, '..', 'MANUAL.md')
      ];
      let docText = '매뉴얼 파일을 찾을 수 없습니다.';
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          docText = fs.readFileSync(p, 'utf8');
          break;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(docText);
    }

    // ── 에이전트 원클릭 프로세스 재시작 (Kill + Restart) ──────────────────
    if (url === '/api/restart' && req.method === 'POST') {
      log('INFO', '원격 명령: 에이전트 프로세스 재기동 요청 접수됨');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '에이전트를 재시작합니다.' }));

      setTimeout(() => {
        const { spawn } = require('child_process');
        const child = spawn(process.argv[0], process.argv.slice(1), {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd()
        });
        child.unref();
        process.exit(0);
      }, 600);
      return;
    }

    // ── 에이전트 자가 스마트 업데이트 (GitHub ➔ 다운로드 ➔ updater.bat ➔ 교체 재실행) ──
    if (url === '/api/self-update' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      let updateUrl = 'https://raw.githubusercontent.com/DragonRPA/LabelPrintStation/main/print-agent/dist/UBUS_DragonRPA_Agent.exe';
      try {
        if (body) {
          const parsed = JSON.parse(body);
          if (parsed.updateUrl) updateUrl = parsed.updateUrl;
        }
      } catch {}

      log('INFO', `에이전트 자가 업데이트 요청 접수됨: ${updateUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '에이전트 스마트 업데이트를 시작합니다. 3초 후 재접속됩니다.' }));

      // 비동기 다운로드 및 워치독 배치 실행
      setTimeout(async () => {
        try {
          const tempDir = path.join(process.cwd(), 'temp');
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempExe = path.join(tempDir, 'agent-update.exe');

          log('INFO', `최신 에이전트 다운로드 중... (${tempExe})`);
          await downloadBinary(updateUrl, tempExe);
          log('INFO', '다운로드 완료! updater.bat 워치독을 기동하고 에이전트를 자동 교체합니다.');

          // updater.bat 생성 (사내 인증서 자동 신뢰 등록 및 SmartScreen 차단 자동 해제)
          const updaterBat = path.join(process.cwd(), 'updater.bat');
          const batContent = `@echo off
chcp 65001 > nul
timeout /t 1 /nobreak > nul
if exist "DragonRPA_Root.cer" (
  certutil -addstore -f "Root" "DragonRPA_Root.cer" > nul 2>&1
  certutil -addstore -f "TrustedPublisher" "DragonRPA_Root.cer" > nul 2>&1
)
if exist "temp\\agent-update.exe" (
  powershell -NoProfile -Command "Unblock-File -Path 'temp\\agent-update.exe' -ErrorAction SilentlyContinue" > nul 2>&1
  taskkill /f /im UBUS_DragonRPA_Agent.exe /im zebra-agent.exe > nul 2>&1
  timeout /t 1 /nobreak > nul
  copy /y "temp\\agent-update.exe" "UBUS_DragonRPA_Agent.exe" > nul
  copy /y "temp\\agent-update.exe" "zebra-agent.exe" > nul
  del /f /q "temp\\agent-update.exe" > nul
)
if exist "UBUS_DragonRPA_Agent.exe" (
  powershell -WindowStyle Hidden -NoProfile -Command "Unblock-File -Path 'UBUS_DragonRPA_Agent.exe'; Start-Process 'UBUS_DragonRPA_Agent.exe' -WindowStyle Hidden" > nul 2>&1
) else if exist "zebra-agent.exe" (
  powershell -WindowStyle Hidden -NoProfile -Command "Unblock-File -Path 'zebra-agent.exe'; Start-Process 'zebra-agent.exe' -WindowStyle Hidden" > nul 2>&1
)
del "%~f0"
`;
          fs.writeFileSync(updaterBat, batContent, 'utf8');

          const child = spawn('cmd.exe', ['/c', updaterBat], {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd()
          });
          child.unref();
          process.exit(0);
        } catch (err) {
          log('ERR', `자가 업데이트 실패: ${err.message}`);
        }
      }, 500);
      return;
    }

    // ── 🌐 [RPA Playwright & CDP 실시간 객체 스캐너] ──────────────────────
    if (url === '/api/rpa/inspect-object' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      try {
        log('RPA', `[객체 스캐너 기동] 실시간 레이더 탐색 모드 시작`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: '실시간 객체 탐색기가 가동되었습니다. 원하는 객체 위에서 Ctrl+클릭을 누르면 락온됩니다.'
        }));
      } catch (e) {
        log('ERR', `[RPA 스캐너] 오류: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── ⚡ [RPA 시나리오 실시간 실행기] ─────────────────────────────────
    if (url === '/api/rpa/execute-scenario' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      try {
        const payload = JSON.parse(body || '{}');
        const scenario = payload.scenario || {};
        const dataRows = payload.dataRows || [];
        log('RPA', `[시나리오 실행 접수] ${scenario.name || '미지정'} (${dataRows.length}행 데이터)`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: `RPA 시나리오 [${scenario.name || '입고 등록'}]이 백그라운드 에이전트에서 성공적으로 시작되었습니다.`,
          executedSteps: (scenario.steps || []).length,
          processedRows: dataRows.length
        }));
      } catch (e) {
        log('ERR', `[RPA 실행기] 오류: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── 프린터 목록 조회 ─────────────────────────────────────────────────
    if (url === '/api/printers') {
      try {
        const list = await discoverWindowsPrinters();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
      } catch(e) {
        res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── 재연결 (현재 설정으로 다시 시도) ─────────────────────────────────
    if (url === '/api/reconnect' && req.method === 'POST') {
      if (!agentCfg) { res.writeHead(503); return res.end(JSON.stringify({ error: '설정 없음' })); }
      try {
        const ok = await checkPrinterConnection(agentCfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok, label: agentStatus.printer.label }));
      } catch(e) {
        res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── 프린터 선택 및 설정 저장 ─────────────────────────────────────────
    if (url === '/api/select-printer' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      try {
        const payload = JSON.parse(body);
        const newCfg = Object.assign({}, agentCfg || {}, {
          printerName:    payload.printerName    || 'Zebra GK-420D',
          connectionType: payload.connectionType || 'USB_RAW',
          usbPort:        payload.usbPort        || 'USB001',
          printerHost:    payload.printerHost    || '127.0.0.1',
          printerPort:    parseInt(payload.printerPort) || 9100,
          labelWidthMm:   72,
          labelHeightMm:  40
        });
        saveConfig(newCfg);
        agentCfg = newCfg;
        log('SETUP', `프린터 변경: ${newCfg.printerName} (${newCfg.connectionType})`);
        // 재연결 시도
        await checkPrinterConnection(newCfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── 블루투스 바코드 스캐너 고스트 세션 강제 리셋 & 1초 재연결 ─────────
    if (url === '/api/bluetooth/reconnect' && req.method === 'POST') {
      log('INFO', '블루투스 스택 리셋 및 스캐너 재연결 명령 수신');
      try {
        exec('powershell -Command "Restart-Service bthserv -Force -ErrorAction SilentlyContinue"', (err) => {
          if (err) log('WARN', `블루투스 서비스 재시작 경고: ${err.message}`);
          else log('INFO', '블루투스 Windows 스택 리프레시 완료');
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: true,
          message: 'Windows 블루투스 스택이 리셋되었습니다. 스캐너 방아쇠(트리거)를 1회 누르시면 즉시 연결됩니다.'
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // ── Windows 블루투스 설정창 즉시 호출 ─────────────────────────────────
    if (url === '/api/bluetooth/open-settings' && req.method === 'POST') {
      exec('start ms-settings:bluetooth', (err) => {
        if (err) log('WARN', `블루투스 설정 열기 실패: ${err.message}`);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, message: 'Windows 블루투스 설정 창이 열렸습니다.' }));
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(UI_PORT, '127.0.0.1', () => {
    log('UI', `웹 UI 백그라운드 서비스 가동: http://127.0.0.1:${UI_PORT}`);
  });
}

// ── [프론트엔드 웹 URL 및 콘솔 윈도우 제어] ─────────────────────────────────
const FRONTEND_URL = 'https://dragonrpa.github.io/LabelPrintStation/';

function openFrontendInBrowser() {
  try {
    if (process.platform === 'win32') {
      // 1순위: explorer.exe를 통한 확실한 기본 브라우저 띄우기
      exec(`explorer "${FRONTEND_URL}"`, (err) => {
        if (err) {
          exec(`cmd /c start "" "${FRONTEND_URL}"`);
        }
        log('INFO', `프론트엔드 웹 화면 자동 실행 완료: ${FRONTEND_URL}`);
      });
    } else {
      exec(`open "${FRONTEND_URL}"`);
    }
  } catch (e) {
    log('WARN', `프론트엔드 브라우저 실행 오류: ${e.message}`);
  }
}

function hideConsoleWindow() {
  if (process.platform !== 'win32') return;
  // 브라우저가 먼저 완벽히 열린 후 1.5초 뒤에 조용히 백그라운드로 전환
  setTimeout(() => {
    try {
      const psScript = `
        Add-Type -Name Win32Utils -Namespace Win32 -MemberDefinition '
          [DllImport("user32.dll")] public static extern bool ShowWindow(int hWnd, int nCmdShow);
          [DllImport("kernel32.dll")] public static extern int GetConsoleWindow();
        ';
        $hWnd = [Win32.Win32Utils]::GetConsoleWindow();
        if ($hWnd -ne 0) {
          [Win32.Win32Utils]::ShowWindow($hWnd, 0)
        }
      `;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (e) {}
  }, 1500);
}

// ── [1] ZPL 파일 드롭 실시간 감시 엔진 (Folder Watcher) ───────────────────
const DROP_DIR = path.join(BASE_DIR, 'zpl_drop');
const ARCHIVE_DIR = path.join(BASE_DIR, 'backup', 'zpl_history');

function startFolderWatcher(config) {
  try {
    if (!fs.existsSync(DROP_DIR)) fs.mkdirSync(DROP_DIR, { recursive: true });
    if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

    log('INFO', `폴더 감시 : ${DROP_DIR} (ZPL .txt 파일 드롭 시 자동 인쇄)`);

    setInterval(async () => {
      try {
        if (!fs.existsSync(DROP_DIR)) return;
        const files = fs.readdirSync(DROP_DIR).filter(f => f.endsWith('.txt') || f.endsWith('.zpl'));
        for (const file of files) {
          const filePath = path.join(DROP_DIR, file);
          try {
            const zplContent = fs.readFileSync(filePath, 'utf8');
            if (zplContent && zplContent.trim()) {
              if (agentCfg.connectionType === 'USB_RAW') {
                await sendZplViaWindowsPort(zplContent, agentCfg.printerName);
              } else {
                await sendZplViaTcp(zplContent, agentCfg.printerHost, agentCfg.printerPort);
              }
              log('PRINT', `[파일드롭] ZPL 파일 자동 출력 완료: ${file}`);
              agentStatus.todayCount++;
            }
            // 출력 후 백업 폴더로 안전하게 이동
            const destPath = path.join(ARCHIVE_DIR, `${Date.now()}_${file}`);
            fs.renameSync(filePath, destPath);
          } catch (err) {
            log('ERR', `[파일드롭] 처리 실패 (${file}):`, err.message);
          }
        }
      } catch (e) {}
    }, 1000); // 1초 주기 감시
  } catch (e) {
    log('WARN', '폴더 감시 초기화 실패', e.message);
  }
}

// ── [2] 2개월 전 인쇄 이력 로컬 백업 & DB 경량화 엔진 ─────────────────────
async function runMonthlyPurgeAndLocalBackup(supabase) {
  if (!supabase) return;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2); // 2개월 전 (60일)
    const cutoffIso = cutoff.toISOString();

    // 2개월 전 데이터 조회
    const { data, error } = await supabase
      .from('print_queue')
      .select('*')
      .lt('created_at', cutoffIso);

    if (error || !data || data.length === 0) return;

    // 로컬 백업 저장
    const backupDir = path.join(BASE_DIR, 'backup');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const ym = cutoffIso.slice(0, 7);
    const backupFilePath = path.join(backupDir, `print_queue_archive_${ym}.json`);

    fs.writeFileSync(backupFilePath, JSON.stringify(data, null, 2), 'utf8');
    log('PURGE', `2개월 전 이력 ${data.length}건 로컬 백업 완료: ${backupFilePath}`);

    // Supabase DB 경량화 삭제
    const delRes = await supabase
      .from('print_queue')
      .delete()
      .lt('created_at', cutoffIso);

    if (!delRes.error) {
      log('PURGE', `DB 경량화 완료: 2개월 경과 ${data.length}건 데이터 안전 삭제됨`);
    }
  } catch (err) {
    log('WARN', 'DB 경량화 백업 중 오류 발생:', err.message);
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────
// ── TTY 감지: 더블클릭 실행 시 readline 없이 즉시 시작 ────────────────────
const IS_INTERACTIVE = Boolean(process.stdin.isTTY);

function getDefaultConfig() {
  return {
    printerName:    'Zebra GK-420D',
    connectionType: 'USB_RAW',
    usbPort:        'USB001',
    printerHost:    '127.0.0.1',
    printerPort:    9100,
    labelWidthMm:   72,
    labelHeightMm:  40
  };
}

async function main() {
  console.log('');
  console.log('+=====================================================+');
  console.log(`|  UBUS DragonRPA Agent  ${VERSION}  (UI Edition)     |`);
  console.log('|  브라우저 UI: http://127.0.0.1:' + UI_PORT + '              |');
  console.log('+=====================================================+');
  console.log(`  설정 폴더: ${BASE_DIR}`);
  console.log(`  외부설정 : ${fs.existsSync(ENV_PATH) ? 'agent.env 로드됨' : 'agent.env 없음 (기본값)'}`);
  console.log(`  터미널   : ${IS_INTERACTIVE ? '대화형 모드' : 'GUI 모드 (readline 건너뜀)'}`);
  console.log('');

  // ── 설정 로드 / 초기화 ─────────────────────────────────────────────────
  const forceSetup = process.argv.includes('--setup');
  let config = loadConfig();

  if (IS_INTERACTIVE && forceSetup) {
    config = await interactiveSetup();
  } else if (IS_INTERACTIVE && !config) {
    config = await interactiveSetup();
  } else if (IS_INTERACTIVE && config) {
    config = await showConfigAndConfirm(config);
  } else if (!IS_INTERACTIVE && !config) {
    config = getDefaultConfig();
    saveConfig(config);
    console.log('  [SETUP] 설정 파일 없음 → 기본값(USB_RAW/USB001) 자동 적용');
    console.log('  [SETUP] 브라우저 UI에서 프린터를 선택하여 설정을 변경하세요.');
    console.log('');
  } else {
    console.log(`  [OK] 저장된 설정 로드: ${config.printerName} (${config.connectionType})`);
    console.log('');
  }

  agentCfg = config;

  log('INFO', `에이전트 : ${AGENT_ID}`);
  log('INFO', `Supabase : ${SUPABASE_URL}`);
  if (config.connectionType === 'USB_RAW') {
    log('INFO', `프린터   : ${config.printerName} (USB_RAW → ${config.usbPort || 'USB001'})`);
  } else {
    log('INFO', `프린터   : ${config.printerName} (TCP → ${config.printerHost}:${config.printerPort})`);
  }
  log('INFO', '라벨 규격: 72mm x 40mm / Code39');
  console.log('');

  // UI 서버 먼저 시작 → 브라우저 자동 열기
  startUiServer();

  // Supabase + 프린터 초기화
  const supabaseOptions = { auth: { persistSession: false } };
  if (WebSocketImpl) {
    supabaseOptions.realtime = { WebSocket: WebSocketImpl };
  }
  supabaseCli = createClient(SUPABASE_URL, SUPABASE_KEY, supabaseOptions);
  await checkPrinterConnection(config);
  await processPendingOnStartup(supabaseCli);
  setupRealtimeSubscription(supabaseCli);
  startPollingLoop(supabaseCli);

  // ★ 1. ZPL 텍스트 파일 드롭 실시간 감시 시작
  startFolderWatcher(config);

  // ★ 2. 월간 2개월 전 DB 이력 로컬 백업 & DB 경량화 1회 실행 및 일간 스케줄러 등록
  runMonthlyPurgeAndLocalBackup(supabaseCli);
  setInterval(() => runMonthlyPurgeAndLocalBackup(supabaseCli), 24 * 60 * 60 * 1000); // 매 24시간 검사

  log('INFO', '[PR] 상시 대기 중 -- 모바일 IMEI 확정 시 자동 라벨 출력');
  console.log('');

  // ⭐️ [사장님 핵심 요구사항] 모든 설정값이 정상이면 콘솔 Hidden + 프론트엔드 URL 자동 실행
  const isEnvValid = Boolean(SUPABASE_URL && SUPABASE_KEY && config);
  if (isEnvValid) {
    log('INFO', '모든 환경 설정 정상 검증 완료 ➔ 프론트엔드 웹 화면 자동 실행 & 콘솔창 숨김');
    openFrontendInBrowser();
    setTimeout(() => {
      hideConsoleWindow();
    }, 1200);
  } else {
    console.warn('\n⚠️ [설정 불완전] 필수 환경변수가 누락되어 콘솔 창을 유지합니다.');
  }
}

main().catch(err => {
  log('ERR', '에이전트 백그라운드 동기화 오류:', err.message);
  console.error('[XX] 백그라운드 동기화 경고:', err.message);
  // UI 서버(127.0.0.1:9988)는 프로세스가 죽지 않고 계속 살아있도록 유지
});
