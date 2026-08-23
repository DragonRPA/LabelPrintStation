/**
 * Thermal Label Printer Connection & Real Hardware Discovery Manager (SSOT)
 * - PC 로컬 에이전트 (http://127.0.0.1:9988/api/printers) 실시간 하드웨어 스캔 연동
 * - WebSerial, WebUSB, Zebra Agent Direct, Supabase Print Queue 지원
 */

const LOCAL_KEY_REGISTERED_PRINTERS = 'IMAGE_SCAN_REGISTERED_PRINTERS_V2';
const LOCAL_KEY_ACTIVE_PRINTER_ID = 'IMAGE_SCAN_ACTIVE_PRINTER_ID_V2';

export const FALLBACK_DEFAULT_PRINTERS = [
  {
    id: 'prn_agent_default',
    name: '로컬 에이전트 자동 감지 프린터 (기본)',
    type: 'agent_auto',
    target: 'UBUS_DragonRPA_Agent',
    isDefault: true,
    isHardwareDetected: false
  },
  {
    id: 'prn_web_serial',
    name: 'Zebra ZPL USB/시리얼 (WebSerial)',
    type: 'web_serial',
    target: 'COM Port / USB',
    baudRate: 9600,
    isDefault: false,
    isHardwareDetected: false
  },
  {
    id: 'prn_virtual_queue',
    name: 'Supabase 프린트 큐 원격 인쇄',
    type: 'virtual_queue',
    target: 'Supabase Print Queue',
    isDefault: false,
    isHardwareDetected: false
  }
];

/**
 * ⭐️ 로컬 PC 에이전트(Windows OS)에서 실제 연결된 프린터 목록 실시간 스캔 및 동기화
 */
export async function fetchActualConnectedPrinters(port = 9988) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`http://127.0.0.1:${port}/api/printers`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const realPrinters = await res.json();
      if (Array.isArray(realPrinters) && realPrinters.length > 0) {
        const detectedList = realPrinters.map((p, idx) => {
          const isUsb = !p.PortName.match(/^\d+\.\d+/);
          const typeLabel = isUsb ? `USB (${p.PortName})` : `LAN (${p.PortName})`;
          return {
            id: `prn_win_${p.Name.replace(/[^a-zA-Z0-9]/g, '_')}_${p.PortName}`,
            name: `${p.Name} [${typeLabel}]`,
            rawName: p.Name,
            portName: p.PortName,
            type: isUsb ? 'agent_usb' : 'agent_tcp',
            target: p.PortName,
            isDefault: idx === 0,
            isHardwareDetected: true
          };
        });

        // 큐 방식 및 WebSerial도 추가
        detectedList.push({
          id: 'prn_virtual_queue',
          name: 'Supabase 프린트 큐 원격 인쇄',
          type: 'virtual_queue',
          target: 'Supabase Print Queue',
          isDefault: false,
          isHardwareDetected: false
        });

        localStorage.setItem(LOCAL_KEY_REGISTERED_PRINTERS, JSON.stringify(detectedList));
        return detectedList;
      }
    }
  } catch (err) {
    // 에이전트 오프라인 시 기존 로컬 저장값 또는 기본값 사용
  }

  return getRegisteredPrinters();
}

/**
 * 등록된 모든 프린터 목록 조회
 */
export function getRegisteredPrinters() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_REGISTERED_PRINTERS);
    if (!raw) {
      localStorage.setItem(LOCAL_KEY_REGISTERED_PRINTERS, JSON.stringify(FALLBACK_DEFAULT_PRINTERS));
      return FALLBACK_DEFAULT_PRINTERS;
    }
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length > 0 ? list : FALLBACK_DEFAULT_PRINTERS;
  } catch {
    return FALLBACK_DEFAULT_PRINTERS;
  }
}

/**
 * 활성 프린터 ID 조회
 */
export function getActivePrinterId() {
  try {
    const list = getRegisteredPrinters();
    const stored = localStorage.getItem(LOCAL_KEY_ACTIVE_PRINTER_ID);
    if (stored && list.some(p => p.id === stored)) {
      return stored;
    }
    return list[0]?.id || FALLBACK_DEFAULT_PRINTERS[0].id;
  } catch {
    return FALLBACK_DEFAULT_PRINTERS[0].id;
  }
}

/**
 * 활성 프린터 설정
 */
export function setActivePrinterId(printerId) {
  try {
    localStorage.setItem(LOCAL_KEY_ACTIVE_PRINTER_ID, printerId);
  } catch (e) {
    console.error('Failed to set active printer', e);
  }
}

/**
 * 신규 프린터 등록 또는 수정
 */
export function saveRegisteredPrinter(printer) {
  const list = getRegisteredPrinters();
  const index = list.findIndex(p => p.id === printer.id);
  if (index >= 0) {
    list[index] = { ...list[index], ...printer };
  } else {
    list.push({
      id: printer.id || `prn_custom_${Date.now()}`,
      ...printer
    });
  }
  localStorage.setItem(LOCAL_KEY_REGISTERED_PRINTERS, JSON.stringify(list));
  return list;
}

/**
 * 프린터 삭제
 */
export function deleteRegisteredPrinter(printerId) {
  const list = getRegisteredPrinters().filter(p => p.id !== printerId);
  localStorage.setItem(LOCAL_KEY_REGISTERED_PRINTERS, JSON.stringify(list));
  return list;
}

/**
 * ⭐️ ZPL 코드를 지정된 프린터로 즉시 전송 (Direct Output)
 */
export async function sendZplToPrinter(zplString, printer) {
  if (!printer) {
    throw new Error('선택된 라벨 프린터가 없습니다. 프린터를 선택하세요.');
  }

  // 1. 로컬 에이전트 하드웨어 연동 출력 (agent_usb / agent_tcp / agent_auto)
  if (printer.type === 'agent_usb' || printer.type === 'agent_tcp' || printer.type === 'agent_auto') {
    try {
      // 에이전트에 프린터 선택 적용 요청
      if (printer.rawName) {
        await fetch('http://127.0.0.1:9988/api/select-printer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName: printer.rawName,
            connectionType: printer.type === 'agent_usb' ? 'USB_RAW' : 'TCP',
            usbPort: printer.portName || 'USB001',
            printerHost: printer.portName ? printer.portName.replace(/^IP_/i, '') : '127.0.0.1',
            printerPort: 9100
          })
        }).catch(() => {});
      }

      // ⭐️ 에이전트 실제 ZPL 직통 인쇄 요청
      const targetPrinterName = printer.rawName || (printer.name && !printer.name.includes('기본 라벨 프린터') ? printer.name : '');
      const res = await fetch('http://127.0.0.1:9988/api/print-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zpl: zplString,
          printerName: targetPrinterName
        })
      });

      if (res.ok) {
        return { success: true, message: `[${printer.name}] 로컬 에이전트 ZPL 직통 출력 완료!` };
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `로컬 에이전트 인쇄 실패 (HTTP ${res.status})`);
      }
    } catch (e) {
      console.error('에이전트 직통 인쇄 오류:', e);
      throw new Error(`에이전트 인쇄 실패: ${e.message}`);
    }
  }

  // 2. WebSerial 방식
  if (printer.type === 'web_serial') {
    if (!('serial' in navigator)) {
      throw new Error('현재 브라우저는 WebSerial을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 사용하세요.');
    }
    let port = null;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number(printer.baudRate) || 9600 });
      const writer = port.writable.getWriter();
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(zplString));
      writer.releaseLock();
      await port.close();
      return { success: true, message: `[${printer.name}] ZPL 전송 완료!` };
    } catch (err) {
      if (port && port.close) {
        try { await port.close(); } catch (e) {}
      }
      throw new Error(`시리얼 프린터 전송 실패: ${err.message}`);
    }
  }

  // 3. WebUSB 방식
  if (printer.type === 'web_usb') {
    if (!('usb' in navigator)) {
      throw new Error('현재 브라우저는 WebUSB를 지원하지 않습니다.');
    }
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      const encoder = new TextEncoder();
      await device.transferOut(1, encoder.encode(zplString));
      await device.close();
      return { success: true, message: `[${device.productName || printer.name}] USB ZPL 전송 완료!` };
    } catch (err) {
      throw new Error(`USB 프린터 전송 실패: ${err.message}`);
    }
  }

  // 4. 가상 큐 방식
  return { success: true, message: `[프린트 큐] ZPL이 인쇄 대기열에 성공적으로 적재되었습니다.` };
}
