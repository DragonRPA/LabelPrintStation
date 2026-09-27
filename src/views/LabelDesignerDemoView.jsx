import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sliders,
  RotateCcw,
  Save,
  Printer,
  Eye,
  Code,
  CheckSquare,
  Square,
  Plus,
  FolderOpen,
  Trash2,
  Database,
  X,
  Minus,
  Copy,
  Download,
  Upload,
  FileJson,
  Layers,
  Sparkles,
  ArrowLeft,
  CheckCircle,
  Play,
  Monitor
} from 'lucide-react';
import { generateCode39DataUrl, RealBarcodeSvg } from '../utils/barcode39';

// ── [1] 데모용 모의 프린터 목록 ───────────────────────────────────────────
const MOCK_PRINTERS = [
  { id: 'mock_zt411', name: 'Zebra ZT411 (203dpi - 8dot/mm 산업용)', dpi: 203, dpmm: 8, type: 'LAN' },
  { id: 'mock_gk420d', name: 'Zebra GK420d (203dpi - 8dot/mm 데스크톱)', dpi: 203, dpmm: 8, type: 'USB' },
  { id: 'mock_zd420', name: 'Zebra ZD420 (300dpi - 12dot/mm 고해상도)', dpi: 300, dpmm: 12, type: 'USB' },
  { id: 'mock_virtual', name: '가상 라벨 에뮬레이터 (Virtual PDF/ZPL)', dpi: 203, dpmm: 8, type: 'VIRTUAL' }
];

// ── [2] 데모용 모의 비즈니스 스키마 4종 ────────────────────────────────────
const MOCK_SCHEMAS = {
  asset: {
    id: 'asset',
    name: '자산 관리 (IT / 렌탈 장비)',
    key_field: 'asset_no',
    fields: [
      { id: 'asset_no', name: '자산번호', sample: '226080599' },
      { id: 'product_name', name: '제품명', sample: '삼성 갤럭시북4 프로' },
      { id: 'model_name', name: '모델명', sample: 'NT960XGK-KC71G' },
      { id: 'serial_no', name: '제조번호(시리얼)', sample: 'R5KL60F0CZW' },
      { id: 'category_major', name: '대분류', sample: 'IT' },
      { id: 'asset_status', name: '자산상태', sample: '임대가능' },
      { id: 'shelf_no', name: '선반위치', sample: 'A-03-12' },
      { id: 'mac_wlan', name: 'MAC 주소', sample: '4C:EB:B0:B5:7A:51' },
      { id: 'imei', name: 'IMEI', sample: '351223350513050' },
      { id: 'calibration_date', name: '도입일자', sample: '2026-03-15' },
      { id: 'remark', name: '비고', sample: '본체+어댑터+가방' }
    ]
  },
  logistics: {
    id: 'logistics',
    name: '물류 / 택배 송장',
    key_field: 'tracking_no',
    fields: [
      { id: 'tracking_no', name: '송장번호', sample: '6824-9102-3341' },
      { id: 'recipient', name: '수취인명', sample: '홍길동 고객님' },
      { id: 'phone', name: '연락처', sample: '010-9876-5432' },
      { id: 'address', name: '배송지 주소', sample: '서울특별시 강남구 테헤란로 152' },
      { id: 'box_count', name: '박스수량', sample: '1 of 3' },
      { id: 'courier', name: '배송사', sample: 'Dragon Express' },
      { id: 'caution', name: '취급주의', sample: '파손주의 / 당일특급' }
    ]
  },
  parts: {
    id: 'parts',
    name: '제조 / 자재 부품',
    key_field: 'part_code',
    fields: [
      { id: 'part_code', name: '부품코드', sample: 'PRT-MCU-8840' },
      { id: 'part_name', name: '부품명', sample: '메인보드 제어 MCU' },
      { id: 'spec', name: '규격사양', sample: 'ARM Cortex-M4 120MHz' },
      { id: 'lot_no', name: 'LOT 번호', sample: 'LOT-202609-08' },
      { id: 'qty', name: '입고수량', sample: '500 PCS' },
      { id: 'in_date', name: '입고일자', sample: '2026-09-26' },
      { id: 'inspector', name: '검수자', sample: '이정용 선임' }
    ]
  },
  medical: {
    id: 'medical',
    name: '의료 / 시약 검체',
    key_field: 'sample_id',
    fields: [
      { id: 'sample_id', name: '검체식별번호', sample: 'SMP-2026-9901' },
      { id: 'patient_name', name: '환자식별코드', sample: 'PT-88021' },
      { id: 'reagent_name', name: '시약명', sample: '혈청 생화학 시약 Kit' },
      { id: 'temp_condition', name: '보관조건', sample: '냉장보관 (2~8℃)' },
      { id: 'exp_date', name: '유효기한', sample: '2027-12-31' },
      { id: 'qr_data', name: '2D 식별정보', sample: 'MED:SMP9901:EXP20271231' }
    ]
  }
};

// ── [3] 데모용 6대 라벨 서식 프리셋 ─────────────────────────────────────────
const DEMO_PRESETS = [
  {
    templateId: 'demo_tpl_standard_asset',
    name: '표준 자산 라벨 (72×40mm)',
    schemaId: 'asset',
    targetPrinterId: 'mock_zt411',
    paper: { widthMm: 72, heightMm: 40, orientation: 'N', gapMm: 3 },
    elements: [
      { id: 'el_title', type: 'text', text: '자산 관리 라벨', xMm: 3, yMm: 3, fontSize: 13, bold: true },
      { id: 'el_barcode', type: 'barcode_code128', bindField: 'asset_no', xMm: 3, yMm: 8, heightMm: 12, showText: true, text: '226080599' },
      { id: 'el_prod', type: 'text', bindField: 'product_name', text: '삼성 갤럭시북4 프로', xMm: 3, yMm: 23, fontSize: 11, bold: true },
      { id: 'el_model', type: 'text', bindField: 'model_name', text: '모델: NT960XGK-KC71G', xMm: 3, yMm: 28, fontSize: 10, bold: false },
      { id: 'el_sn', type: 'text', bindField: 'serial_no', text: 'S/N: R5KL60F0CZW', xMm: 3, yMm: 33, fontSize: 10, bold: false },
      { id: 'el_box', type: 'box', xMm: 1, yMm: 1, widthMm: 70, heightMm: 38, borderThickness: 1 }
    ]
  },
  {
    templateId: 'demo_tpl_compact_qr',
    name: '소형 QR 자산 라벨 (40×20mm)',
    schemaId: 'asset',
    targetPrinterId: 'mock_gk420d',
    paper: { widthMm: 40, heightMm: 20, orientation: 'N', gapMm: 2 },
    elements: [
      { id: 'el_qr', type: 'qr', bindField: 'asset_no', xMm: 2, yMm: 2, size: 4, text: '226080599' },
      { id: 'el_txt_asset', type: 'text', bindField: 'asset_no', text: '226080599', xMm: 18, yMm: 3, fontSize: 11, bold: true },
      { id: 'el_txt_model', type: 'text', bindField: 'model_name', text: 'NT960XGK', xMm: 18, yMm: 8, fontSize: 9, bold: false },
      { id: 'el_txt_sn', type: 'text', bindField: 'serial_no', text: 'R5KL60F0CZW', xMm: 18, yMm: 13, fontSize: 8, bold: false }
    ]
  },
  {
    templateId: 'demo_tpl_logistics',
    name: '물류 송장 라벨 (100×60mm)',
    schemaId: 'logistics',
    targetPrinterId: 'mock_zt411',
    paper: { widthMm: 100, heightMm: 60, orientation: 'N', gapMm: 3 },
    elements: [
      { id: 'el_logi_title', type: 'text', text: 'DRAGON EXPRESS 배송 송장', xMm: 4, yMm: 4, fontSize: 14, bold: true },
      { id: 'el_logi_bc', type: 'barcode_code128', bindField: 'tracking_no', xMm: 4, yMm: 10, heightMm: 16, showText: true, text: '6824-9102-3341' },
      { id: 'el_recip', type: 'text', bindField: 'recipient', text: '받는분: 홍길동 고객님 (010-9876-5432)', xMm: 4, yMm: 30, fontSize: 11, bold: true },
      { id: 'el_addr', type: 'text', bindField: 'address', text: '주소: 서울특별시 강남구 테헤란로 152', xMm: 4, yMm: 36, fontSize: 10, bold: false },
      { id: 'el_box', type: 'text', bindField: 'box_count', text: '수량: 1 of 3 (파손주의)', xMm: 4, yMm: 42, fontSize: 10, bold: true },
      { id: 'el_qr_track', type: 'qr', bindField: 'tracking_no', xMm: 76, yMm: 30, size: 5, text: 'https://dragonrpa.co.kr/track/6824-9102-3341' },
      { id: 'el_border', type: 'box', xMm: 2, yMm: 2, widthMm: 96, heightMm: 56, borderThickness: 2 }
    ]
  },
  {
    templateId: 'demo_tpl_parts',
    name: '제조 자재 부품 라벨 (80×40mm)',
    schemaId: 'parts',
    targetPrinterId: 'mock_zd420',
    paper: { widthMm: 80, heightMm: 40, orientation: 'N', gapMm: 3 },
    elements: [
      { id: 'el_p_title', type: 'text', text: '[입고 부품 식별표]', xMm: 3, yMm: 3, fontSize: 12, bold: true },
      { id: 'el_p_code_bc', type: 'barcode_code128', bindField: 'part_code', xMm: 3, yMm: 8, heightMm: 12, showText: true, text: 'PRT-MCU-8840' },
      { id: 'el_p_name', type: 'text', bindField: 'part_name', text: '품명: 메인보드 제어 MCU', xMm: 3, yMm: 23, fontSize: 11, bold: true },
      { id: 'el_p_lot', type: 'text', bindField: 'lot_no', text: 'LOT: LOT-202609-08 | 수량: 500 PCS', xMm: 3, yMm: 29, fontSize: 10, bold: false },
      { id: 'el_p_date', type: 'text', bindField: 'in_date', text: '입고일: 2026-09-26 | 검수: 이정용', xMm: 3, yMm: 34, fontSize: 9, bold: false },
      { id: 'el_p_box', type: 'box', xMm: 1, yMm: 1, widthMm: 78, heightMm: 38, borderThickness: 1 }
    ]
  },
  {
    templateId: 'demo_tpl_medical',
    name: '의료 시약 검체 라벨 (50×30mm)',
    schemaId: 'medical',
    targetPrinterId: 'mock_zd420',
    paper: { widthMm: 50, heightMm: 30, orientation: 'N', gapMm: 2 },
    elements: [
      { id: 'el_med_title', type: 'text', text: '임상 검체 라벨', xMm: 2, yMm: 2, fontSize: 11, bold: true },
      { id: 'el_med_qr', type: 'qr', bindField: 'sample_id', xMm: 2, yMm: 8, size: 4, text: 'SMP-2026-9901' },
      { id: 'el_med_id', type: 'text', bindField: 'sample_id', text: 'ID: SMP-2026-9901', xMm: 18, yMm: 8, fontSize: 10, bold: true },
      { id: 'el_med_pt', type: 'text', bindField: 'patient_name', text: '환자: PT-88021', xMm: 18, yMm: 13, fontSize: 9, bold: false },
      { id: 'el_med_temp', type: 'text', bindField: 'temp_condition', text: '보관: 2~8℃ 냉장', xMm: 18, yMm: 18, fontSize: 8, bold: true },
      { id: 'el_med_exp', type: 'text', bindField: 'exp_date', text: '기한: 2027-12-31', xMm: 18, yMm: 23, fontSize: 8, bold: false }
    ]
  },
  {
    templateId: 'demo_tpl_telecom',
    name: '통신장비 IMEI/MAC 라벨 (60×30mm)',
    schemaId: 'asset',
    targetPrinterId: 'mock_zt411',
    paper: { widthMm: 60, heightMm: 30, orientation: 'N', gapMm: 2 },
    elements: [
      { id: 'el_t_imei_bc', type: 'barcode_code128', bindField: 'imei', xMm: 3, yMm: 2, heightMm: 10, showText: true, text: '351223350513050' },
      { id: 'el_t_mac_bc', type: 'barcode_code128', bindField: 'mac_wlan', xMm: 3, yMm: 15, heightMm: 9, showText: true, text: '4CEBB0B57A51' },
      { id: 'el_t_sn', type: 'text', bindField: 'serial_no', text: 'SN: R5KL60F0CZW', xMm: 3, yMm: 26, fontSize: 8, bold: false }
    ]
  }
];

// mm ➔ dots 계산 (203dpi = 8dots/mm)
function mmToDots(mm, dpmm = 8) {
  return Math.round(Number(mm || 0) * dpmm);
}

// ZPL II 실시간 생성기
function compileDemoZpl(template, sampleData, dpmm = 8) {
  if (!template) return '^XA\n^XZ';

  const wDots = mmToDots(template.paper?.widthMm || 72, dpmm);
  const hDots = mmToDots(template.paper?.heightMm || 40, dpmm);

  let zpl = '^XA\n';
  zpl += `^PW${wDots}\n`;
  zpl += `^LL${hDots}\n`;
  zpl += '^LH0,0\n';
  zpl += '^CI28\n'; // UTF-8 한글 인코딩

  (template.elements || []).forEach(elem => {
    const x = mmToDots(elem.xMm || 0, dpmm);
    const y = mmToDots(elem.yMm || 0, dpmm);
    let val = elem.text || '';
    if (elem.bindField && sampleData[elem.bindField]) {
      val = sampleData[elem.bindField];
    }

    if (elem.type === 'text') {
      const fontH = Math.round((elem.fontSize || 10) * 2.8);
      const fontW = Math.round(fontH * 0.85);
      zpl += `^FO${x},${y}^A0N,${fontH},${fontW}^FD${val}^FS\n`;
    } else if (elem.type === 'barcode_code128') {
      const bcH = mmToDots(elem.heightMm || 12, dpmm);
      const printText = elem.showText !== false ? 'Y' : 'N';
      zpl += `^FO${x},${y}^BCN,${bcH},${printText},N,N^FD${val}^FS\n`;
    } else if (elem.type === 'qr') {
      const mag = elem.size || 4;
      zpl += `^FO${x},${y}^BQN,2,${mag}^FDQA,${val}^FS\n`;
    } else if (elem.type === 'box') {
      const bw = mmToDots(elem.widthMm || 40, dpmm);
      const bh = mmToDots(elem.heightMm || 20, dpmm);
      const thick = elem.borderThickness || 1;
      zpl += `^FO${x},${y}^GB${bw},${bh},${thick}^FS\n`;
    } else if (elem.type === 'line_h') {
      const len = mmToDots(elem.widthMm || 40, dpmm);
      const thick = elem.borderThickness || 1;
      zpl += `^FO${x},${y}^GB${len},0,${thick}^FS\n`;
    }
  });

  zpl += '^PQ1,0,1,Y\n';
  zpl += '^XZ';
  return zpl;
}

export default function LabelDesignerDemoView() {
  const [template, setTemplate] = useState(() => DEMO_PRESETS[0]);
  const [activeSchemaId, setActiveSchemaId] = useState('asset');
  const [activePrinterId, setActivePrinterId] = useState('mock_zt411');
  const [selectedElemId, setSelectedElemId] = useState(null);
  const [showZplCode, setShowZplCode] = useState(false);
  const [isVirtualPrinting, setIsVirtualPrinting] = useState(false);
  const [virtualPrintLog, setVirtualPrintLog] = useState(null);

  // 샘플 데이터 상태
  const [sampleData, setSampleData] = useState(() => {
    const init = {};
    MOCK_SCHEMAS.asset.fields.forEach(f => init[f.id] = f.sample);
    return init;
  });

  // 캔버스 드래그 상태
  const [draggingId, setDraggingId] = useState(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [elemStartPos, setElemStartPos] = useState({ xMm: 0, yMm: 0 });
  const canvasRef = useRef(null);

  const PX_PER_MM = 8.5;
  const canvasWidthPx = template ? (template.paper?.widthMm || 72) * PX_PER_MM : 72 * PX_PER_MM;
  const canvasHeightPx = template ? (template.paper?.heightMm || 40) * PX_PER_MM : 40 * PX_PER_MM;

  // 스키마 변경 시 샘플 데이터 자동 갱신
  const handleSchemaChange = (schemaId) => {
    setActiveSchemaId(schemaId);
    const schema = MOCK_SCHEMAS[schemaId];
    if (schema) {
      const newData = {};
      schema.fields.forEach(f => newData[f.id] = f.sample);
      setSampleData(newData);
    }
  };

  // 프리셋 로드
  const handleLoadPreset = (preset) => {
    setTemplate(JSON.parse(JSON.stringify(preset)));
    if (preset.schemaId && MOCK_SCHEMAS[preset.schemaId]) {
      handleSchemaChange(preset.schemaId);
    }
    if (preset.targetPrinterId) {
      setActivePrinterId(preset.targetPrinterId);
    }
    setSelectedElemId(null);
  };

  // 실시간 ZPL 코드 계산
  const currentZpl = useMemo(() => {
    const printer = MOCK_PRINTERS.find(p => p.id === activePrinterId) || MOCK_PRINTERS[0];
    return compileDemoZpl(template, sampleData, printer.dpmm);
  }, [template, sampleData, activePrinterId]);

  // 요소 선택
  const selectedElem = useMemo(() => {
    if (!template || !selectedElemId) return null;
    return (template.elements || []).find(e => e.id === selectedElemId);
  }, [template, selectedElemId]);

  // 요소 속성 업데이트
  const updateSelectedElem = (updates) => {
    if (!selectedElemId || !template) return;
    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(el => el.id === selectedElemId ? { ...el, ...updates } : el)
    }));
  };

  // 요소 추가
  const handleAddElement = (type) => {
    const id = `el_${type}_${Date.now()}`;
    let newElem = { id, type, xMm: 5, yMm: 5 };

    if (type === 'text') {
      newElem = { ...newElem, text: '새 텍스트 항목', fontSize: 11, bold: false };
    } else if (type === 'barcode_code128') {
      newElem = { ...newElem, text: 'SAMPLE-1234', heightMm: 12, showText: true };
    } else if (type === 'qr') {
      newElem = { ...newElem, text: 'https://dragonrpa.co.kr', size: 4 };
    } else if (type === 'box') {
      newElem = { ...newElem, widthMm: 30, heightMm: 15, borderThickness: 1 };
    } else if (type === 'line_h') {
      newElem = { ...newElem, widthMm: 40, borderThickness: 1 };
    }

    setTemplate(prev => ({
      ...prev,
      elements: [...(prev.elements || []), newElem]
    }));
    setSelectedElemId(id);
  };

  // 요소 삭제
  const handleDeleteSelected = () => {
    if (!selectedElemId) return;
    setTemplate(prev => ({
      ...prev,
      elements: (prev.elements || []).filter(el => el.id !== selectedElemId)
    }));
    setSelectedElemId(null);
  };

  // 마우스 드래그 핸들러
  const handleMouseDown = (elemId, e) => {
    e.stopPropagation();
    setSelectedElemId(elemId);
    setDraggingId(elemId);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    const target = template.elements.find(el => el.id === elemId);
    if (target) {
      setElemStartPos({ xMm: target.xMm || 0, yMm: target.yMm || 0 });
    }
  };

  const handleMouseMove = (e) => {
    if (!draggingId) return;
    const dxPx = e.clientX - dragStartPos.x;
    const dyPx = e.clientY - dragStartPos.y;
    const dxMm = dxPx / PX_PER_MM;
    const dyMm = dyPx / PX_PER_MM;

    const newX = Math.max(0, Math.round(elemStartPos.xMm + dxMm));
    const newY = Math.max(0, Math.round(elemStartPos.yMm + dyMm));

    updateSelectedElem({ xMm: newX, yMm: newY });
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  // 가상 인쇄 시뮬레이터 실행
  const handleVirtualPrint = () => {
    setIsVirtualPrinting(true);
    const printer = MOCK_PRINTERS.find(p => p.id === activePrinterId);
    setTimeout(() => {
      setIsVirtualPrinting(false);
      setVirtualPrintLog({
        time: new Date().toLocaleTimeString(),
        printer: printer.name,
        widthMm: template.paper.widthMm,
        heightMm: template.paper.heightMm,
        elementsCount: template.elements.length,
        zplSnippet: currentZpl.slice(0, 80) + '...'
      });
    }, 800);
  };

  // 서식 JSON 다운로드
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(template, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `${template.name || 'label_template'}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        width: '100%',
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '8px 12px',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        .demo-panel-scroll::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .demo-panel-scroll::-webkit-scrollbar-track {
          background: #0f172a;
          border-radius: 4px;
        }
        .demo-panel-scroll::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 4px;
        }
        .demo-panel-scroll::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
      {/* ── [1] 상단 네비게이션 헤더 ── */}
      <header style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #334155',
        marginBottom: '10px',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a
            href="./"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#38bdf8',
              textDecoration: 'none',
              fontSize: '0.78rem',
              fontWeight: 600,
              padding: '4px 8px',
              borderRadius: '4px',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.2)'
            }}
          >
            <ArrowLeft size={13} /> 메인 스테이션 복귀
          </a>
          <div style={{
            backgroundColor: '#0284c7',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '4px',
            fontWeight: 800,
            fontSize: '0.78rem'
          }}>
            DEMO
          </div>
          <div>
            <h1 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#f8fafc' }}>
              라벨 서식 디자이너 인터랙티브 데모
            </h1>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
              WYSIWYG 캔버스 설계 · 실시간 ZPL II 코드 컴파일러 · 가상 인쇄 시뮬레이터
            </span>
          </div>
        </div>

        {/* 액션 버튼군 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setShowZplCode(!showZplCode)}
            className="btn btn-outline"
            style={{
              padding: '4px 10px',
              fontSize: '0.74rem',
              borderColor: showZplCode ? '#38bdf8' : '#475569',
              color: showZplCode ? '#38bdf8' : '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Code size={13} /> {showZplCode ? 'ZPL 숨기기' : 'ZPL 코드 보기'}
          </button>
          <button
            onClick={handleExportJson}
            className="btn btn-outline"
            style={{
              padding: '4px 10px',
              fontSize: '0.74rem',
              borderColor: '#475569',
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Download size={13} /> JSON 저장
          </button>
          <button
            onClick={handleVirtualPrint}
            disabled={isVirtualPrinting}
            className="btn btn-primary"
            style={{
              padding: '4px 12px',
              fontSize: '0.74rem',
              backgroundColor: '#0284c7',
              borderColor: '#38bdf8',
              color: '#fff',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              boxShadow: '0 0 10px rgba(56, 189, 248, 0.4)'
            }}
          >
            <Printer size={13} /> {isVirtualPrinting ? '가상 인쇄중...' : '모의 인쇄 실행'}
          </button>
        </div>
      </header>

      {/* ── [2] 메인 3분할 작업대 레이아웃 ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr 340px',
        gap: '10px',
        alignItems: 'start'
      }}>
        {/* ◀ 좌측 패널: 서식 프리셋 / 모의 프린터 / 스키마 선택 */}
        <div
          className="demo-panel-scroll"
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxHeight: 'calc(100vh - 85px)',
            overflowY: 'auto',
            boxSizing: 'border-box'
          }}
        >
          {/* 1. 프리셋 템플릿 선택 */}
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              서식 프리셋 선택 (6종)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {DEMO_PRESETS.map(p => {
                const isActive = template?.templateId === p.templateId;
                return (
                  <button
                    key={p.templateId}
                    onClick={() => handleLoadPreset(p)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: '0.72rem',
                      borderRadius: '4px',
                      border: isActive ? '1px solid #38bdf8' : '1px solid #334155',
                      backgroundColor: isActive ? 'rgba(2, 132, 199, 0.25)' : '#0f172a',
                      color: isActive ? '#38bdf8' : '#cbd5e1',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer'
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 모의 프린터 선택 */}
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              모의 출력 프린터
            </label>
            <select
              value={activePrinterId}
              onChange={(e) => setActivePrinterId(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '5px 8px',
                color: '#f8fafc',
                fontSize: '0.72rem'
              }}
            >
              {MOCK_PRINTERS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* 3. 모의 스키마 선택 */}
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              모의 데이터 도메인 스키마
            </label>
            <select
              value={activeSchemaId}
              onChange={(e) => handleSchemaChange(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '5px 8px',
                color: '#f8fafc',
                fontSize: '0.72rem'
              }}
            >
              {Object.values(MOCK_SCHEMAS).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 4. 용지 규격 조절 */}
          <div style={{
            backgroundColor: '#0f172a',
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid #334155'
          }}>
            <span style={{ fontSize: '0.70rem', fontWeight: 700, color: '#38bdf8', display: 'block', marginBottom: '6px' }}>
              용지 규격 설정
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <label style={{ fontSize: '0.66rem', color: '#94a3b8' }}>가로 (mm)</label>
                <input
                  type="number"
                  value={template?.paper?.widthMm || 72}
                  onChange={(e) => setTemplate(prev => ({
                    ...prev,
                    paper: { ...prev.paper, widthMm: Number(e.target.value) }
                  }))}
                  style={{
                    width: '100%',
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '4px',
                    color: '#fff',
                    fontSize: '0.72rem'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.66rem', color: '#94a3b8' }}>세로 (mm)</label>
                <input
                  type="number"
                  value={template?.paper?.heightMm || 40}
                  onChange={(e) => setTemplate(prev => ({
                    ...prev,
                    paper: { ...prev.paper, heightMm: Number(e.target.value) }
                  }))}
                  style={{
                    width: '100%',
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '4px',
                    color: '#fff',
                    fontSize: '0.72rem'
                  }}
                />
              </div>
            </div>
          </div>

          {/* 5. 도구 추가 버튼군 */}
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              라벨 객체 추가
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={() => handleAddElement('text')}
                className="btn btn-outline"
                style={{ fontSize: '0.70rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}
              >
                <Plus size={11} /> 텍스트
              </button>
              <button
                onClick={() => handleAddElement('barcode_code128')}
                className="btn btn-outline"
                style={{ fontSize: '0.70rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}
              >
                <Plus size={11} /> 바코드
              </button>
              <button
                onClick={() => handleAddElement('qr')}
                className="btn btn-outline"
                style={{ fontSize: '0.70rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}
              >
                <Plus size={11} /> QR 코드
              </button>
              <button
                onClick={() => handleAddElement('box')}
                className="btn btn-outline"
                style={{ fontSize: '0.70rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}
              >
                <Plus size={11} /> 테두리 사각형
              </button>
            </div>
          </div>
        </div>

        {/* ◀ 중앙 패널: WYSIWYG 캔버스 작업대 + ZPL 코드 뷰어 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          {/* 캔버스 상단 툴바 (고정 높이 38px로 버튼 유무에 따른 흔들림 완벽 방지) */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '0 12px',
            height: '38px',
            minHeight: '38px',
            maxHeight: '38px',
            boxSizing: 'border-box'
          }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>캔버스 작업대:</span>
              <strong style={{ color: '#38bdf8' }}>{template?.paper?.widthMm} × {template?.paper?.heightMm} mm</strong>
              <span style={{ color: '#475569' }}>|</span>
              <span style={{ color: '#94a3b8', fontSize: '0.70rem' }}>총 {template?.elements?.length || 0}개 객체</span>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '26px' }}>
              <button
                onClick={handleDeleteSelected}
                disabled={!selectedElem}
                style={{
                  backgroundColor: selectedElem ? '#ef4444' : 'transparent',
                  color: selectedElem ? '#ffffff' : '#475569',
                  border: selectedElem ? '1px solid #dc2626' : '1px solid #334155',
                  borderRadius: '4px',
                  padding: '0 10px',
                  height: '26px',
                  fontSize: '0.70rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: selectedElem ? 'pointer' : 'not-allowed',
                  opacity: selectedElem ? 1 : 0.4,
                  transition: 'all 0.15s ease',
                  boxSizing: 'border-box'
                }}
              >
                <Trash2 size={11} /> 선택 객체 삭제
              </button>
            </div>
          </div>

          {/* 캔버스 영역 */}
          <div style={{
            backgroundColor: '#0f172a',
            border: '2px dashed #334155',
            borderRadius: '8px',
            padding: '24px',
            minHeight: '420px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'auto'
          }}>
            <div
              ref={canvasRef}
              style={{
                width: `${canvasWidthPx}px`,
                height: `${canvasHeightPx}px`,
                backgroundColor: '#ffffff',
                color: '#000000',
                position: 'relative',
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                borderRadius: '3px',
                userSelect: 'none',
                overflow: 'hidden'
              }}
              onClick={() => setSelectedElemId(null)}
            >
              {(template?.elements || []).map(elem => {
                const isSelected = selectedElemId === elem.id;
                const xPx = (elem.xMm || 0) * PX_PER_MM;
                const yPx = (elem.yMm || 0) * PX_PER_MM;
                let val = elem.text || '';
                if (elem.bindField && sampleData[elem.bindField]) {
                  val = sampleData[elem.bindField];
                }

                return (
                  <div
                    key={elem.id}
                    onMouseDown={(e) => handleMouseDown(elem.id, e)}
                    style={{
                      position: 'absolute',
                      left: `${xPx}px`,
                      top: `${yPx}px`,
                      cursor: 'move',
                      outline: isSelected ? '2px solid #0284c7' : '1px dashed transparent',
                      backgroundColor: isSelected ? 'rgba(2, 132, 199, 0.08)' : 'transparent',
                      padding: '1px'
                    }}
                  >
                    {elem.type === 'text' && (
                      <span style={{
                        fontSize: `${(elem.fontSize || 10) * 1.3}px`,
                        fontWeight: elem.bold ? 'bold' : 'normal',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap'
                      }}>
                        {val}
                      </span>
                    )}

                    {elem.type === 'barcode_code128' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <RealBarcodeSvg
                          value={val || 'SAMPLE'}
                          height={(elem.heightMm || 12) * PX_PER_MM * 0.75}
                          width={1.6}
                          displayValue={false}
                        />
                        {elem.showText !== false && (
                          <span style={{ fontSize: '9px', fontWeight: 600, marginTop: '1px' }}>{val}</span>
                        )}
                      </div>
                    )}

                    {elem.type === 'qr' && (
                      <div style={{
                        width: `${(elem.size || 4) * 12}px`,
                        height: `${(elem.size || 4) * 12}px`,
                        backgroundColor: '#000',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        fontWeight: 700,
                        textAlign: 'center',
                        padding: '2px'
                      }}>
                        QR
                      </div>
                    )}

                    {elem.type === 'box' && (
                      <div style={{
                        width: `${(elem.widthMm || 40) * PX_PER_MM}px`,
                        height: `${(elem.heightMm || 20) * PX_PER_MM}px`,
                        border: `${elem.borderThickness || 1}px solid #000000`,
                        boxSizing: 'border-box'
                      }} />
                    )}

                    {elem.type === 'line_h' && (
                      <div style={{
                        width: `${(elem.widthMm || 40) * PX_PER_MM}px`,
                        height: `${elem.borderThickness || 1}px`,
                        backgroundColor: '#000000'
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ZPL 코드 뷰어 (펼침 상태일 때) */}
          {showZplCode && (
            <div style={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '10px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Code size={13} /> 실시간 컴파일된 Zebra ZPL II 코드
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(currentZpl);
                    alert('ZPL 코드가 클립보드에 복사되었습니다.');
                  }}
                  className="btn btn-outline"
                  style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                >
                  <Copy size={11} /> 코드 복사
                </button>
              </div>
              <textarea
                readOnly
                value={currentZpl}
                style={{
                  width: '100%',
                  height: '110px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#4ade80',
                  fontFamily: 'monospace',
                  fontSize: '0.72rem',
                  padding: '6px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          )}

          {/* 가상 인쇄 시뮬레이터 결과창 */}
          {virtualPrintLog && (
            <div style={{
              backgroundColor: '#052e16',
              border: '1px solid #10b981',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#86efac',
              fontSize: '0.72rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle size={14} style={{ color: '#4ade80' }} />
                <span>
                  <strong>[{virtualPrintLog.time}] 모의 인쇄 완료:</strong> {virtualPrintLog.printer} ({virtualPrintLog.widthMm}×{virtualPrintLog.heightMm}mm, 객체 {virtualPrintLog.elementsCount}개)
                </span>
              </div>
              <button
                onClick={() => setVirtualPrintLog(null)}
                style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* ◀ 우측 패널: 선택된 객체 속성 인스펙터 & 샘플 데이터 바인딩 */}
        <div
          className="demo-panel-scroll"
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxHeight: 'calc(100vh - 85px)',
            overflowY: 'auto',
            boxSizing: 'border-box'
          }}
        >
          {/* 섹션 1: 객체 속성 편집 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Sliders size={13} /> 객체 속성 편집
              </h2>
              {selectedElem && (
                <span style={{ fontSize: '0.64rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 600 }}>
                  {selectedElem.type}
                </span>
              )}
            </div>

            {selectedElem ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* 1. 객체 유형 */}
                <div>
                  <label style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>객체 유형</label>
                  <input
                    type="text"
                    readOnly
                    value={selectedElem.type}
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#94a3b8', fontSize: '0.72rem', boxSizing: 'border-box' }}
                  />
                </div>

                {/* 2. 동적 데이터 바인딩 (text, barcode, qr) */}
                {['text', 'barcode_code128', 'qr'].includes(selectedElem.type) && (
                  <div>
                    <label style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>동적 데이터 바인딩</label>
                    <select
                      value={selectedElem.bindField || ''}
                      onChange={(e) => updateSelectedElem({ bindField: e.target.value || null })}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                    >
                      <option value="">(고정 텍스트/직접 입력)</option>
                      {(MOCK_SCHEMAS[activeSchemaId]?.fields || []).map(f => (
                        <option key={f.id} value={f.id}>{f.name} ({f.id})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 3. 출력 텍스트/기본값 (text, barcode, qr) */}
                {['text', 'barcode_code128', 'qr'].includes(selectedElem.type) && (
                  <div>
                    <label style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>출력 텍스트/기본값</label>
                    <input
                      type="text"
                      value={selectedElem.text || ''}
                      onChange={(e) => updateSelectedElem({ text: e.target.value })}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                    />
                  </div>
                )}

                {/* 4. 좌표 X, Y */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div>
                    <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>X 좌표 (mm)</label>
                    <input
                      type="number"
                      value={selectedElem.xMm || 0}
                      onChange={(e) => updateSelectedElem({ xMm: Number(e.target.value) })}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Y 좌표 (mm)</label>
                    <input
                      type="number"
                      value={selectedElem.yMm || 0}
                      onChange={(e) => updateSelectedElem({ yMm: Number(e.target.value) })}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* 5. 텍스트 전용 속성 */}
                {selectedElem.type === 'text' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignItems: 'center' }}>
                    <div>
                      <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>폰트 크기</label>
                      <input
                        type="number"
                        value={selectedElem.fontSize || 10}
                        onChange={(e) => updateSelectedElem({ fontSize: Number(e.target.value) })}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ paddingTop: '14px' }}>
                      <label style={{ fontSize: '0.72rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!selectedElem.bold}
                          onChange={(e) => updateSelectedElem({ bold: e.target.checked })}
                        /> 볼드체 (굵게)
                      </label>
                    </div>
                  </div>
                )}

                {/* 6. 바코드 전용 속성 */}
                {selectedElem.type === 'barcode_code128' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignItems: 'center' }}>
                    <div>
                      <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>바코드 높이 (mm)</label>
                      <input
                        type="number"
                        value={selectedElem.heightMm || 12}
                        onChange={(e) => updateSelectedElem({ heightMm: Number(e.target.value) })}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ paddingTop: '14px' }}>
                      <label style={{ fontSize: '0.72rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedElem.showText !== false}
                          onChange={(e) => updateSelectedElem({ showText: e.target.checked })}
                        /> 하단 번호 표기
                      </label>
                    </div>
                  </div>
                )}

                {/* 7. QR 코드 전용 속성 */}
                {selectedElem.type === 'qr' && (
                  <div>
                    <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>QR 크기 배율 (2 ~ 10)</label>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={selectedElem.size || 4}
                      onChange={(e) => updateSelectedElem({ size: Number(e.target.value) })}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                    />
                  </div>
                )}

                {/* 8. 박스(Box) 전용 속성 */}
                {selectedElem.type === 'box' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div>
                        <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>가로 너비 (mm)</label>
                        <input
                          type="number"
                          value={selectedElem.widthMm || 40}
                          onChange={(e) => updateSelectedElem({ widthMm: Number(e.target.value) })}
                          style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>세로 높이 (mm)</label>
                        <input
                          type="number"
                          value={selectedElem.heightMm || 20}
                          onChange={(e) => updateSelectedElem({ heightMm: Number(e.target.value) })}
                          style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>테두리 선 두께 (dot/px)</label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={selectedElem.borderThickness || 1}
                        onChange={(e) => updateSelectedElem({ borderThickness: Number(e.target.value) })}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                )}

                {/* 9. 가로선(Line) 전용 속성 */}
                {selectedElem.type === 'line_h' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>선 길이 (mm)</label>
                      <input
                        type="number"
                        value={selectedElem.widthMm || 40}
                        onChange={(e) => updateSelectedElem({ widthMm: Number(e.target.value) })}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.66rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>선 두께 (dot/px)</label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={selectedElem.borderThickness || 1}
                        onChange={(e) => updateSelectedElem({ borderThickness: Number(e.target.value) })}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '4px 6px', color: '#fff', fontSize: '0.72rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '16px 8px', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px dashed #334155' }}>
                캔버스에서 수정할 요소를 클릭하세요.
              </div>
            )}
          </div>

          {/* 섹션 2: 샘플 데이터 실시간 변경 */}
          <div style={{ borderTop: '1px solid #334155', paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Database size={13} /> 모의 데이터 실시간 변경
              </span>
              <span style={{ fontSize: '0.64rem', color: '#94a3b8' }}>
                {MOCK_SCHEMAS[activeSchemaId]?.fields?.length || 0}개 항목
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {(MOCK_SCHEMAS[activeSchemaId]?.fields || []).map(f => (
                <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <label style={{ fontSize: '0.64rem', color: '#94a3b8', fontWeight: 600 }}>{f.name} ({f.id})</label>
                  <input
                    type="text"
                    value={sampleData[f.id] || ''}
                    onChange={(e) => setSampleData(prev => ({ ...prev, [f.id]: e.target.value }))}
                    style={{
                      width: '100%',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      padding: '4px 6px',
                      color: '#cbd5e1',
                      fontSize: '0.70rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
