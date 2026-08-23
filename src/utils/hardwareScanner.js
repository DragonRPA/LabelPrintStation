/**
 * Hardware / Bluetooth Barcode Scanner Global Interceptor Engine
 * System: Zero-Focus Fast Barcode Burst Interceptor & Instant ZPL Queue Pipeline
 */
import { getDbClient } from './dbClient';
import { getStoredLabelTemplate, generateDynamicZpl } from './labelTemplate';
import { triggerSuccessFeedback } from './soundFeedback';

let buffer = '';
let lastKeyTime = 0;
const SCAN_TIMEOUT_MS = 60; // 바코드 스캐너의 고속 입력 간격 임계치 (ms)
let isInitialized = false;

/**
 * 하드웨어/블루투스 스캐너 전역 리스너 가동
 */
export function initHardwareScannerListener({ onScanResult, onAutoPrintSuccess, onError }) {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  window.addEventListener('keydown', async (e) => {
    // ⭐️ 텍스트박스 내부(DirectPrintTab 등)에 포커스가 있을 때는 입력창 자체 이벤트(onKeyDown/onSubmit)가 100% 정상 작동하도록 일체 간섭하지 않음!
    const targetTag = (e.target?.tagName || '').toLowerCase();
    const isTextInput = targetTag === 'input' || targetTag === 'textarea';
    if (isTextInput) {
      buffer = '';
      return;
    }

    const currentTime = Date.now();
    const timeDiff = currentTime - lastKeyTime;
    lastKeyTime = currentTime;

    // 엔터 키 입력 시 버퍼 판정
    if (e.key === 'Enter') {
      if (buffer.length >= 3) {
        const scannedCode = buffer.trim();
        buffer = '';

        // 스캐너 고속 입력 인터셉트 (입력창 외부에서 찍었을 때만)
        e.preventDefault();
        e.stopPropagation();

        console.log('[HardwareScanner] 바코드 감지:', scannedCode);
        handleInstantBarcodeProcess(scannedCode, { onScanResult, onAutoPrintSuccess, onError });
      } else {
        buffer = '';
      }
      return;
    }

    // 일반 단일 문자 누적
    if (e.key.length === 1) {
      if (timeDiff > SCAN_TIMEOUT_MS && buffer.length > 0) {
        // 시간이 너무 오래 걸리면 일반 타이핑으로 간주하고 버퍼 리셋
        buffer = '';
      }
      buffer += e.key;
    }
  }, true); // 캡처링 단계에서 최우선 가로채기
}

/**
 * 스캔된 코드(자산번호 또는 시리얼)를 DB 조회 후 즉시 라벨 인쇄 큐 발행
 */
async function handleInstantBarcodeProcess(code, { onScanResult, onAutoPrintSuccess, onError }) {
  try {
    triggerSuccessFeedback();
    const client = getDbClient();
    let matchedItem = {
      asset_no: code,
      serial_no: code,
      model_name: '',
      product_name: ''
    };

    if (client) {
      // 1. scan_records 테이블에서 key_value 또는 data->>'serial_no' 또는 data->>'asset_no' 조회
      const { data, error } = await client
        .from('scan_records')
        .select('*')
        .or(`key_value.eq.${code},data->>serial_no.eq.${code},data->>asset_no.eq.${code}`)
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        matchedItem = {
          id: data.id,
          key_value: data.key_value,
          asset_no: data.data?.asset_no || data.key_value,
          serial_no: data.data?.serial_no || code,
          model_name: data.data?.model_name || '',
          product_name: data.data?.product_name || '',
          ...data.data
        };
      }
    }

    if (onScanResult) onScanResult(matchedItem);

    // 2. 현재 활성 서식(Active Template)으로 ZPL 즉시 컴파일
    const activeTemplate = getStoredLabelTemplate();
    const zpl = generateDynamicZpl(matchedItem, activeTemplate);

    // 3. print_queue에 PENDING 등록 → zebra-agent가 즉시 출력!
    if (client) {
      const payload = {
        key_value: String(matchedItem.asset_no || code),
        record_data: matchedItem,
        zpl_payload: zpl,
        asset_no: matchedItem.asset_no || code,
        serial_no: matchedItem.serial_no || code,
        print_status: 'PENDING',
        requested_by: 'BT_SCANNER'
      };

      const { data: qData, error: qErr } = await client
        .from('print_queue')
        .insert(payload)
        .select()
        .single();

      if (!qErr && onAutoPrintSuccess) {
        onAutoPrintSuccess(qData);
      }
    }
  } catch (err) {
    console.error('[HardwareScanner] 처리 오류:', err);
    if (onError) onError(`스캐너 자동 인쇄 실패: ${err.message}`);
  }
}
