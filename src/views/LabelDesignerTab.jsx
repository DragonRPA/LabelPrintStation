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
  Lock,
  Unlock,
  Download,
  Upload,
  FileJson
} from 'lucide-react';
import {
  DEFAULT_LABEL_TEMPLATE,
  getStoredLabelTemplate,
  saveStoredLabelTemplate,
  deleteStoredLabelTemplate,
  fetchBackendLabelTemplate,
  saveBackendLabelTemplate,
  syncTemplatesWithBackend,
  generateDynamicZpl,
  generateDynamicZplAsync,
  generateWysiwygZpl,
  convertImageToZplGf,
  mmToDots,
  getAllPresets,
  createEmptyTemplate,
  updatePresetLock
} from '../utils/labelTemplate';
import { generateCode39DataUrl, RealBarcodeSvg } from '../utils/barcode39';
import { getRegisteredPrinters, getActivePrinterId, sendZplToPrinter, fetchActualConnectedPrinters } from '../utils/printerManager';
import AdminGatekeeperModal from '../components/AdminGatekeeperModal';

import {
  DEFAULT_SCHEMA_DEF,
  TEMP_ASSET_SCHEMA_DEF,
  SUPPORTED_TABLES,
  getTableSchema,
  fetchTableSchema,
  fetchActiveSchema,
  getLocalSchemaDef,
  getMainFieldName
} from '../utils/dynamicSchema';

// ⭐️ 순수 스키마 필드 기반 동적 샘플 데이터 매핑 (임의 일시/상태 헤더 생성 금지)

export default function LabelDesignerTab({ onError, onOpenPrintModal }) {
  // ⭐️ 진입 시 자동 로드하지 않고 null 상태로 시작 (사용자가 명시적으로 선택 시에만 로드)
  const [template, setTemplate] = useState(null);
  const [selectedElemId, setSelectedElemId] = useState('elem_asset_no');
  const [isSaved, setIsSaved] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [testCount, setTestCount] = useState(1);
  const [presets, setPresets] = useState(getAllPresets);
  const [showZplCode, setShowZplCode] = useState(false);
  const [gatekeeperState, setGatekeeperState] = useState({ isOpen: false, templateId: null, templateName: '' });

  // ⭐️ 로컬 실제 감지 프린터 목록 state
  const [printers, setPrinters] = useState(() => getRegisteredPrinters());

  // ⭐️ [디자인 추가] 모달 상태
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newDesignName, setNewDesignName] = useState('');
  const [newDesignTable, setNewDesignTable] = useState('asset');
  const [newDesignWidth, setNewDesignWidth] = useState(72);
  const [newDesignHeight, setNewDesignHeight] = useState(40);
  const [newDesignPrinterId, setNewDesignPrinterId] = useState('');

  // ⭐️ [디자인 불러오기] 관리 모달 상태
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  // ⭐️ [ZPL 직접 편집 및 즉시 테스트 인쇄] 상태
  const [customZpl, setCustomZpl] = useState('');
  const [isZplCustomized, setIsZplCustomized] = useState(false);

  // ⭐️ JSON 서식 파일 업로드용 input ref
  const jsonFileInputRef = useRef(null);

  const [draggingId, setDraggingId] = useState(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [elemStartPos, setElemStartPos] = useState({ xMm: 0, yMm: 0 });

  const canvasRef = useRef(null);

  // 캔버스 화면 픽셀 배율 (1mm당 9.0px로 실제 용지 크기 정밀 비례)
  const PX_PER_MM = 9.0;
  const canvasWidthPx = template ? (template.paper?.widthMm || 72) * PX_PER_MM : 72 * PX_PER_MM;
  const canvasHeightPx = template ? (template.paper?.heightMm || 40) * PX_PER_MM : 40 * PX_PER_MM;

  // 현재 서식의 대상 테이블 및 스키마 (DB 실제 스키마 1:1 실시간 동기화)
  const currentTargetTable = template ? (template.targetTable || template.paper?.targetTable || 'asset') : 'asset';
  const [currentTableSchema, setCurrentTableSchema] = useState(() => getTableSchema(currentTargetTable) || DEFAULT_SCHEMA_DEF);

  // ⭐️ 타겟 테이블 변경 시 DB 실제 스키마 실시간 비동기 로드
  useEffect(() => {
    let isMounted = true;
    fetchTableSchema(currentTargetTable).then(s => {
      if (isMounted && s && Array.isArray(s.fields) && s.fields.length > 0) {
        setCurrentTableSchema(s);
      }
    }).catch(err => {
      console.warn('라벨 디자이너 스키마 로드 예외:', err);
    });
    return () => { isMounted = false; };
  }, [currentTargetTable]);

  const tableFields = useMemo(() => currentTableSchema.fields || [], [currentTableSchema]);
  const selectedElem = template ? ((template.elements || []).find(e => e.id === selectedElemId) || null) : null;

  // ⭐️ 초기 로드: 백엔드 전체 라벨 서식 목록 & 로컬 프린터 하드웨어 동기화 (자동 템플릿 로드는 수행하지 않음)
  useEffect(() => {
    fetchActualConnectedPrinters().then(detected => {
      if (detected && detected.length > 0) {
        setPrinters(detected);
      }
    }).catch(() => {});

    syncTemplatesWithBackend().then(syncedPresets => {
      if (syncedPresets && syncedPresets.length > 0) {
        setPresets(syncedPresets);
      }
    });
  }, []);

  // ★ 대상 테이블 스키마에 따라 template.elements의 헤더 항목을 정확히 1:1 동기화 (이전 테이블 잔재 완벽 청소)
  useEffect(() => {
    if (!currentTableSchema || !Array.isArray(currentTableSchema.fields) || currentTableSchema.fields.length === 0 || !template || !Array.isArray(template.elements)) return;

    const schemaFieldMap = new Map();
    currentTableSchema.fields.forEach(f => schemaFieldMap.set(f.id, f));

    // 1. 공통 요소 보존 (바코드, 구분선, 추가 텍스트 1~4, 이미지)
    const nonSchemaElements = template.elements.filter(elem => {
      if (elem.type === 'barcode' || elem.type === 'line' || elem.type === 'image') return true;
      if (elem.field?.startsWith('custom_text_')) return true;
      return false;
    });

    // 2. 현재 스키마의 실제 필드들로만 텍스트 요소 구성 (콤마 구분 첫 번째 주된 명칭 및 접두사 사용)
    const schemaElements = currentTableSchema.fields.map((f, idx) => {
      const mainName = getMainFieldName(f.name);
      // 기존에 동일 필드로 설정된 좌표/크기/폰트/가시성이 있다면 승계
      const existing = template.elements.find(e => e.field === f.id || e.id === `elem_${f.id}`);
      if (existing) {
        return {
          ...existing,
          id: `elem_${f.id}`,
          name: mainName,
          field: f.id,
          prefix: existing.prefix !== undefined ? existing.prefix : (f.isKey ? '' : `${mainName}: `)
        };
      }
      return {
        id: `elem_${f.id}`,
        name: mainName,
        type: 'text',
        field: f.id,
        prefix: f.isKey ? '' : `${mainName}: `,
        xMm: 2.0,
        yMm: Math.min(35, 2.0 + (idx * 4.0)),
        fontSizePt: f.isKey ? 20 : 15,
        fontFamily: 'A0N',
        visible: idx === 0 || f.isKey
      };
    });

    // 3. 바코드 요소의 targetField가 현재 테이블 스키마에 없으면 PK 또는 첫 필드로 자동 보정
    const updatedNonSchema = nonSchemaElements.map(elem => {
      if (elem.type === 'barcode') {
        const isTargetValid = currentTableSchema.fields.some(f => f.id === elem.targetField);
        if (!isTargetValid) {
          const defaultKey = currentTableSchema.fields.find(f => f.isKey || f.isBarcodeTarget)?.id || currentTableSchema.fields[0]?.id || 'asset_no';
          return { ...elem, targetField: defaultKey };
        }
      }
      return elem;
    });

    // 4. 추가 텍스트 1~4 보장
    for (let i = 1; i <= 4; i++) {
      const ctId = `elem_custom_text_${i}`;
      if (!updatedNonSchema.some(e => e.id === ctId)) {
        updatedNonSchema.push({
          id: ctId,
          name: `추가 텍스트 ${i}`,
          type: 'text',
          field: `custom_text_${i}`,
          customValue: '',
          prefix: '',
          xMm: 2.0,
          yMm: 24.0 + (i * 3.5),
          fontSizePt: 14,
          fontFamily: 'A0N',
          visible: false
        });
      }
    }

    // 5. 이미지 / 로고 보장
    if (!updatedNonSchema.some(e => e.id === 'elem_image' || e.type === 'image')) {
      updatedNonSchema.push({
        id: 'elem_image',
        name: '이미지 / 로고',
        type: 'image',
        imageDataUrl: '',
        widthMm: 18.0,
        heightMm: 12.0,
        xMm: 50.0,
        yMm: 2.0,
        visible: false
      });
    }

    const combinedElements = [...schemaElements, ...updatedNonSchema];

    // 요소 목록이 변경되었는지 검사하여 업데이트
    const isDifferent = combinedElements.length !== template.elements.length ||
      combinedElements.some((el, i) => el.id !== template.elements[i]?.id || el.name !== template.elements[i]?.name || el.field !== template.elements[i]?.field);

    if (isDifferent) {
      setTemplate(prev => ({
        ...prev,
        elements: combinedElements
      }));
    }
  }, [currentTableSchema]);

  // 대상 테이블에 맞춘 동적 샘플 데이터 생성 (임의 일시/상태 헤더 생성 금지 - 오직 스키마에 정의된 실제 필드만 1:1 매핑)
  const SAMPLE_ITEM = useMemo(() => {
    const item = {};
    tableFields.forEach(f => {
      if (f.id === 'asset_no') item[f.id] = '224011319';
      else if (f.id === 'imei') item[f.id] = '351379300225052';
      else if (f.id === 'serial_no') item[f.id] = 'RSKL60F0CZW';
      else if (f.id === 'mac_address' || f.id === 'mac_wlan') item[f.id] = '4C:EB:B0:B5:7A:51';
      else if (f.id === 'product_name') item[f.id] = '갤럭시 탭 S9';
      else if (f.id === 'model_name') item[f.id] = 'SM-X910';
      else item[f.id] = getMainFieldName(f.name); // 사용자 정의 필드는 해당 주된 필드명을 예시값으로 표출
    });
    return item;
  }, [tableFields]);

  // 요소의 실시간 동적 표시명 조회
  const getElemDisplayName = (elem) => {
    if (!elem) return '';
    if (elem.type === 'text' && elem.field) {
      const matched = tableFields.find(f => f.id === elem.field);
      if (matched) return getMainFieldName(matched.name);
    }
    return getMainFieldName(elem.name);
  };

  // 바코드 대상 가능 필드 목록
  const barcodeFields = useMemo(() => {
    return tableFields.filter(f => f.isBarcodeTarget !== false).map(f => ({
      ...f,
      name: getMainFieldName(f.name)
    }));
  }, [tableFields]);

  const handlePaperChange = (field, val) => {
    const isBool = typeof val === 'boolean';
    const parsedVal = isBool ? val : (Number(val) || 0);
    setTemplate(prev => ({
      ...prev,
      paper: {
        ...prev.paper,
        [field]: parsedVal,
        dotsWidth: field === 'widthMm' ? mmToDots(parsedVal, prev.paper.dpi) : prev.paper.dotsWidth,
        dotsHeight: field === 'heightMm' ? mmToDots(parsedVal, prev.paper.dpi) : prev.paper.dotsHeight
      }
    }));
    setIsSaved(false);
  };

  const handleToggleVisible = (id) => {
    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(e => e.id === id ? { ...e, visible: !e.visible } : e)
    }));
    setIsSaved(false);
  };

  const handleElemPropChange = (prop, val) => {
    if (!selectedElemId) return;
    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(e => {
        if (e.id === selectedElemId) {
          const numProps = ['xMm', 'yMm', 'fontSizePt', 'heightMm', 'qrScale', 'widthMm', 'thicknessMm'];
          const parsed = numProps.includes(prop) ? (Number(val) || 0) : val;
          return { ...e, [prop]: parsed };
        }
        return e;
      })
    }));
    setIsSaved(false);
  };

  // ⭐️ [폰트 크기 1pt 단위 조작 헬퍼]
  const handleAdjustFontSize = (delta) => {
    if (!selectedElem || selectedElem.type !== 'text') return;
    const current = selectedElem.fontSizePt || 20;
    const next = Math.max(6, Math.min(60, current + delta));
    handleElemPropChange('fontSizePt', next);
  };

  // ⭐️ [이미지 파일 업로드 ➔ Base64 DataURL 및 실시간 ZPL ^GF 그래픽 비트맵 인코딩]
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일(PNG, JPG, SVG 등)만 선택할 수 있습니다.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvt) => {
      const dataUrl = loadEvt.target.result;
      const targetElem = template?.elements?.find(el => el.id === selectedElemId) || {};
      const dpi = template?.paper?.dpi || 203;
      const imgW = mmToDots(targetElem.widthMm || 18, dpi);
      const imgH = mmToDots(targetElem.heightMm || 12, dpi);

      // ZPL II ^GF 비트맵 명령어 즉시 사전 인코딩
      const zplGf = await convertImageToZplGf(dataUrl, imgW, imgH);

      setTemplate(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          elements: prev.elements.map(el => {
            if (el.id === selectedElemId) {
              return { ...el, imageDataUrl: dataUrl, zplGf, visible: true };
            }
            return el;
          })
        };
      });
    };
    reader.readAsDataURL(file);
  };

  // 캔버스 드래그 앤 드롭 이동
  const handleMouseDown = (e, elemId) => {
    e.stopPropagation();
    setSelectedElemId(elemId);
    setDraggingId(elemId);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    const target = template.elements.find(el => el.id === elemId);
    if (target) {
      setElemStartPos({ xMm: target.xMm, yMm: target.yMm });
    }
  };

  const handleMouseMove = (e) => {
    if (!draggingId) return;
    const dxPx = e.clientX - dragStartPos.x;
    const dyPx = e.clientY - dragStartPos.y;
    const dxMm = dxPx / PX_PER_MM;
    const dyMm = dyPx / PX_PER_MM;

    const rawX = elemStartPos.xMm + dxMm;
    const rawY = elemStartPos.yMm + dyMm;
    // 0.5mm 단위 스냅
    const snappedX = Math.round(rawX * 2) / 2;
    const snappedY = Math.round(rawY * 2) / 2;

    const clampedX = Math.max(0, Math.min(template.paper.widthMm - 2, snappedX));
    const clampedY = Math.max(0, Math.min(template.paper.heightMm - 2, snappedY));

    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(el => {
        if (el.id === draggingId) {
          return { ...el, xMm: clampedX, yMm: clampedY };
        }
        return el;
      })
    }));
    setIsSaved(false);
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  const handleReset = () => {
    if (window.confirm('서식 설정을 기본값으로 되돌리시겠습니까?')) {
      const def = createEmptyTemplate('기본 서식', 'asset', 72, 40);
      setTemplate(def);
      setSelectedElemId(def.elements[0]?.id || 'elem_asset_no');
      saveStoredLabelTemplate(def);
      setIsSaved(true);
    }
  };

  // ⭐️ [수정 저장] 현재 서식 저장 (온라인 DB + 로컬 동시 보존)
  const handleSave = async () => {
    if (template?.isLocked) {
      alert('확정 잠금(Lock)된 서식입니다. 수정 사항을 저장하려면 먼저 서식 목록에서 잠금을 해제해 주세요.');
      return;
    }
    saveStoredLabelTemplate(template);
    setPresets(getAllPresets());
    try {
      const res = await saveBackendLabelTemplate(template);
      if (res && res.success === false) {
        alert(`⚠️ 온라인 DB 저장 실패: ${res.message}\n(로컬 브라우저에만 임시 보존되었습니다)`);
      } else {
        // 서버 DB 동기화 최신 목록 갱신
        syncTemplatesWithBackend().then(synced => {
          if (synced && synced.length > 0) setPresets(synced);
        });
      }
    } catch (err) {
      alert(`⚠️ 온라인 DB 저장 오류: ${err.message}`);
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  // ⭐️ [디자인 삭제] 현재 서식 삭제
  const handleDeleteCurrentDesign = async () => {
    if (template?.isLocked) {
      alert('확정 잠금(Lock)된 서식은 삭제할 수 없습니다.');
      return;
    }
    if (presets.length <= 1) {
      alert('최소 1개의 라벨 서식은 유지되어야 합니다.');
      return;
    }
    if (window.confirm(`'${template.name}' 서식을 삭제하시겠습니까?`)) {
      await deleteStoredLabelTemplate(template.templateId);
      const updated = getAllPresets();
      setPresets(updated);
      setTemplate(updated[0] || DEFAULT_LABEL_TEMPLATE);
      setSelectedElemId(updated[0]?.elements[0]?.id || 'elem_asset_no');
    }
  };

  const handleTestPrint = async () => {
    setIsPrinting(true);
    try {
      // 1. ⭐️ 비동기 ZPL 생성 (이미지 ^GF 그래픽 비트맵 100% 실시간 주입 보장)
      const zpl = await generateDynamicZplAsync(SAMPLE_ITEM, template);

      // 2. 서식 지정 프린터 조회 및 직통 전송
      const registered = getRegisteredPrinters();
      const targetId = template.targetPrinterId || getActivePrinterId();
      const targetPrinter = registered.find(p => p.id === targetId) || registered[0] || { type: 'agent_auto', name: '기본 라벨 프린터' };

      // 3. 지정 횟수만큼 인쇄
      for (let i = 0; i < testCount; i++) {
        await sendZplToPrinter(zpl, targetPrinter);
      }
      alert(`[테스트 인쇄 완료 (${testCount}회) - ${targetPrinter.name}]`);
    } catch (err) {
      if (onOpenPrintModal) {
        onOpenPrintModal([SAMPLE_ITEM]);
      } else {
        alert(`인쇄 오류: ${err.message}`);
      }
    } finally {
      setIsPrinting(false);
    }
  };

  // ⭐️ 이미지 요소의 크기(widthMm, heightMm) 또는 imageDataUrl 변경 시 zplGf 자동 동기화
  useEffect(() => {
    if (!template || !Array.isArray(template.elements)) return;
    const dpi = template.paper?.dpi || 203;

    template.elements.forEach(async (el) => {
      if (el.type === 'image' && el.imageDataUrl && (!el.zplGf || el._lastW !== el.widthMm || el._lastH !== el.heightMm)) {
        const imgW = mmToDots(el.widthMm || 18, dpi);
        const imgH = mmToDots(el.heightMm || 12, dpi);
        const zplGf = await convertImageToZplGf(el.imageDataUrl, imgW, imgH);
        if (zplGf && zplGf !== el.zplGf) {
          setTemplate(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              elements: prev.elements.map(item => item.id === el.id ? { ...item, zplGf, _lastW: el.widthMm, _lastH: el.heightMm } : item)
            };
          });
        }
      }
    });
  }, [template?.elements, template?.paper]);

  const currentZpl = useMemo(() => (template ? generateDynamicZpl(SAMPLE_ITEM, template) : ''), [template, SAMPLE_ITEM]);

  useEffect(() => {
    if (!isZplCustomized) {
      setCustomZpl(currentZpl);
    }
  }, [currentZpl, isZplCustomized]);

  // ⭐️ [수정된 ZPL로 직접 즉시 테스트 인쇄]
  const handleManualCustomZplPrint = async () => {
    if (!template) return;
    setIsPrinting(true);
    try {
      const zplToSend = customZpl || currentZpl;
      const registered = getRegisteredPrinters();
      const targetId = template?.targetPrinterId || getActivePrinterId();
      const targetPrinter = registered.find(p => p.id === targetId) || registered[0] || { type: 'agent_auto', name: '기본 라벨 프린터' };

      const res = await sendZplToPrinter(zplToSend, targetPrinter);
      alert(`[수정된 ZPL 인쇄 완료 - ${targetPrinter.name}] ${res?.message || '라벨이 출력되었습니다.'}`);
    } catch (err) {
      alert(`ZPL 직접 인쇄 오류: ${err.message}`);
    } finally {
      setIsPrinting(false);
    }
  };

  // ⭐️ [ZPL 자동생성 코드로 복원]
  const handleResetZplToDefault = () => {
    setCustomZpl(currentZpl);
    setIsZplCustomized(false);
  };

  // ⭐️ [디자인 추가] 모달 열기
  const handleOpenCreateModal = () => {
    setNewDesignName(`새 서식 ${presets.length + 1}`);
    setNewDesignTable('asset');
    setNewDesignWidth(72);
    setNewDesignHeight(40);
    setIsCreateModalOpen(true);
  };

  // ⭐️ [디자인 추가] 확인 및 템플릿 생성
  const handleCreateNewDesign = async () => {
    if (!newDesignName.trim()) {
      alert('서식 명칭을 입력하세요.');
      return;
    }
    const foundPrn = printers.find(p => p.id === newDesignPrinterId);
    
    // 대상 테이블 최신 스키마 실시간 조회
    let targetSchema = await fetchTableSchema(newDesignTable);
    if (!targetSchema || !Array.isArray(targetSchema.fields)) {
      targetSchema = getTableSchema(newDesignTable);
    }

    const newPreset = createEmptyTemplate(
      newDesignName.trim(),
      newDesignTable,
      Number(newDesignWidth) || 72,
      Number(newDesignHeight) || 40,
      newDesignPrinterId || '',
      foundPrn?.name || '',
      targetSchema?.fields || []
    );
    saveStoredLabelTemplate(newPreset);
    const updated = getAllPresets();
    setPresets(updated);
    setTemplate(newPreset);
    setSelectedElemId(newPreset.elements[0]?.id || 'elem_asset_no');
    setIsCreateModalOpen(false);
  };

  // ⭐️ [디자인 불러오기] 서식 선택
  const handleLoadDesign = (presetId) => {
    const found = presets.find(p => p.templateId === presetId);
    if (found) {
      if (found.isLocked) {
        alert('확정 잠금(Lock)된 서식입니다. 수정 또는 불러오기를 진행하려면 먼저 잠금을 해제해 주세요.');
        return;
      }
      const prnId = found.targetPrinterId || found.paper?.targetPrinterId || '';
      const prnName = found.targetPrinterName || found.paper?.targetPrinterName || '';
      const normalized = {
        ...found,
        targetPrinterId: prnId,
        targetPrinterName: prnName,
        paper: {
          ...(found.paper || {}),
          targetPrinterId: prnId,
          targetPrinterName: prnName
        }
      };
      setTemplate(normalized);
      saveStoredLabelTemplate(normalized);
      setSelectedElemId(normalized.elements[0]?.id || 'elem_asset_no');
      setIsLoadModalOpen(false);
    }
  };

  // ⭐️ [디자인 불러오기 모달 내 삭제]
  const handleDeleteDesignInModal = async (presetId, name, e) => {
    e.stopPropagation();
    const target = presets.find(p => p.templateId === presetId);
    if (target?.isLocked) {
      alert('확정 잠금(Lock)된 서식은 삭제할 수 없습니다.');
      return;
    }
    if (presets.length <= 1) {
      alert('최소 1개의 라벨 서식은 유지되어야 합니다.');
      return;
    }
    if (window.confirm(`'${name}' 서식을 영구 삭제하시겠습니까?`)) {
      await deleteStoredLabelTemplate(presetId);
      const updated = getAllPresets();
      setPresets(updated);
      if (template?.templateId === presetId) {
        setTemplate(null);
        setSelectedElemId('elem_asset_no');
      }
    }
  };

  // ⭐️ [디자인 잠금(Lock) / 해제(Unlock) 토글]
  const handleToggleLock = async (presetId, e) => {
    if (e) e.stopPropagation();
    const targetPreset = presets.find(p => p.templateId === presetId);
    if (!targetPreset) return;

    // 🔒 잠금 해제(Unlock) 시에는 관리자 비밀번호 인증 필수
    if (targetPreset.isLocked) {
      setGatekeeperState({
        isOpen: true,
        templateId: presetId,
        templateName: targetPreset.name
      });
      return;
    }

    // 🔓 잠금(Lock) 설정 시에는 원클릭으로 즉시 확정 잠금
    const res = await updatePresetLock(presetId, true);
    if (res.success) {
      setPresets(prev => prev.map(p => p.templateId === presetId ? { ...p, isLocked: true, paper: { ...(p.paper || {}), isLocked: true } } : p));
      if (template && template.templateId === presetId) {
        setTemplate(prev => ({ ...prev, isLocked: true, paper: { ...(prev.paper || {}), isLocked: true } }));
      }
    }
  };

  // ⭐️ 관리자 비밀번호 인증 통과 시 잠금 해제 실행
  const handleUnlockAfterAuth = async () => {
    const { templateId } = gatekeeperState;
    if (!templateId) return;

    const res = await updatePresetLock(templateId, false);
    if (res.success) {
      setPresets(prev => prev.map(p => p.templateId === templateId ? { ...p, isLocked: false, paper: { ...(p.paper || {}), isLocked: false } } : p));
      if (template && template.templateId === templateId) {
        setTemplate(prev => ({ ...prev, isLocked: false, paper: { ...(prev.paper || {}), isLocked: false } }));
      }
    }
    setGatekeeperState({ isOpen: false, templateId: null, templateName: '' });
  };

  // ⭐️ [서식 JSON 로컬 파일로 내보내기]
  const handleExportJson = (targetTpl = template) => {
    if (!targetTpl) return;
    try {
      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        template: {
          name: targetTpl.name,
          targetTable: targetTpl.targetTable || 'asset',
          schemaId: targetTpl.schemaId || 'main_schema',
          paper: targetTpl.paper || { widthMm: 72, heightMm: 40, dpi: 203, dotsWidth: 576, dotsHeight: 320 },
          elements: Array.isArray(targetTpl.elements) ? targetTpl.elements : [],
          targetPrinterId: targetTpl.targetPrinterId || '',
          targetPrinterName: targetTpl.targetPrinterName || ''
        }
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (targetTpl.name || '라벨서식').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
      link.href = url;
      link.download = `라벨서식_${safeName}_${targetTpl.paper?.widthMm || 72}x${targetTpl.paper?.heightMm || 40}mm.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`JSON 내보내기 실패: ${err.message}`);
    }
  };

  // ⭐️ [로컬 JSON 서식 파일 불러오기 / 추가]
  const handleImportJsonFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const rawTpl = parsed.template || parsed;

        if (!rawTpl || !rawTpl.name || !Array.isArray(rawTpl.elements)) {
          throw new Error('유효한 라벨 디자인 서식 JSON 형식이 아닙니다 (name, elements 필드 필수)');
        }

        const newId = `tpl_import_${Date.now()}`;
        const importedName = rawTpl.name;
        const widthMm = Number(rawTpl.paper?.widthMm) || 72;
        const heightMm = Number(rawTpl.paper?.heightMm) || 40;
        const dotsWidth = Math.round(widthMm * (203 / 25.4));
        const dotsHeight = Math.round(heightMm * (203 / 25.4));

        const importedTemplate = {
          templateId: newId,
          name: importedName,
          targetTable: rawTpl.targetTable || 'asset',
          schemaId: rawTpl.schemaId || 'main_schema',
          targetPrinterId: rawTpl.targetPrinterId || '',
          targetPrinterName: rawTpl.targetPrinterName || '',
          isDefault: false,
          isLocked: false,
          paper: {
            widthMm,
            heightMm,
            dpi: 203,
            dotsWidth,
            dotsHeight,
            targetTable: rawTpl.targetTable || 'asset',
            targetPrinterId: rawTpl.targetPrinterId || '',
            targetPrinterName: rawTpl.targetPrinterName || '',
            isLocked: false
          },
          elements: rawTpl.elements
        };

        saveStoredLabelTemplate(importedTemplate);
        await saveBackendLabelTemplate(importedTemplate);
        
        const updated = getAllPresets();
        setPresets(updated);
        setTemplate(importedTemplate);
        setSelectedElemId(importedTemplate.elements[0]?.id || 'elem_asset_no');
        setIsCreateModalOpen(false);
        setIsLoadModalOpen(false);

        alert(`✅ '${importedName}' 라벨 서식이 성공적으로 불러와졌습니다!`);
      } catch (err) {
        alert(`❌ JSON 서식 파일 불러오기 실패: ${err.message}`);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };



  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      color: '#f8fafc',
      width: '100%'
    }}>
      {/* ── Top Action Bar ────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '6px 12px',
        flexWrap: 'wrap',
        gap: '6px'
      }}>
        {/* Left: Title & Actions & Active Template Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Sliders size={16} style={{ color: '#38bdf8' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>라벨 서식 디자인</span>

          {/* ⭐️ 서식 즉시 전환 셀렉트 박스 */}
          <select
            value={template?.templateId || ''}
            onChange={e => {
              if (e.target.value) handleLoadDesign(e.target.value);
              else setTemplate(null);
            }}
            style={{
              backgroundColor: '#0f172a',
              border: '1px solid #0284c7',
              borderRadius: '4px',
              padding: '4px 8px',
              color: '#38bdf8',
              fontSize: '0.75rem',
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">-- 서식 선택 (목록에서 선택 또는 추가) --</option>
            {presets.map(p => (
              <option key={p.templateId} value={p.templateId}>
                {p.isLocked ? '🔒 [확정] ' : ''}{p.name} ({p.paper?.widthMm}×{p.paper?.heightMm}mm) {p.targetPrinterName ? `➔ [${p.targetPrinterName}]` : ''}
              </option>
            ))}
          </select>

          {/* [디자인 추가] 버튼 */}
          <button
            onClick={handleOpenCreateModal}
            className="btn btn-primary"
            style={{
              fontSize: '0.68rem',
              padding: '3px 9px',
              backgroundColor: '#0284c7',
              borderColor: '#38bdf8',
              color: '#ffffff',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}
            title="새로운 라벨 서식 추가"
          >
            <Plus size={12} /> 디자인 추가
          </button>

          {/* [디자인 불러오기] 버튼 */}
          <button
            onClick={() => setIsLoadModalOpen(true)}
            className="btn btn-outline"
            style={{
              fontSize: '0.68rem',
              padding: '3px 9px',
              borderColor: '#38bdf8',
              color: '#7dd3fc',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="저장된 라벨 서식 목록 불러오기"
          >
            <FolderOpen size={12} /> 디자인 목록
          </button>

          {/* 대상 테이블 뱃지 */}
          {template && (
            <span style={{
              fontSize: '0.68rem',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: currentTargetTable === 'temp_asset' ? '#3b0764' : '#1e3a8a',
              color: currentTargetTable === 'temp_asset' ? '#d8b4fe' : '#93c5fd',
              border: `1px solid ${currentTargetTable === 'temp_asset' ? '#a855f7' : '#3b82f6'}`,
              fontWeight: 600
            }}>
              {currentTargetTable === 'temp_asset' ? 'temp_asset (임시자산)' : 'asset (자산관리)'}
            </span>
          )}
        </div>

        {/* Right: Save & Delete & Test Print Actions */}
        {template && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* 서식 잠금/해제 토글 버튼 */}
            <button
              onClick={() => handleToggleLock(template.templateId)}
              className="btn btn-outline"
              style={{
                fontSize: '0.72rem',
                padding: '4px 8px',
                borderColor: template.isLocked ? '#f59e0b' : '#475569',
                color: template.isLocked ? '#fbbf24' : '#94a3b8',
                backgroundColor: template.isLocked ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                fontWeight: template.isLocked ? 700 : 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px'
              }}
              title={template.isLocked ? "확정 서식 잠금 해제" : "서식 잠금 (수정/삭제/불러오기 방지)"}
            >
              {template.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
              <span>{template.isLocked ? '확정 잠김' : '서식 잠금'}</span>
            </button>

            {/* ⭐️ JSON 서식 파일 내보내기 (다운로드) */}
            <button
              onClick={() => handleExportJson(template)}
              className="btn btn-outline"
              style={{
                fontSize: '0.72rem',
                padding: '4px 8px',
                borderColor: '#38bdf8',
                color: '#38bdf8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="현재 라벨 서식을 JSON 파일로 로컬에 내보내기 (다운로드)"
            >
              <Download size={12} /> JSON 내보내기
            </button>

            <button
              onClick={handleReset}
              disabled={template.isLocked}
              className="btn btn-outline"
              style={{ fontSize: '0.72rem', padding: '4px 8px', opacity: template.isLocked ? 0.5 : 1 }}
              title="서식 초기화"
            >
              <RotateCcw size={12} /> 초기화
            </button>

            {!template.isLocked && (
              <button
                onClick={handleDeleteCurrentDesign}
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '4px 8px', borderColor: '#ef4444', color: '#fca5a5' }}
                title="현재 서식 삭제"
              >
                <Trash2 size={12} /> 디자인 삭제
              </button>
            )}

            {!template.isLocked ? (
              <button
                onClick={handleSave}
                className={`btn ${isSaved ? 'btn-success' : 'btn-primary'}`}
                style={{ fontSize: '0.72rem', padding: '4px 12px' }}
                title="현재 서식 수정 저장"
              >
                <Save size={12} /> {isSaved ? '저장됨' : '수정 저장'}
              </button>
            ) : (
              <div style={{
                fontSize: '0.70rem',
                color: '#fbbf24',
                backgroundColor: 'rgba(180, 83, 9, 0.2)',
                border: '1px solid #b45309',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <Lock size={12} /> 수정 보호됨
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <input
                type="number"
                min={1}
                value={testCount}
                onChange={e => setTestCount(Math.max(1, Number(e.target.value) || 1))}
                className="input"
                style={{ width: '60px', fontSize: '0.72rem', padding: '2px 4px' }}
                placeholder="매수"
              />
              <button
                onClick={handleTestPrint}
                disabled={isPrinting}
                className="btn"
                style={{
                  backgroundColor: '#10b981',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.72rem',
                  padding: '4px 12px'
                }}
              >
                <Printer size={12} /> {isPrinting ? '전송중' : '테스트 인쇄'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 본문 영역: 서식 미선택 시 대기 안내 / 서식 선택 시 2-Column 워크스페이스 ── */}
      {!template ? (
        <div style={{
          width: '100%',
          minHeight: '520px',
          backgroundColor: '#0f172a',
          border: '1px dashed #334155',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          boxSizing: 'border-box',
          gap: '16px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid #38bdf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8'
          }}>
            <Sliders size={32} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '480px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              선택된 라벨 디자인 서식이 없습니다
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
              상단의 <strong style={{ color: '#38bdf8' }}>서식 선택 드롭다운</strong> 또는 <strong style={{ color: '#7dd3fc' }}>[디자인 목록]</strong>에서 편집할 서식을 로드하거나, <strong style={{ color: '#0284c7' }}>[+ 디자인 추가]</strong>로 새 서식을 시작하세요.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
            <button
              onClick={handleOpenCreateModal}
              className="btn btn-primary"
              style={{
                fontSize: '0.78rem',
                padding: '8px 18px',
                backgroundColor: '#0284c7',
                borderColor: '#38bdf8',
                color: '#ffffff',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Plus size={14} /> 새 디자인 추가
            </button>

            <button
              onClick={() => setIsLoadModalOpen(true)}
              className="btn btn-outline"
              style={{
                fontSize: '0.78rem',
                padding: '8px 18px',
                borderColor: '#38bdf8',
                color: '#7dd3fc',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FolderOpen size={14} /> 디자인 목록 열기
            </button>
          </div>
        </div>
      ) : (
        /* ── 2-Column Wide Workspace (좌측: 340px 설정 패널 | 우측: 1fr 라벨 캔버스) ── */
        <div style={{
          display: 'grid',
          gridTemplateColumns: '340px minmax(500px, 1fr)',
          gap: '8px',
          alignItems: 'stretch',
          width: '100%',
          minHeight: '620px'
        }}>
        {/* ── [1/2] Left Panel: 설정 및 속성 편집기 ───────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', minWidth: 0 }}>
          {/* 0. 디자인 명칭 & 대상 테이블 */}
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #38bdf8',
            borderRadius: '8px',
            padding: '10px',
            boxSizing: 'border-box',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}>
                디자인 명칭
              </label>
              <input
                type="text"
                value={template.name || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setTemplate(prev => ({ ...prev, name: val }));
                  setIsSaved(false);
                }}
                placeholder="서식 명칭을 입력하세요"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '5px 8px',
                  color: '#f8fafc',
                  fontSize: '0.78rem',
                  fontWeight: 600
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}>
                  대상 테이블 선택
                </label>
                <span style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>
                  {currentTargetTable === 'temp_asset' ? '임시 데이터 스키마' : '정규 자산 스키마'}
                </span>
              </div>
              <select
                value={currentTargetTable}
                onChange={e => {
                  const val = e.target.value;
                  setTemplate(prev => ({
                    ...prev,
                    targetTable: val,
                    paper: {
                      ...(prev.paper || {}),
                      targetTable: val
                    }
                  }));
                  setIsSaved(false);
                }}
                style={{
                  width: '100%',
                  backgroundColor: '#0f172a',
                  border: '1px solid #38bdf8',
                  borderRadius: '4px',
                  padding: '5px 8px',
                  color: '#38bdf8',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}
              >
                <option value="asset">asset (자산 관리 - 정규 헤더)</option>
                <option value="temp_asset">temp_asset (임시 데이터 - 스캔/검수 헤더)</option>
              </select>
            </div>
          </div>

          {/* 0-1. ⭐️ 출력 대상 프린터 지정 (서식-프린터 1:1 고정) */}
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px',
            boxSizing: 'border-box',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}>
                출력 대상 프린터 지정
              </label>
              <span style={{ fontSize: '0.62rem', color: '#10b981', fontWeight: 700 }}>
                ● 실시간 출력 시 자동 고정
              </span>
            </div>
            <select
              value={template.targetPrinterId || template.paper?.targetPrinterId || ''}
              onChange={e => {
                const pId = e.target.value;
                const found = printers.find(p => p.id === pId);
                const pName = found?.name || '';
                setTemplate(prev => ({
                  ...prev,
                  targetPrinterId: pId,
                  targetPrinterName: pName,
                  paper: {
                    ...(prev.paper || {}),
                    targetPrinterId: pId,
                    targetPrinterName: pName
                  }
                }));
                setIsSaved(false);
              }}
              style={{
                width: '100%',
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '5px 8px',
                color: '#f8fafc',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              <option value="">-- 기본 라벨 프린터 (자동) --</option>
              {printers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.isHardwareDetected ? `🟢 ${p.name}` : p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 1. 용지 규격 */}
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px',
            boxSizing: 'border-box',
            width: '100%'
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', marginBottom: '6px' }}>
              용지 규격
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <label style={{ fontSize: '0.68rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>폭 (mm)</label>
                <input
                  type="number"
                  value={template.paper.widthMm}
                  onChange={e => handlePaperChange('widthMm', e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '4px 6px',
                    color: '#f8fafc',
                    fontSize: '0.75rem'
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <label style={{ fontSize: '0.68rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>높이 (mm)</label>
                <input
                  type="number"
                  value={template.paper.heightMm}
                  onChange={e => handlePaperChange('heightMm', e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '4px 6px',
                    color: '#f8fafc',
                    fontSize: '0.75rem'
                  }}
                />
              </div>
            </div>

            {/* ⭐️ ^LH / ^PW 기능 ON/OFF 토글 (좌측 용지 패널) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #334155' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: template.paper?.useLabelHome ? '#38bdf8' : '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={!!template.paper?.useLabelHome}
                  onChange={e => handlePaperChange('useLabelHome', e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600 }}>^LH (원점)</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: template.paper?.usePrintWidth ? '#38bdf8' : '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={!!template.paper?.usePrintWidth}
                  onChange={e => handlePaperChange('usePrintWidth', e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600 }}>^PW (인쇄폭)</span>
              </label>
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* 📋 1. 디자인 항목 통합 리스트 (테이블 헤더 + 텍스트 1~4 + 이미지 + 바코드) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>📋</span> 디자인 항목 목록 ({template.elements.filter(e => e.visible).length}개 출력중)
              </div>
              <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                체크 시 캔버스에 추가
              </span>
            </div>

            {/* 전체 항목 통합 리스트 (헤더 + 바코드 + 텍스트 1~4 + 이미지 + 구분선) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }} className="grid-scrollbar">
              {template.elements.map(elem => {
                const isSelected = elem.id === selectedElemId;
                let badge = elem.type;
                if (elem.type === 'barcode') badge = '바코드';
                else if (elem.type === 'image') badge = '이미지';
                else if (elem.type === 'line') badge = '구분선';
                else if (elem.field?.startsWith('custom_text_')) badge = '추가텍스트';
                else badge = '헤더';

                return (
                  <div
                    key={elem.id}
                    onClick={() => setSelectedElemId(elem.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      backgroundColor: isSelected ? '#334155' : '#0f172a',
                      border: `1px solid ${isSelected ? '#38bdf8' : '#1e293b'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleVisible(elem.id);
                        }}
                        style={{ color: elem.visible ? '#38bdf8' : '#64748b', cursor: 'pointer', display: 'flex' }}
                      >
                        {elem.visible ? <CheckSquare size={14} /> : <Square size={14} />}
                      </span>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: elem.visible ? '#f8fafc' : '#64748b'
                      }}>
                        {getElemDisplayName(elem)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {elem.prefix && (
                        <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                          [{elem.prefix}]
                        </span>
                      )}
                      <span style={{
                        fontSize: '0.60rem',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        backgroundColor: elem.visible ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                        color: elem.visible ? '#38bdf8' : '#64748b',
                        fontWeight: 600
                      }}>
                        {badge}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* ⚙️ 2. 선택된 항목 전용 속성 편집기 */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {selectedElem && (
            <div style={{
              backgroundColor: '#1e293b',
              border: '1px solid #38bdf8',
              borderRadius: '8px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '6px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8' }}>
                  [{getElemDisplayName(selectedElem)}] 속성 편집
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: selectedElem.visible ? '#10b981' : '#ef4444'
                }}>
                  {selectedElem.visible ? '● 캔버스 출력중' : '○ 미출력 (위에서 체크 필요)'}
                </span>
              </div>

              {/* 1. 테이블 헤더 텍스트 항목인 경우 */}
              {selectedElem.type === 'text' && !selectedElem.field?.startsWith('custom_text_') && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>접두사 텍스트 (Prefix)</label>
                    <input
                      type="text"
                      value={selectedElem.prefix || ''}
                      onChange={e => handleElemPropChange('prefix', e.target.value)}
                      placeholder="예: 제품명: , M/N: , S/N: "
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>X 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.xMm}
                        onChange={e => handleElemPropChange('xMm', e.target.value)}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid #475569',
                          borderRadius: '4px',
                          padding: '3px 6px',
                          color: '#f8fafc',
                          fontSize: '0.72rem'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Y 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.yMm}
                        onChange={e => handleElemPropChange('yMm', e.target.value)}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid #475569',
                          borderRadius: '4px',
                          padding: '3px 6px',
                          color: '#f8fafc',
                          fontSize: '0.72rem'
                        }}
                      />
                    </div>
                  </div>

                  {/* ⭐️ X / Y 인쇄 미세 보정 (mm) - 음수 및 양수 자유 조절 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', backgroundColor: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px dashed #334155' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>X 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetX > 0 ? `+${selectedElem.offsetX}` : (selectedElem.offsetX || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetX || 0}
                          onChange={e => handleElemPropChange('offsetX', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>Y 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetY > 0 ? `+${selectedElem.offsetY}` : (selectedElem.offsetY || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetY || 0}
                          onChange={e => handleElemPropChange('offsetY', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>폰트 크기 (1 pt 단위)</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={() => handleAdjustFontSize(-1)}
                          style={{
                            background: '#0f172a',
                            border: '1px solid #475569',
                            color: '#cbd5e1',
                            borderRadius: '3px',
                            padding: '1px 4px',
                            cursor: 'pointer',
                            display: 'flex'
                          }}
                        >
                          <Minus size={10} />
                        </button>
                        <input
                          type="number"
                          min="6"
                          max="60"
                          step="1"
                          value={selectedElem.fontSizePt || 16}
                          onChange={e => handleElemPropChange('fontSizePt', e.target.value)}
                          style={{
                            width: '40px',
                            backgroundColor: '#0f172a',
                            border: '1px solid #38bdf8',
                            borderRadius: '3px',
                            color: '#facc15',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            textAlign: 'center',
                            padding: '1px 2px'
                          }}
                        />
                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Pt</span>
                        <button
                          onClick={() => handleAdjustFontSize(1)}
                          style={{
                            background: '#0f172a',
                            border: '1px solid #475569',
                            color: '#cbd5e1',
                            borderRadius: '3px',
                            padding: '1px 4px',
                            cursor: 'pointer',
                            display: 'flex'
                          }}
                        >
                          <Plus size={10} />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="6"
                      max="60"
                      step="1"
                      value={selectedElem.fontSizePt || 16}
                      onChange={e => handleElemPropChange('fontSizePt', e.target.value)}
                      style={{ accentColor: '#38bdf8', width: '100%' }}
                    />
                  </div>
                </>
              )}

              {/* 2. 추가 텍스트 1~4 항목인 경우 */}
              {selectedElem.type === 'text' && selectedElem.field?.startsWith('custom_text_') && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>문구 내용 (임의 텍스트)</label>
                    <input
                      type="text"
                      value={selectedElem.customValue || ''}
                      onChange={e => handleElemPropChange('customValue', e.target.value)}
                      placeholder="출력할 고정 문구를 입력하세요 (예: (주)드래곤렌탈)"
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #38bdf8',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>접두사 텍스트 (Prefix)</label>
                    <input
                      type="text"
                      value={selectedElem.prefix || ''}
                      onChange={e => handleElemPropChange('prefix', e.target.value)}
                      placeholder="예: 회사명: , 검수: "
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>X 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.xMm}
                        onChange={e => handleElemPropChange('xMm', e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Y 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.yMm}
                        onChange={e => handleElemPropChange('yMm', e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  {/* ⭐️ X / Y 인쇄 미세 보정 (mm) - 음수 및 양수 자유 조절 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', backgroundColor: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px dashed #334155' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>X 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetX > 0 ? `+${selectedElem.offsetX}` : (selectedElem.offsetX || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetX || 0}
                          onChange={e => handleElemPropChange('offsetX', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>Y 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetY > 0 ? `+${selectedElem.offsetY}` : (selectedElem.offsetY || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetY || 0}
                          onChange={e => handleElemPropChange('offsetY', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>폰트 크기</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={() => handleAdjustFontSize(-1)}
                          style={{ background: '#0f172a', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '1px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={10} />
                        </button>
                        <input
                          type="number"
                          min="10"
                          max="80"
                          step="1"
                          value={selectedElem.fontSizePt || 25}
                          onChange={e => handleElemPropChange('fontSizePt', e.target.value)}
                          style={{ width: '40px', backgroundColor: '#0f172a', border: '1px solid #38bdf8', borderRadius: '3px', color: '#facc15', fontSize: '0.72rem', fontWeight: 700, textAlign: 'center', padding: '1px 2px' }}
                        />
                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>pt</span>
                        <button
                          onClick={() => handleAdjustFontSize(1)}
                          style={{ background: '#0f172a', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '1px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={10} />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="80"
                      step="1"
                      value={selectedElem.fontSizePt || 25}
                      onChange={e => handleElemPropChange('fontSizePt', e.target.value)}
                      style={{ accentColor: '#38bdf8', width: '100%' }}
                    />
                  </div>
                </>
              )}

              {/* 3. 바코드 / QR 항목인 경우 */}
              {selectedElem.type === 'barcode' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>바코드 대상 헤더 필드</label>
                    <select
                      value={selectedElem.targetField || 'asset_no'}
                      onChange={e => handleElemPropChange('targetField', e.target.value)}
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    >
                      {barcodeFields.map(f => (
                        <option key={f.id} value={f.id}>{f.name} ({f.id})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>바코드 형식</label>
                    <select
                      value={selectedElem.barcodeType || 'CODE128'}
                      onChange={e => handleElemPropChange('barcodeType', e.target.value)}
                      style={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    >
                      <option value="CODE128">1D Barcode (CODE128)</option>
                      <option value="CODE39">1D Barcode (CODE39)</option>
                      <option value="QR">2D QR Code</option>
                    </select>
                  </div>

                  {/* ⭐️ QR 코드 전용 크기(배율) 설정 */}
                  {selectedElem.barcodeType === 'QR' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.68rem', color: '#cbd5e1', fontWeight: 600 }}>
                          QR 코드 크기 (배율: 1~10)
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            onClick={() => {
                              const cur = Number(selectedElem.qrScale) || 3;
                              if (cur > 1) handleElemPropChange('qrScale', cur - 1);
                            }}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #475569',
                              color: '#cbd5e1',
                              borderRadius: '3px',
                              padding: '1px 5px',
                              cursor: 'pointer',
                              display: 'flex'
                            }}
                          >
                            <Minus size={10} />
                          </button>
                          <span style={{ fontSize: '0.78rem', color: '#facc15', fontWeight: 700, minWidth: '32px', textAlign: 'center' }}>
                            배율 {selectedElem.qrScale || 3}
                          </span>
                          <button
                            onClick={() => {
                              const cur = Number(selectedElem.qrScale) || 3;
                              if (cur < 10) handleElemPropChange('qrScale', cur + 1);
                            }}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #475569',
                              color: '#cbd5e1',
                              borderRadius: '3px',
                              padding: '1px 5px',
                              cursor: 'pointer',
                              display: 'flex'
                            }}
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={selectedElem.qrScale || 3}
                        onChange={e => handleElemPropChange('qrScale', Number(e.target.value))}
                        style={{ accentColor: '#38bdf8', width: '100%' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#94a3b8' }}>
                        <span>소형 (1~2: 6~8mm)</span>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                          실물 크기: 약 {Math.round(((selectedElem.qrScale || 3) * 25 / 8.0) * 10) / 10}mm
                        </span>
                        <span>대형 (5~10)</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0' }}>
                        <input
                          type="checkbox"
                          id="unified_bc_show_text"
                          checked={selectedElem.showText !== false}
                          onChange={e => handleElemPropChange('showText', e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="unified_bc_show_text" style={{ fontSize: '0.68rem', color: '#cbd5e1', cursor: 'pointer' }}>
                          하단 텍스트 표시
                        </label>
                      </div>

                      {selectedElem.showText !== false && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>하단 텍스트 접두사</label>
                          <input
                            type="text"
                            value={selectedElem.prefix || ''}
                            onChange={e => handleElemPropChange('prefix', e.target.value)}
                            placeholder="예: S/N: , IMEI: "
                            style={{
                              backgroundColor: '#0f172a',
                              border: '1px solid #475569',
                              borderRadius: '4px',
                              padding: '3px 6px',
                              color: '#f8fafc',
                              fontSize: '0.72rem'
                            }}
                          />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>바코드 높이 (mm)</label>
                          <span style={{ fontSize: '0.72rem', color: '#facc15', fontWeight: 700 }}>
                            {selectedElem.heightMm || 10} mm
                          </span>
                        </div>
                        <input
                          type="range"
                          min="4"
                          max="35"
                          step="0.5"
                          value={selectedElem.heightMm || 10}
                          onChange={e => handleElemPropChange('heightMm', e.target.value)}
                          style={{ accentColor: '#38bdf8', width: '100%' }}
                        />
                      </div>
                    </>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>X 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.xMm}
                        onChange={e => handleElemPropChange('xMm', e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Y 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.yMm}
                        onChange={e => handleElemPropChange('yMm', e.target.value)}
                        style={{ backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  {/* ⭐️ X / Y 인쇄 미세 보정 (mm) - QR 및 바코드 위치 오차 정밀 극복 (음수 및 양수 자유 조절) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', backgroundColor: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px dashed #38bdf8', marginTop: '2px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 700 }}>X 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetX > 0 ? `+${selectedElem.offsetX}` : (selectedElem.offsetX || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetX || 0}
                          onChange={e => handleElemPropChange('offsetX', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #38bdf8',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 700 }}>Y 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetY > 0 ? `+${selectedElem.offsetY}` : (selectedElem.offsetY || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetY || 0}
                          onChange={e => handleElemPropChange('offsetY', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #38bdf8',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* 4. 이미지 / 로고 항목인 경우 */}
              {selectedElem.type === 'image' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>이미지 파일 선택</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      style={{
                        fontSize: '0.68rem',
                        color: '#94a3b8',
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px'
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>너비 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="2"
                        max="100"
                        value={selectedElem.widthMm || 18}
                        onChange={e => handleElemPropChange('widthMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>높이 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="2"
                        max="100"
                        value={selectedElem.heightMm || 12}
                        onChange={e => handleElemPropChange('heightMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>X 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.xMm}
                        onChange={e => handleElemPropChange('xMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>Y 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.yMm}
                        onChange={e => handleElemPropChange('yMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  {/* ⭐️ X / Y 인쇄 미세 보정 (mm) - 음수 및 양수 자유 조절 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', backgroundColor: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px dashed #334155' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>X 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetX > 0 ? `+${selectedElem.offsetX}` : (selectedElem.offsetX || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetX || 0}
                          onChange={e => handleElemPropChange('offsetX', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>Y 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetY > 0 ? `+${selectedElem.offsetY}` : (selectedElem.offsetY || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetY || 0}
                          onChange={e => handleElemPropChange('offsetY', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedElem.imageDataUrl && (
                    <div style={{ marginTop: '4px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>이미지 미리보기 (비율 무시)</div>
                      <img
                        src={selectedElem.imageDataUrl}
                        alt="preview"
                        style={{
                          width: `${(selectedElem.widthMm || 18) * 3.5}px`,
                          height: `${(selectedElem.heightMm || 12) * 3.5}px`,
                          objectFit: 'fill',
                          border: '1px solid #38bdf8',
                          borderRadius: '2px',
                          backgroundColor: '#ffffff'
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              {/* 5. 구분선 항목인 경우 */}
              {selectedElem.type === 'line' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>선 길이 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.widthMm || 65}
                        onChange={e => handleElemPropChange('widthMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>선 두께 (mm)</label>
                      <input
                        type="number"
                        step="0.05"
                        value={selectedElem.thicknessMm || 0.25}
                        onChange={e => handleElemPropChange('thicknessMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>X 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.xMm}
                        onChange={e => handleElemPropChange('xMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.65rem', color: '#cbd5e1' }}>Y 좌표 (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedElem.yMm}
                        onChange={e => handleElemPropChange('yMm', e.target.value)}
                        style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '4px', padding: '3px 6px', color: '#f8fafc', fontSize: '0.72rem' }}
                      />
                    </div>
                  </div>

                  {/* ⭐️ X / Y 인쇄 미세 보정 (mm) - 음수 및 양수 자유 조절 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', backgroundColor: '#0f172a', padding: '4px 6px', borderRadius: '4px', border: '1px dashed #334155' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>X 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetX > 0 ? `+${selectedElem.offsetX}` : (selectedElem.offsetX || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetX || 0}
                          onChange={e => handleElemPropChange('offsetX', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetX', Math.round(((Number(selectedElem.offsetX) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 600 }}>Y 보정 (mm)</label>
                        <span style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
                          {selectedElem.offsetY > 0 ? `+${selectedElem.offsetY}` : (selectedElem.offsetY || 0)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) - 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Minus size={9} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="-100"
                          max="100"
                          value={selectedElem.offsetY || 0}
                          onChange={e => handleElemPropChange('offsetY', parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            backgroundColor: '#1e293b',
                            border: '1px solid #0284c7',
                            borderRadius: '3px',
                            padding: '2px 2px',
                            color: '#facc15',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => handleElemPropChange('offsetY', Math.round(((Number(selectedElem.offsetY) || 0) + 0.5) * 10) / 10)}
                          style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer', display: 'flex' }}
                        >
                          <Plus size={9} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* ── [2/2] Right Main: 실제 용지 1:1 정밀 비례 라벨 캔버스 단일 메인 ── */}
        <div style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '12px',
          overflowX: 'auto',
          position: 'relative'
        }}>
          {/* Canvas Top Bar */}
          <div style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #1e293b',
            paddingBottom: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>
                라벨 캔버스
              </span>
              <span style={{ fontSize: '0.68rem', color: '#38bdf8', fontFamily: 'monospace' }}>
                ({template.paper.widthMm}mm × {template.paper.heightMm}mm 정밀 비례)
              </span>
            </div>

            <button
              onClick={() => setShowZplCode(!showZplCode)}
              className="btn btn-outline"
              style={{ fontSize: '0.68rem', padding: '2px 8px', borderColor: '#334155', color: '#94a3b8' }}
            >
              <Code size={11} /> {showZplCode ? 'ZPL 코드 닫기' : 'ZPL 코드 보기'}
            </button>
          </div>

          {/* ⭐️ 실제 용지 1:1 완벽 비례 라벨 캔버스 (Single Truth Visual Canvas) */}
          <div
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              width: `${canvasWidthPx}px`,
              height: `${canvasHeightPx}px`,
              backgroundColor: '#ffffff',
              color: '#000000',
              borderRadius: '6px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px #38bdf8',
              position: 'relative',
              overflow: 'hidden',
              userSelect: 'none',
              flexShrink: 0,
              cursor: draggingId ? 'grabbing' : 'default',
              transition: 'box-shadow 0.2s'
            }}
          >
            {template.elements.filter(e => e.visible).map(elem => {
              const isElemSelected = elem.id === selectedElemId;
              // ⭐️ 캔버스 화면은 라벨 기준 순수 디자인 레이아웃(xMm, yMm)만으로 렌더링 (보정값은 실제 인쇄 ZPL에만 반영)
              const leftPx = (Number(elem.xMm) || 0) * PX_PER_MM;
              const topPx = (Number(elem.yMm) || 0) * PX_PER_MM;

              // 1. 텍스트 요소
              if (elem.type === 'text') {
                let displayVal = elem.prefix || '';
                if (elem.field === 'custom' || elem.field?.startsWith('custom_text_')) {
                  displayVal += (elem.customValue || '');
                } else {
                  displayVal += (SAMPLE_ITEM[elem.field] || elem.field?.toUpperCase() || '');
                }

                // ⭐️ ZPL Dot 기준 캔버스 정밀 1:1 비례 변환 (1mm = 8 dots)
                const fontSizePx = (elem.fontSizePt || 25) * (PX_PER_MM / 8.0);

                return (
                  <div
                    key={elem.id}
                    onMouseDown={(e) => handleMouseDown(e, elem.id)}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      fontSize: `${fontSizePx}px`,
                      fontWeight: 700,
                      fontFamily: elem.fontFamily === 'A0N' ? 'monospace, sans-serif' : 'sans-serif',
                      whiteSpace: 'nowrap',
                      cursor: 'grab',
                      outline: isElemSelected ? '2px solid #0284c7' : '1px dashed rgba(2, 132, 199, 0.3)',
                      padding: '1px 2px',
                      backgroundColor: isElemSelected ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                      lineHeight: 1.1
                    }}
                  >
                    {displayVal}
                  </div>
                );
              }

              // 2. 바코드 / QR 요소
              if (elem.type === 'barcode') {
                const bcVal = SAMPLE_ITEM[elem.targetField] || SAMPLE_ITEM.asset_no || 'TEST0001';
                const heightPx = (elem.heightMm || 10) * PX_PER_MM;
                const qrScale = Math.max(1, Math.min(10, Number(elem.qrScale) || 3));
                const qrSizeMm = (qrScale * 25.0) / 8.0;
                const qrSizePx = qrSizeMm * PX_PER_MM;

                return (
                  <div
                    key={elem.id}
                    onMouseDown={(e) => handleMouseDown(e, elem.id)}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      cursor: 'grab',
                      outline: isElemSelected ? '2px solid #0284c7' : '1px dashed rgba(2, 132, 199, 0.3)',
                      padding: '1px',
                      backgroundColor: isElemSelected ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center'
                    }}
                  >
                    {elem.barcodeType === 'QR' ? (
                      <div style={{
                        width: `${qrSizePx}px`,
                        height: `${qrSizePx}px`,
                        backgroundColor: '#ffffff',
                        border: '1px solid #000000',
                        color: '#000000',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                        padding: '1px',
                        position: 'relative'
                      }}>
                        <svg viewBox="0 0 29 29" width="100%" height="100%" shapeRendering="crispEdges">
                          {/* Corner Top-Left */}
                          <rect x="0" y="0" width="7" height="7" fill="#000" />
                          <rect x="1" y="1" width="5" height="5" fill="#fff" />
                          <rect x="2" y="2" width="3" height="3" fill="#000" />
                          {/* Corner Top-Right */}
                          <rect x="22" y="0" width="7" height="7" fill="#000" />
                          <rect x="23" y="1" width="5" height="5" fill="#fff" />
                          <rect x="24" y="2" width="3" height="3" fill="#000" />
                          {/* Corner Bottom-Left */}
                          <rect x="0" y="22" width="7" height="7" fill="#000" />
                          <rect x="1" y="23" width="5" height="5" fill="#fff" />
                          <rect x="2" y="24" width="3" height="3" fill="#000" />
                          {/* Pattern Dots */}
                          <rect x="9" y="2" width="2" height="2" fill="#000" />
                          <rect x="13" y="2" width="2" height="2" fill="#000" />
                          <rect x="17" y="2" width="2" height="2" fill="#000" />
                          <rect x="9" y="6" width="3" height="2" fill="#000" />
                          <rect x="14" y="6" width="2" height="3" fill="#000" />
                          <rect x="18" y="7" width="2" height="2" fill="#000" />
                          <rect x="2" y="9" width="2" height="3" fill="#000" />
                          <rect x="6" y="10" width="2" height="2" fill="#000" />
                          <rect x="10" y="10" width="3" height="3" fill="#000" />
                          <rect x="15" y="11" width="4" height="2" fill="#000" />
                          <rect x="21" y="10" width="2" height="4" fill="#000" />
                          <rect x="25" y="11" width="3" height="2" fill="#000" />
                          <rect x="2" y="14" width="3" height="2" fill="#000" />
                          <rect x="7" y="14" width="2" height="3" fill="#000" />
                          <rect x="11" y="15" width="2" height="2" fill="#000" />
                          <rect x="15" y="15" width="3" height="3" fill="#000" />
                          <rect x="20" y="16" width="3" height="2" fill="#000" />
                          <rect x="25" y="15" width="2" height="3" fill="#000" />
                          <rect x="9" y="20" width="3" height="2" fill="#000" />
                          <rect x="14" y="20" width="2" height="3" fill="#000" />
                          <rect x="18" y="21" width="4" height="2" fill="#000" />
                          <rect x="24" y="20" width="3" height="2" fill="#000" />
                          <rect x="9" y="24" width="2" height="3" fill="#000" />
                          <rect x="13" y="25" width="3" height="2" fill="#000" />
                          <rect x="18" y="25" width="2" height="3" fill="#000" />
                          <rect x="22" y="24" width="3" height="3" fill="#000" />
                        </svg>
                      </div>
                    ) : (
                      <RealBarcodeSvg
                        value={bcVal}
                        type={elem.barcodeType || 'CODE128'}
                        heightPx={heightPx}
                        showText={elem.showText !== false}
                        scale={PX_PER_MM / 9.0}
                        prefix={elem.prefix || ''}
                      />
                    )}
                  </div>
                );
              }

              // 3. 구분선 요소
              if (elem.type === 'line') {
                const widthPx = (elem.widthMm || 65) * PX_PER_MM;
                const thicknessPx = Math.max(1, (elem.thicknessMm || 0.25) * PX_PER_MM);

                return (
                  <div
                    key={elem.id}
                    onMouseDown={(e) => handleMouseDown(e, elem.id)}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${widthPx}px`,
                      height: `${thicknessPx}px`,
                      backgroundColor: '#000000',
                      cursor: 'grab',
                      outline: isElemSelected ? '2px solid #0284c7' : 'none'
                    }}
                  />
                );
              }

              // 4. 이미지 요소 (비율 고정 무시 자유 리사이징)
              if (elem.type === 'image') {
                const imgWPx = (elem.widthMm || 18) * PX_PER_MM;
                const imgHPx = (elem.heightMm || 12) * PX_PER_MM;

                return (
                  <div
                    key={elem.id}
                    onMouseDown={(e) => handleMouseDown(e, elem.id)}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${imgWPx}px`,
                      height: `${imgHPx}px`,
                      cursor: 'grab',
                      outline: isElemSelected ? '2px solid #0284c7' : '1px dashed rgba(2, 132, 199, 0.3)',
                      backgroundColor: isElemSelected ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden'
                    }}
                  >
                    {elem.imageDataUrl ? (
                      <img
                        src={elem.imageDataUrl}
                        alt="logo"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                          display: 'block',
                          pointerEvents: 'none'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        border: '1px dashed #38bdf8',
                        color: '#0284c7',
                        fontSize: '9px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(2, 132, 199, 0.05)'
                      }}>
                        이미지 선택
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </div>

          {/* ⭐️ 하단 ZPL 코드 편집기 (직접 수정 및 즉시 테스트 인쇄 가능) */}
          {showZplCode && (
            <div style={{
              width: '100%',
              marginTop: '10px',
              backgroundColor: '#0a0f1d',
              border: isZplCustomized ? '1px solid #eab308' : '1px solid #38bdf8',
              borderRadius: '6px',
              padding: '10px',
              boxSizing: 'border-box'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
                flexWrap: 'wrap',
                gap: '6px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isZplCustomized ? '#facc15' : '#38bdf8' }}>
                    ZPL 코드 직접 편집기
                  </span>

                  {/* ⭐️ 상단 바 ^LH / ^PW 토글 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: '4px', border: '1px solid #334155' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.68rem', color: template.paper?.useLabelHome ? '#38bdf8' : '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={!!template.paper?.useLabelHome}
                        onChange={e => {
                          handlePaperChange('useLabelHome', e.target.checked);
                          setIsZplCustomized(false);
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>^LH</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.68rem', color: template.paper?.usePrintWidth ? '#38bdf8' : '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={!!template.paper?.usePrintWidth}
                        onChange={e => {
                          handlePaperChange('usePrintWidth', e.target.checked);
                          setIsZplCustomized(false);
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>^PW</span>
                    </label>
                  </div>

                  {isZplCustomized && (
                    <span style={{ fontSize: '0.62rem', backgroundColor: '#eab308', color: '#000', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                      수정됨 (직접 입력 모드)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isZplCustomized && (
                    <button
                      onClick={handleResetZplToDefault}
                      className="btn btn-outline"
                      style={{ fontSize: '0.68rem', padding: '3px 8px', borderColor: '#475569', color: '#cbd5e1' }}
                    >
                      <RotateCcw size={11} /> 자동생성 코드로 복원
                    </button>
                  )}

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(customZpl || currentZpl);
                      alert('ZPL 코드가 클립보드에 복사되었습니다.');
                    }}
                    className="btn btn-outline"
                    style={{ fontSize: '0.68rem', padding: '3px 8px', borderColor: '#475569', color: '#cbd5e1' }}
                  >
                    <Copy size={11} /> 복사
                  </button>

                  <button
                    onClick={handleManualCustomZplPrint}
                    disabled={isPrinting}
                    className="btn btn-primary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 12px',
                      backgroundColor: isZplCustomized ? '#f59e0b' : '#0284c7',
                      color: '#ffffff',
                      fontWeight: 700,
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
                    }}
                  >
                    <Printer size={12} /> {isPrinting ? '인쇄 중...' : (isZplCustomized ? '수정된 ZPL로 즉시 테스트 인쇄' : '현재 ZPL로 테스트 인쇄')}
                  </button>
                </div>
              </div>

              <textarea
                value={customZpl || currentZpl}
                onChange={e => {
                  setCustomZpl(e.target.value);
                  setIsZplCustomized(true);
                }}
                placeholder="^XA로 시작하는 ZPL 코드를 직접 입력하세요..."
                style={{
                  width: '100%',
                  height: '160px',
                  backgroundColor: '#030712',
                  border: '1px solid #1e293b',
                  borderRadius: '4px',
                  color: isZplCustomized ? '#fef08a' : '#38bdf8',
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontSize: '0.78rem',
                  lineHeight: '1.4',
                  padding: '8px 10px',
                  boxSizing: 'border-box',
                  resize: 'vertical'
                }}
              />
              <div style={{ fontSize: '0.62rem', color: '#94a3b8', marginTop: '4px', textAlign: 'right' }}>
                💡 에디터에서 ^FO 좌표, ^BQ 배율 등을 직접 수정하고 [즉시 테스트 인쇄]를 누르면 실물 프린터로 바로 출력됩니다.
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── [모달 1] 디자인 추가 모달 ─────────────────────────────── */}
      {isCreateModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #38bdf8',
            borderRadius: '8px',
            width: '420px',
            maxWidth: '90vw',
            padding: '16px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={16} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                  라벨 서식 디자인 추가
                </span>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>서식 명칭</label>
                <input
                  type="text"
                  value={newDesignName}
                  onChange={(e) => setNewDesignName(e.target.value)}
                  placeholder="예: 입고 검수용 라벨"
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#f8fafc',
                    fontSize: '0.78rem'
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>대상 테이블 선택</label>
                <select
                  value={newDesignTable}
                  onChange={(e) => setNewDesignTable(e.target.value)}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #38bdf8',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#38bdf8',
                    fontSize: '0.78rem',
                    fontWeight: 600
                  }}
                >
                  <option value="asset">asset (자산 관리 - 15대 정규 헤더)</option>
                  <option value="temp_asset">temp_asset (임시 자산 - 입고 검수 헤더)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>출력 대상 프린터 지정</label>
                <select
                  value={newDesignPrinterId}
                  onChange={(e) => setNewDesignPrinterId(e.target.value)}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#f8fafc',
                    fontSize: '0.78rem'
                  }}
                >
                  <option value="">-- 기본 라벨 프린터 (자동) --</option>
                  {printers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.isHardwareDetected ? `🟢 ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>용지 폭 (mm)</label>
                  <input
                    type="number"
                    value={newDesignWidth}
                    onChange={(e) => setNewDesignWidth(e.target.value)}
                    style={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      color: '#f8fafc',
                      fontSize: '0.78rem'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600 }}>용지 높이 (mm)</label>
                  <input
                    type="number"
                    value={newDesignHeight}
                    onChange={(e) => setNewDesignHeight(e.target.value)}
                    style={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      color: '#f8fafc',
                      fontSize: '0.78rem'
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => jsonFileInputRef.current?.click()}
                className="btn btn-outline"
                style={{
                  fontSize: '0.72rem',
                  padding: '5px 10px',
                  borderColor: '#38bdf8',
                  color: '#38bdf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
                title="로컬 PC에 저장된 JSON 라벨 서식 파일 불러와서 추가"
              >
                <Upload size={12} /> JSON 파일 불러오기
              </button>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="btn btn-outline"
                  style={{ fontSize: '0.72rem', padding: '5px 12px' }}
                >
                  취소
                </button>
                <button
                  onClick={handleCreateNewDesign}
                  className="btn btn-primary"
                  style={{
                    fontSize: '0.72rem',
                    padding: '5px 14px',
                    backgroundColor: '#0284c7',
                    borderColor: '#38bdf8',
                    color: '#ffffff',
                    fontWeight: 700
                  }}
                >
                  디자인 생성
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── [모달 2] 디자인 불러오기 관리 모달 ───────────────────────── */}
      {isLoadModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #38bdf8',
            borderRadius: '8px',
            width: '580px',
            maxWidth: '92vw',
            maxHeight: '80vh',
            padding: '16px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FolderOpen size={16} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                  라벨 서식 디자인 불러오기
                </span>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  (총 {presets.length}건)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => jsonFileInputRef.current?.click()}
                  className="btn btn-outline"
                  style={{
                    fontSize: '0.68rem',
                    padding: '3px 8px',
                    borderColor: '#38bdf8',
                    color: '#38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="로컬 JSON 서식 파일 불러와서 서식 목록에 추가"
                >
                  <Upload size={11} /> JSON 파일 추가
                </button>
                <button
                  onClick={() => setIsLoadModalOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Presets List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '420px', paddingRight: '4px' }} className="grid-scrollbar">
              {presets.map(p => {
                const isCurrent = template ? (p.templateId === template.templateId) : false;
                const isTemp = p.targetTable === 'temp_asset';

                return (
                  <div
                    key={p.templateId}
                    onClick={() => !p.isLocked && handleLoadDesign(p.templateId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      backgroundColor: isCurrent ? 'rgba(2, 132, 199, 0.15)' : '#0f172a',
                      border: `1px solid ${isCurrent ? '#38bdf8' : (p.isLocked ? '#b45309' : '#334155')}`,
                      cursor: p.isLocked ? 'default' : 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: isCurrent ? '#38bdf8' : '#f8fafc' }}>
                          {p.name}
                        </span>
                        {p.isLocked && (
                          <span style={{
                            fontSize: '0.65rem',
                            backgroundColor: 'rgba(180, 83, 9, 0.25)',
                            color: '#fbbf24',
                            border: '1px solid #b45309',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}>
                            <Lock size={10} /> 확정 서식
                          </span>
                        )}
                        {isCurrent && (
                          <span style={{ fontSize: '0.65rem', backgroundColor: '#0284c7', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                            현재 서식
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.68rem', color: '#94a3b8' }}>
                        <span style={{ color: isTemp ? '#d8b4fe' : '#93c5fd' }}>
                          테이블: {isTemp ? 'temp_asset' : 'asset'}
                        </span>
                        <span>|</span>
                        <span>용지: {p.paper?.widthMm} × {p.paper?.heightMm} mm</span>
                        <span>|</span>
                        <span>항목: {p.elements?.filter(e => e.visible)?.length || 0}개</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                      {/* JSON 서식 파일 내보내기 버튼 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExportJson(p); }}
                        className="btn btn-outline"
                        style={{ fontSize: '0.68rem', padding: '3px 6px', borderColor: '#38bdf8', color: '#38bdf8' }}
                        title="이 서식을 JSON 파일로 로컬에 내보내기 (다운로드)"
                      >
                        <Download size={12} />
                      </button>

                      {/* 관리자 잠금/해제 토글 버튼 */}
                      <button
                        onClick={(e) => handleToggleLock(p.templateId, e)}
                        className="btn btn-outline"
                        style={{
                          fontSize: '0.68rem',
                          padding: '3px 7px',
                          borderColor: p.isLocked ? '#f59e0b' : '#475569',
                          color: p.isLocked ? '#fbbf24' : '#94a3b8',
                          backgroundColor: p.isLocked ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                        title={p.isLocked ? "확정 서식 잠금 해제 (수정/삭제 허용)" : "서식 잠금 (수정/삭제/불러오기 방지)"}
                      >
                        {p.isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                        <span>{p.isLocked ? '잠김' : '잠금'}</span>
                      </button>

                      {/* ⭐️ 잠금 상태가 아닐 때만 불러오기 및 삭제 버튼 노출 */}
                      {!p.isLocked && (
                        <>
                          <button
                            onClick={() => handleLoadDesign(p.templateId)}
                            className="btn btn-primary"
                            style={{ fontSize: '0.68rem', padding: '3px 8px' }}
                          >
                            불러오기
                          </button>
                          <button
                            onClick={(e) => handleDeleteDesignInModal(p.templateId, p.name, e)}
                            className="btn btn-outline"
                            style={{ fontSize: '0.68rem', padding: '3px 6px', borderColor: '#ef4444', color: '#fca5a5' }}
                            title="서식 삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #334155', paddingTop: '8px' }}>
              <button
                onClick={() => setIsLoadModalOpen(false)}
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '4px 12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⭐️ 관리자 비밀번호 게이트키퍼 모달 (확정 서식 잠금 해제 시 필수 인증) */}
      <AdminGatekeeperModal
        isOpen={gatekeeperState.isOpen}
        onClose={() => setGatekeeperState({ isOpen: false, templateId: null, templateName: '' })}
        onSuccess={handleUnlockAfterAuth}
        targetFeatureName={`라벨 서식 잠금 해제: ${gatekeeperState.templateName}`}
      />

      {/* ⭐️ JSON 서식 파일 로컬 업로드 input */}
      <input
        type="file"
        ref={jsonFileInputRef}
        onChange={handleImportJsonFile}
        accept=".json,application/json"
        style={{ display: 'none' }}
      />
    </div>
  );
}
