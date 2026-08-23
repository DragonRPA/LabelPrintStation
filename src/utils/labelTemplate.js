/**
 * Multi-Template Preset Schema & ZPL II Dynamic Compiler Engine (SSOT)
 * Core Fields: 자산번호(asset_no), 제품명(product_name), 모델명(model_name), 제조번호(serial_no)
 */
import { getDbClient } from './dbClient';
import { getMainFieldName } from './dynamicSchema';

export const LOCAL_KEY_ACTIVE_TEMPLATE_ID = 'IMAGE_SCAN_ACTIVE_TEMPLATE_ID_V3';
export const LOCAL_KEY_TEMPLATE_PRESETS = 'IMAGE_SCAN_TEMPLATE_PRESETS_V3';

export const DEFAULT_LABEL_TEMPLATE = {
  templateId: 'tpl_default',
  targetTable: 'asset',
  schemaId: 'main_schema',
  name: '기본 라벨 서식 (72×40mm)',
  targetPrinterId: '',
  targetPrinterName: '',
  isDefault: true,
  paper: {
    widthMm: 72,
    heightMm: 40,
    dpi: 203,
    dotsWidth: 576,
    dotsHeight: 320
  },
  elements: []
};

/**
 * ⭐️ 100% 동적 빈 라벨 서식 생성기 (대상 테이블의 실제 스키마 필드 1:1 바인딩)
 */
export function createEmptyTemplate(name = '새 라벨 서식', targetTable = 'asset', widthMm = 72, heightMm = 40, targetPrinterId = '', targetPrinterName = '', customFields = null) {
  const dotsWidth = Math.round(widthMm * 8);
  const dotsHeight = Math.round(heightMm * 8);
  const id = `tpl_custom_${Date.now()}`;

  // 스키마 필드 결정 (인자로 넘겨받거나 로컬 스키마 조회)
  let fields = customFields;
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    try {
      const { getTableSchema } = require('./dynamicSchema');
      const s = getTableSchema(targetTable);
      fields = s?.fields || [];
    } catch (e) {
      fields = [];
    }
  }

  // 1. 스키마 기반 텍스트 요소 생성 (콤마 구분 중 첫 번째 주된 표시명 및 접두사 사용)
  const dynamicElements = fields.map((f, idx) => {
    const mainName = getMainFieldName(f.name);
    return {
      id: `elem_${f.id}`,
      name: mainName,
      type: 'text',
      field: f.id,
      prefix: f.isKey ? '' : `${mainName}: `,
      xMm: 2.0,
      yMm: Math.min(heightMm - 6, 2.0 + (idx * 4.5)),
      fontSizePt: f.isKey ? 20 : 15,
      fontFamily: 'A0N',
      visible: idx === 0 || f.isKey // 기본 키나 첫 항목은 표시
    };
  });

  // 바코드 대상 필드 (PK 또는 첫 번째 바코드 대상 필드)
  const barcodeTargetField = fields.find(f => f.isBarcodeTarget || f.isKey)?.id || (fields[0]?.id || 'asset_no');

  // 2. 바코드 요소
  dynamicElements.push({
    id: 'elem_barcode',
    name: '바코드 / QR',
    type: 'barcode',
    barcodeType: 'CODE128',
    targetField: barcodeTargetField,
    prefix: '',
    xMm: 2.0,
    yMm: Math.min(heightMm - 12, 18.0),
    heightMm: 10.0,
    qrScale: 4,
    showText: true,
    visible: true
  });

  // 3. 구분선
  dynamicElements.push({
    id: 'elem_divider',
    name: '구분선',
    type: 'line',
    xMm: 1.5,
    yMm: 7.0,
    widthMm: Math.max(10, widthMm - 3),
    thicknessMm: 0.25,
    visible: false
  });

  // 4. 추가 텍스트 1 ~ 4
  for (let i = 1; i <= 4; i++) {
    dynamicElements.push({
      id: `elem_custom_text_${i}`,
      name: `추가 텍스트 ${i}`,
      type: 'text',
      field: `custom_text_${i}`,
      customValue: '',
      prefix: '',
      xMm: 2.0,
      yMm: Math.min(heightMm - 4, 24.0 + (i * 3.5)),
      fontSizePt: 14,
      fontFamily: 'A0N',
      visible: false
    });
  }

  // 5. 이미지 / 로고
  dynamicElements.push({
    id: 'elem_image',
    name: '이미지 / 로고',
    type: 'image',
    imageDataUrl: '',
    widthMm: 18.0,
    heightMm: 12.0,
    xMm: Math.max(10, widthMm - 22.0),
    yMm: 2.0,
    visible: false
  });

  return {
    templateId: id,
    targetTable: targetTable || 'asset',
    schemaId: targetTable === 'temp_asset' ? 'temp_asset_schema' : 'asset_schema',
    name: name,
    targetPrinterId: targetPrinterId || '',
    targetPrinterName: targetPrinterName || '',
    isDefault: false,
    paper: {
      widthMm: Number(widthMm) || 72,
      heightMm: Number(heightMm) || 40,
      dpi: 203,
      dotsWidth,
      dotsHeight
    },
    elements: dynamicElements
  };
}

/**
 * 전체 프리셋 목록 로드 (서버 DB 동기화 캐시)
 */
export function getAllPresets() {
  try {
    const stored = localStorage.getItem(LOCAL_KEY_TEMPLATE_PRESETS);
    if (stored) {
      const list = JSON.parse(stored);
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    }
  } catch (e) {}
  return [];
}

/**
 * 현재 활성 템플릿 로드
 */
export function getStoredLabelTemplate() {
  try {
    const activeId = localStorage.getItem(LOCAL_KEY_ACTIVE_TEMPLATE_ID);
    const presets = getAllPresets();
    if (activeId) {
      const found = presets.find(p => p.templateId === activeId);
      if (found) return found;
    }
    if (presets.length > 0) return presets[0];
  } catch (e) {}
  return DEFAULT_LABEL_TEMPLATE;
}

/**
 * 활성 템플릿 저장 및 프리셋 목록 갱신
 */
export function saveStoredLabelTemplate(template) {
  try {
    const presets = getAllPresets();
    const idx = presets.findIndex(p => p.templateId === template.templateId);
    let updatedPresets;
    if (idx >= 0) {
      updatedPresets = [...presets];
      updatedPresets[idx] = template;
    } else {
      updatedPresets = [...presets, template];
    }
    localStorage.setItem(LOCAL_KEY_TEMPLATE_PRESETS, JSON.stringify(updatedPresets));
    localStorage.setItem(LOCAL_KEY_ACTIVE_TEMPLATE_ID, template.templateId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ⭐️ 템플릿 삭제 및 로컬/백엔드 동기화
 */
export async function deleteStoredLabelTemplate(templateId) {
  try {
    const presets = getAllPresets();
    const updatedPresets = presets.filter(p => p.templateId !== templateId);
    localStorage.setItem(LOCAL_KEY_TEMPLATE_PRESETS, JSON.stringify(updatedPresets));

    // 현재 활성 템플릿이 삭제된 경우 첫 번째 프리셋으로 전환
    const activeId = localStorage.getItem(LOCAL_KEY_ACTIVE_TEMPLATE_ID);
    if (activeId === templateId) {
      const nextId = updatedPresets[0]?.templateId || DEFAULT_LABEL_TEMPLATE.templateId;
      localStorage.setItem(LOCAL_KEY_ACTIVE_TEMPLATE_ID, nextId);
    }

    // Supabase 백엔드에서도 삭제 시도
  const client = getDbClient();
    if (client) {
      await client.from('label_templates').delete().eq('id', templateId);
    }
    return true;
  } catch (e) {
    console.warn('템플릿 삭제 실패:', e);
    return false;
  }
}

/**
 * ⭐️ Supabase 백엔드에서 전체 라벨 서식 목록 조회 (100% DB SSOT)
 */
export async function syncTemplatesWithBackend() {
  const client = getDbClient();
  if (!client) return getAllPresets();

  try {
    const { data, error } = await client
      .from('label_templates')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      // 백엔드 데이터를 템플릿 포맷으로 매핑 (isLocked 완벽 지원)
      const backendPresets = data.map(row => {
        const prnId = row.paper?.targetPrinterId || row.target_printer_id || '';
        const prnName = row.paper?.targetPrinterName || row.target_printer_name || '';
        const targetTbl = row.paper?.targetTable || row.target_table || (row.name?.includes('임시') ? 'temp_asset' : 'asset');
        const isLocked = Boolean(row.is_locked || row.paper?.isLocked);
        const paperObj = {
          ...(row.paper || { widthMm: 72, heightMm: 40, dpi: 203, dotsWidth: 576, dotsHeight: 320 }),
          targetTable: targetTbl,
          targetPrinterId: prnId,
          targetPrinterName: prnName,
          isLocked
        };

        return {
          templateId: row.id,
          targetTable: targetTbl,
          schemaId: row.schema_id || 'main_schema',
          name: row.name,
          targetPrinterId: prnId,
          targetPrinterName: prnName,
          isDefault: Boolean(row.is_default),
          isLocked,
          paper: paperObj,
          elements: Array.isArray(row.elements) ? row.elements : []
        };
      });

      // ⭐️ 100% 서버 DB에서 조회된 레코드만 로컬 스토리지에 동기화
      localStorage.setItem(LOCAL_KEY_TEMPLATE_PRESETS, JSON.stringify(backendPresets));
      return backendPresets;
    }
  } catch (err) {
    console.warn('서버 라벨 서식 조회 실패 (로컬 캐시 유지):', err);
  }

  return getAllPresets();
}

/**
 * DB 백엔드에서 활성 라벨 서식 로드
 */
export async function fetchBackendLabelTemplate() {
  const client = getDbClient();
  if (!client) return getStoredLabelTemplate();

  try {
    const { data, error } = await client
      .from('label_templates')
      .select('*')
      .eq('is_default', true)
      .maybeSingle();

    if (!error && data && data.paper && Array.isArray(data.elements)) {
      const prnId = data.paper?.targetPrinterId || data.target_printer_id || '';
      const prnName = data.paper?.targetPrinterName || data.target_printer_name || '';
      const targetTbl = data.paper?.targetTable || data.target_table || 'asset';

      const tpl = {
        templateId: data.id,
        targetTable: targetTbl,
        schemaId: data.schema_id || 'main_schema',
        name: data.name,
        targetPrinterId: prnId,
        targetPrinterName: prnName,
        paper: {
          ...data.paper,
          targetTable: targetTbl,
          targetPrinterId: prnId,
          targetPrinterName: prnName
        },
        elements: data.elements,
        isDefault: data.is_default
      };
      saveStoredLabelTemplate(tpl);
      return tpl;
    }
  } catch (err) {
    console.warn('백엔드 라벨 템플릿 로드 실패, 로컬 캐시 사용:', err);
  }
  return getStoredLabelTemplate();
}

/**
 * ⭐️ Supabase 백엔드에 라벨 서식 저장 (온라인 DB + 로컬 동시 보존)
 */
export async function saveBackendLabelTemplate(template) {
  const targetPrinterId = template.targetPrinterId || template.paper?.targetPrinterId || '';
  const targetPrinterName = template.targetPrinterName || template.paper?.targetPrinterName || '';
  const targetTable = template.targetTable || template.paper?.targetTable || 'asset';
  const isLocked = Boolean(template.isLocked || template.paper?.isLocked);

  const normalized = {
    ...template,
    targetTable,
    targetPrinterId,
    targetPrinterName,
    isLocked,
    paper: {
      ...(template.paper || { widthMm: 72, heightMm: 40, dpi: 203, dotsWidth: 576, dotsHeight: 320 }),
      targetTable,
      targetPrinterId,
      targetPrinterName,
      isLocked
    }
  };

  saveStoredLabelTemplate(normalized);
  const client = getDbClient();
  if (!client) return { success: true, message: '로컬 서식 저장 완료 (DB 클라이언트 없음)' };

  try {
    const payload = {
      id: normalized.templateId || `tpl_custom_${Date.now()}`,
      schema_id: null,
      name: normalized.name || '라벨 서식',
      paper: normalized.paper,
      elements: Array.isArray(normalized.elements) ? normalized.elements : [],
      is_default: Boolean(normalized.isDefault),
      updated_at: new Date().toISOString()
    };

    const { error } = await client.from('label_templates').upsert(payload);
    if (error) throw error;
    return { success: true, message: '온라인 DB 서식 저장 완료' };
  } catch (err) {
    console.error('백엔드 라벨 서식 저장 오류:', err);
    return { success: false, message: `DB 저장 오류: ${err.message}` };
  }
}

/**
 * ⭐️ 템플릿 확정 잠금(Lock) / 해제(Unlock) 토글 및 즉시 동기화
 */
export async function updatePresetLock(templateId, isLocked) {
  try {
    const presets = getAllPresets();
    const idx = presets.findIndex(p => p.templateId === templateId);
    if (idx >= 0) {
      presets[idx].isLocked = Boolean(isLocked);
      if (!presets[idx].paper) presets[idx].paper = {};
      presets[idx].paper.isLocked = Boolean(isLocked);
      localStorage.setItem(LOCAL_KEY_TEMPLATE_PRESETS, JSON.stringify(presets));

    const client = getDbClient();
      if (client) {
        await client.from('label_templates').update({
          paper: presets[idx].paper,
          updated_at: new Date().toISOString()
        }).eq('id', templateId);
      }
      return { success: true, isLocked: Boolean(isLocked) };
    }
  } catch (e) {
    console.warn('템플릿 잠금 상태 변경 실패:', e);
  }
  return { success: false };
}

/**
 * mm -> ZPL Dot 변환
 */
export function mmToDots(mm, dpi = 203) {
  return Math.round(Number(mm || 0) * (dpi / 25.4));
}

import JsBarcode from 'jsbarcode';

/**
 * ⭐️ UBUS 실무 검증 정통 네이티브 한글 ZPL II 생성 엔진
 * - Zebra GK-420D / ZD-420D 프린터 한글 폰트 완벽 지원 (^SEE:UHANGUL.DAT^FS^CW1,E:KFONT3.FNT^CI26^FS)
 * - 한글 텍스트: ^A1N,{h},{w} (KFONT3.FNT)
 * - 영문 텍스트: ^A0N,{h},{w}
 * - 1D 바코드: ^BY2,2.0,{h}^BCN,{h},N,N,N
 */
export function generateDynamicZpl(item = {}, template = DEFAULT_LABEL_TEMPLATE) {
  const t = template || DEFAULT_LABEL_TEMPLATE;
  const paper = t.paper || DEFAULT_LABEL_TEMPLATE.paper;
  const dpi = paper.dpi || 203;

  const dotsW = paper.dotsWidth || mmToDots(paper.widthMm, dpi);
  const dotsH = paper.dotsHeight || mmToDots(paper.heightMm, dpi);

  const getValue = (elem) => {
    if (!elem) return '';
    if (elem.field === 'custom' || elem.field?.startsWith('custom_text_')) return elem.customValue || '';
    const raw = item[elem.field] || item.data?.[elem.field] || item[elem.id];
    if (raw !== undefined && raw !== null && raw !== '') return String(raw);
    if (elem.field === 'asset_no') return String(item.key_value || item.asset_no || 'TEST0001');
    if (elem.field === 'serial_no') return String(item.serial_no || 'R5KL60F0CZW');
    if (elem.field === 'model_name') return String(item.model_name || 'SM-S921N');
    if (elem.field === 'product_name') return String(item.product_name || '갤럭시 S24');
    return '';
  };

  const hasKorean = (str) => /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(str);

  // 출력 대상 텍스트에 한글이 하나라도 포함되어 있는지 검사
  const containsKorean = (t.elements || []).some(elem => {
    if (!elem.visible || elem.type !== 'text') return false;
    const text = `${elem.prefix || ''}${getValue(elem)}`;
    return hasKorean(text);
  });

  // ⭐️ 한글 포함 시: UBUS 대형 한글 헤더, 한글 미포함(소형 QR 등): ^XA^MD21
  const zplCommands = [
    containsKorean
      ? '^XA^MD21^BY2,2.0^FS^SEE:UHANGUL.DAT^FS^CW1,E:KFONT3.FNT^CI26^FS'
      : '^XA^MD21'
  ];

  const widthMm = Number(t.paper?.widthMm) || 72;
  const dotsPerMm = dpi / 25.4;

  // ⭐️ [토글 옵션 1] ^LH (라벨 원점 자동 중앙정렬) ON 시 삽입
  if (t.paper?.useLabelHome) {
    let homeXDots = 0;
    if (typeof t.paper?.customHomeX === 'number' && !isNaN(t.paper.customHomeX)) {
      homeXDots = Math.round(t.paper.customHomeX * dotsPerMm);
    } else if (widthMm < 104) {
      homeXDots = Math.max(0, Math.round(((104.0 - widthMm) / 2.0) * dotsPerMm));
    }
    const homeYDots = Math.max(0, Math.round((Number(t.paper?.customHomeY) || 0) * dotsPerMm));
    zplCommands.push(`^LH${homeXDots},${homeYDots}`);
  }

  // ⭐️ [토글 옵션 2] ^PW (인쇄폭 선언) ON 시 삽입
  if (t.paper?.usePrintWidth) {
    const printWidthDots = Math.round(widthMm * dotsPerMm);
    zplCommands.push(`^PW${printWidthDots}`);
  }

  (t.elements || []).forEach(elem => {
    if (!elem.visible) return;

    // ⭐️ 기본 X, Y 좌표 (mm) + 개별 요소 인쇄 미세 보정값 (mm, 음수/양수 자유 허용) 정밀 합산
    const finalXMm = Math.max(0, (Number(elem.xMm) || 0) + (Number(elem.offsetX) || 0));
    const finalYMm = Math.max(0, (Number(elem.yMm) || 0) + (Number(elem.offsetY) || 0));

    const posX = mmToDots(finalXMm, dpi);
    const posY = mmToDots(finalYMm, dpi);

    if (elem.type === 'text') {
      const val = getValue(elem);
      const prefix = elem.prefix || '';
      const text = `${prefix}${val}`;
      // ⭐️ UI 설정값 그대로 1:1 ZPL 폰트 크기 매핑 (예: 25 -> ^A1N,25,25)
      const fontH = Math.max(10, Math.min(120, Math.round(elem.fontSizePt || 25)));
      const fontW = fontH;

      // 한글 포함 시 UBUS 표준 ^A1N (KFONT3), 영문 전용은 ^A0N
      const fontCmd = hasKorean(text) ? `^A1N,${fontH},${fontW}` : `^A0N,${fontH},${fontW}`;
      zplCommands.push(`^FO${posX},${posY}${fontCmd}^FD${text}^FS`);
    } else if (elem.type === 'line') {
      const lineW = mmToDots(elem.widthMm || 60, dpi);
      const lineThick = Math.max(1, mmToDots(elem.thicknessMm || 0.25, dpi));
      zplCommands.push(`^FO${posX},${posY}^GB${lineW},${lineThick},${lineThick}^FS`);
    } else if (elem.type === 'image') {
      const imgW = mmToDots(elem.widthMm || 20, dpi);
      const imgH = mmToDots(elem.heightMm || 10, dpi);
      if (elem.zplGf) {
        // ⭐️ Zebra ZPL II 표준 ^GF (Graphic Field) 고품질 비트맵 출력
        zplCommands.push(`^FO${posX},${posY}${elem.zplGf}^FS`);
      } else {
        // 이미지가 로드되지 않은 상태의 폴백
        zplCommands.push(`^FO${posX},${posY}^GB${imgW},${imgH},1^FS`);
      }
    } else if (elem.type === 'barcode') {
      const targetVal = String(getValue({ field: elem.targetField }) || item[elem.targetField] || item.key_value || 'TEST0001');
      const showTextParam = elem.showText ? 'Y' : 'N';
      const barcodeType = elem.barcodeType || 'CODE128';
      const barH = mmToDots(elem.heightMm || 10, dpi);

      if (barcodeType === 'QR') {
        const qrMag = Math.max(1, Math.min(10, elem.qrScale || 3));
        zplCommands.push(`^FO${posX},${posY}^BQN,2,${qrMag}^FDLA,${targetVal}^FS`);
      } else {
        const barHeightDots = mmToDots(elem.heightMm || 10, dpi);
        zplCommands.push(`^FO${posX},${posY}^BCN,${barHeightDots},${showTextParam}^FD${targetVal}^FS`);
      }
    }
  });

  zplCommands.push('^XZ');
  return zplCommands.join('\n');
}

/**
 * ⭐️ ImageDataUrl (Base64)을 ZPL II ^GF (Graphic Field) 16진수 비트맵 명령어로 정밀 변환
 */
export async function convertImageToZplGf(imageDataUrl, widthDots, heightDots, threshold = 128) {
  if (!imageDataUrl || widthDots <= 0 || heightDots <= 0) return null;

  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = widthDots;
          canvas.height = heightDots;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(null);

          // 배경 흰색으로 채우기 (투명 PNG 알파 채널 투과 대비)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, widthDots, heightDots);
          ctx.drawImage(img, 0, 0, widthDots, heightDots);

          const imgData = ctx.getImageData(0, 0, widthDots, heightDots);
          const pixels = imgData.data;

          const bytesPerRow = Math.ceil(widthDots / 8);
          const totalBytes = bytesPerRow * heightDots;
          let hexData = '';

          for (let y = 0; y < heightDots; y++) {
            let byteVal = 0;
            let bitCount = 0;

            for (let x = 0; x < widthDots; x++) {
              const idx = (y * widthDots + x) * 4;
              const r = pixels[idx];
              const g = pixels[idx + 1];
              const b = pixels[idx + 2];
              const a = pixels[idx + 3];

              // ITU-R BT.601 표준 루미넌스 계산
              const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
              // 투명 픽셀이거나 밝은 픽셀은 흰색(0), 어두운 픽셀은 검은색(1)
              const isBlack = (a > 64 && luminance < threshold) ? 1 : 0;

              byteVal = (byteVal << 1) | isBlack;
              bitCount++;

              if (bitCount === 8) {
                hexData += byteVal.toString(16).padStart(2, '0').toUpperCase();
                byteVal = 0;
                bitCount = 0;
              }
            }

            // 행 끝의 나머지 비트 패딩
            if (bitCount > 0) {
              byteVal = byteVal << (8 - bitCount);
              hexData += byteVal.toString(16).padStart(2, '0').toUpperCase();
            }
          }

          resolve(`^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hexData}`);
        } catch (e) {
          console.warn('Canvas 이미지 ZPL 변환 오류:', e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageDataUrl;
    } else {
      resolve(null);
    }
  });
}

/**
 * ⭐️ 이미지 요소를 포함한 비동기 ZPL 생성 엔진 (필요 시 실시간 ^GF 변환 보장)
 */
export async function generateDynamicZplAsync(item = {}, template = DEFAULT_LABEL_TEMPLATE) {
  if (!template || !Array.isArray(template.elements)) return '';

  const dpi = template.paper?.dpi || 203;

  // 모든 이미지 요소의 zplGf 비동기 보장
  for (const elem of template.elements) {
    if (elem.type === 'image' && elem.visible && elem.imageDataUrl && !elem.zplGf) {
      const imgW = mmToDots(elem.widthMm || 20, dpi);
      const imgH = mmToDots(elem.heightMm || 10, dpi);
      elem.zplGf = await convertImageToZplGf(elem.imageDataUrl, imgW, imgH);
    }
  }

  return generateDynamicZpl(item, template);
}

/**
 * ⭐️ 호환성 유지용 WYSIWYG ZPL 비동기 래퍼
 */
export async function generateWysiwygZpl(item = {}, template = DEFAULT_LABEL_TEMPLATE) {
  return generateDynamicZplAsync(item, template);
}
