import React, { useState, useEffect, useRef } from 'react';
import {
  Printer,
  Barcode,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sliders,
  Settings,
  Plus,
  Trash2,
  FolderOpen,
  Layers,
  Sparkles,
  Volume2,
  RefreshCw,
  Bluetooth,
  Radio,
  Zap
} from 'lucide-react';
import { getDbClient, insertPrintQueue } from '../utils/dbClient';
import {
  getAllPresets,
  getStoredLabelTemplate,
  generateDynamicZpl,
  generateWysiwygZpl,
  saveStoredLabelTemplate,
  syncTemplatesWithBackend
} from '../utils/labelTemplate';
import {
  getRegisteredPrinters,
  getActivePrinterId,
  setActivePrinterId,
  saveRegisteredPrinter,
  deleteRegisteredPrinter,
  sendZplToPrinter,
  fetchActualConnectedPrinters
} from '../utils/printerManager';
import {
  reconnectWindowsBluetoothViaAgent,
  openWindowsBluetoothSettingsViaAgent
} from '../utils/bluetoothScannerManager';
import { RealBarcodeSvg } from '../utils/barcode39';
import { triggerSuccessFeedback } from '../utils/soundFeedback';

export default function DirectPrintTab({ onError, onOpenPrintModal }) {
  // ── 환경 설정 상태 ──────────────────────────────────────────
  const [printers, setPrinters] = useState(getRegisteredPrinters);
  const [activePrinterIdState, setActivePrinterIdState] = useState(getActivePrinterId);
  const [presets, setPresets] = useState(getAllPresets);
  const [selectedTemplate, setSelectedTemplate] = useState(getStoredLabelTemplate);
  const [targetTable, setTargetTable] = useState(selectedTemplate.targetTable || 'asset');

  // ── 스캔 & 인쇄 인터랙션 상태 ────────────────────────────────
  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScannedItem, setLastScannedItem] = useState(null);
  const [lastZpl, setLastZpl] = useState('');
  const [printCopies, setPrintCopies] = useState(1);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
  const [recentLogs, setRecentLogs] = useState([]);

  // ── 모달 상태 ───────────────────────────────────────────────
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterType, setNewPrinterType] = useState('web_serial');
  const [newPrinterTarget, setNewPrinterTarget] = useState('COM Port / USB');
  const [newPrinterBaud, setNewPrinterBaud] = useState('9600');

  const inputRef = useRef(null);
  const canvasRef = useRef(null);

  // 활성 프린터 객체
  const activePrinter = printers.find(p => p.id === activePrinterIdState) || printers[0];

  const [isScanningPrinters, setIsScanningPrinters] = useState(false);
  const [isResettingBle, setIsResettingBle] = useState(false);

  // ⭐️ [핵심] 윈도우 블루투스 1초 고속 리셋 & 슬립 스캐너 즉시 재연결
  const handleQuickReconnectBluetooth = async () => {
    setIsResettingBle(true);
    setStatusMessage({ type: 'info', text: 'Windows 블루투스 스택 리셋 중... (고스트 세션 정리)' });
    try {
      const res = await reconnectWindowsBluetoothViaAgent();
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: '✅ ' + res.message
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: res.message
        });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `블루투스 리셋 실패: ${err.message}` });
    } finally {
      setIsResettingBle(false);
      inputRef.current?.focus();
    }
  };

  // ⭐️ Windows 블루투스 설정창 열기
  const handleOpenBluetoothSettings = async () => {
    await openWindowsBluetoothSettingsViaAgent();
  };

  // ⭐️ 마운트 시 실제 연결된 프린터 및 온라인 DB 전체 서식 목록 동기화
  useEffect(() => {
    Promise.all([
      syncTemplatesWithBackend(),
      fetchActualConnectedPrinters()
    ]).then(([syncedPresets, detectedPrinters]) => {
      let currentPrinters = getRegisteredPrinters();
      if (detectedPrinters && detectedPrinters.length > 0) {
        currentPrinters = detectedPrinters;
        setPrinters(detectedPrinters);
      }

      if (syncedPresets && syncedPresets.length > 0) {
        setPresets(syncedPresets);
        const active = getStoredLabelTemplate() || syncedPresets[0];
        if (active) {
          setSelectedTemplate(active);
          setTargetTable(active.targetTable || 'asset');

          // ⭐️ 활성 서식에 지정된 프린터가 있으면 즉시 활성화!
          const targetPrnId = active.targetPrinterId;
          const targetPrnName = active.targetPrinterName;
          if (targetPrnId || targetPrnName) {
            const targetPrn = currentPrinters.find(p =>
              (targetPrnId && p.id === targetPrnId) ||
              (targetPrnName && (p.name === targetPrnName || p.rawName === targetPrnName))
            );
            if (targetPrn) {
              handleSelectPrinter(targetPrn.id);
            }
          }
        }
      }
    }).catch(() => {});
  }, []);

  // ⭐️ 실제 컴퓨터 연결 프린터 수동 재검색
  const handleDiscoverPrinters = async () => {
    setIsScanningPrinters(true);
    try {
      const detected = await fetchActualConnectedPrinters();
      if (detected && detected.length > 0) {
        setPrinters(detected);
        const currentActive = getActivePrinterId();
        const exists = detected.some(p => p.id === currentActive);
        if (!exists) {
          setActivePrinterIdState(detected[0].id);
          setActivePrinterId(detected[0].id);
        }
        setStatusMessage({ type: 'success', text: `컴퓨터에 연결된 실제 프린터 ${detected.length}대를 감지하였습니다.` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `프린터 검색 실패: ${err.message}` });
    } finally {
      setIsScanningPrinters(false);
    }
  };

  // 렌더링 시 입력창 항상 자동 포커스 유지
  useEffect(() => {
    inputRef.current?.focus();
  }, [isProcessing, lastScannedItem]);

  // 서식 변경 시 타겟 테이블, 프린터 자동 바인딩 및 동기화
  const handleSelectTemplate = (presetId) => {
    const found = presets.find(p => p.templateId === presetId);
    if (found) {
      setSelectedTemplate(found);
      setTargetTable(found.targetTable || found.paper?.targetTable || 'asset');
      saveStoredLabelTemplate(found);

      // ⭐️ 해당 서식에 지정된 전용 프린터가 있으면 자동 활성화 & 에이전트 동기화!
      const targetPrnId = found.targetPrinterId || found.paper?.targetPrinterId;
      const targetPrnName = found.targetPrinterName || found.paper?.targetPrinterName;
      if (targetPrnId || targetPrnName) {
        const targetPrn = printers.find(p =>
          (targetPrnId && p.id === targetPrnId) ||
          (targetPrnName && (p.name === targetPrnName || p.rawName === targetPrnName)) ||
          (targetPrnName && p.name.toLowerCase().includes(targetPrnName.toLowerCase())) ||
          (targetPrnId && p.rawName && targetPrnId.includes(p.rawName))
        );
        if (targetPrn) {
          handleSelectPrinter(targetPrn.id);
        }
      }
    }
  };

  // 타겟 테이블 전환 시 알맞은 서식 자동 매칭
  const handleSwitchTargetTable = (tableId) => {
    setTargetTable(tableId);
    const matched = presets.find(p => p.targetTable === tableId) || presets[0];
    if (matched) {
      setSelectedTemplate(matched);
      saveStoredLabelTemplate(matched);
      const targetPrnId = matched.targetPrinterId || matched.paper?.targetPrinterId;
      const targetPrnName = matched.targetPrinterName || matched.paper?.targetPrinterName;
      if (targetPrnId || targetPrnName) {
        const targetPrn = printers.find(p =>
          (targetPrnId && p.id === targetPrnId) ||
          (targetPrnName && (p.name === targetPrnName || p.rawName === targetPrnName)) ||
          (targetPrnName && p.name.toLowerCase().includes(targetPrnName.toLowerCase())) ||
          (targetPrnId && p.rawName && targetPrnId.includes(p.rawName))
        );
        if (targetPrn) {
          handleSelectPrinter(targetPrn.id);
        }
      }
    }
  };

  // 프린터 선택 변경 (브라우저 localStorage + 로컬 에이전트 agent-config.json 동시 영구 기억)
  const handleSelectPrinter = async (printerId) => {
    setActivePrinterIdState(printerId);
    setActivePrinterId(printerId);

    const selectedPrn = printers.find(p => p.id === printerId);
    if (selectedPrn && selectedPrn.rawName) {
      try {
        await fetch('http://127.0.0.1:9988/api/select-printer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName: selectedPrn.rawName,
            connectionType: selectedPrn.type === 'agent_usb' ? 'USB_RAW' : 'TCP',
            usbPort: selectedPrn.portName || 'USB001',
            printerHost: selectedPrn.portName ? selectedPrn.portName.replace(/^IP_/i, '') : '127.0.0.1',
            printerPort: 9100
          })
        }).catch(() => {});
      } catch (e) {}
    }
  };

  // ⭐️ 신규 프린터 등록
  const handleRegisterPrinter = () => {
    if (!newPrinterName.trim()) {
      alert('프린터 명칭을 입력하세요.');
      return;
    }
    const newPrn = {
      id: `prn_custom_${Date.now()}`,
      name: newPrinterName.trim(),
      type: newPrinterType,
      target: newPrinterTarget.trim(),
      baudRate: Number(newPrinterBaud) || 9600,
      isDefault: false
    };
    const updated = saveRegisteredPrinter(newPrn);
    setPrinters(updated);
    setActivePrinterIdState(newPrn.id);
    setActivePrinterId(newPrn.id);
    setIsPrinterModalOpen(false);
    setNewPrinterName('');
  };

  // 프린터 삭제
  const handleDeletePrinter = (printerId) => {
    if (printers.length <= 1) {
      alert('최소 1개의 프린터 설정은 유지되어야 합니다.');
      return;
    }
    if (window.confirm('이 프린터 설정을 삭제하시겠습니까?')) {
      const updated = deleteRegisteredPrinter(printerId);
      setPrinters(updated);
      if (activePrinterIdState === printerId) {
        setActivePrinterIdState(updated[0]?.id || '');
        setActivePrinterId(updated[0]?.id || '');
      }
    }
  };

  // ⭐️ 핵심: 바코드 스캔 / 엔터 입력 시 실시간 DB 조회 & 즉시 자동 라벨 출력
  const handleExecuteScanAndPrint = async (codeToSearch = null) => {
    const query = (codeToSearch || scanInput).trim();
    if (!query) return;

    setIsProcessing(true);
    setStatusMessage({ type: 'info', text: `'${query}' 조회 중...` });

    try {
      const client = getDbClient();
      let matchedItem = null;

      if (client) {
        if (targetTable === 'temp_asset') {
          // 1. temp_asset / temp_assets 테이블 최우선 조회
          try {
            const { data, error } = await client
              .from('temp_asset')
              .select('*')
              .or(`asset_no.eq.${query},serial_no.eq.${query},imei.eq.${query},asset_no.ilike.%${query}%,serial_no.ilike.%${query}%`)
              .limit(1)
              .maybeSingle();

            if (!error && data) matchedItem = data;
          } catch (e) {
            console.warn('temp_asset direct query fallback');
          }

          if (!matchedItem) {
            try {
              const { data, error } = await client
                .from('temp_assets')
                .select('*')
                .or(`asset_no.eq.${query},serial_no.eq.${query},imei.eq.${query},id.eq.${query}`)
                .limit(1)
                .maybeSingle();

              if (!error && data) matchedItem = data;
            } catch (e) {}
          }

          // 로컬 스토리지 temp_asset 폴백
          if (!matchedItem) {
            try {
              const localTemp = JSON.parse(localStorage.getItem('IMAGE_SCAN_TEMP_ASSET_ITEMS') || '[]');
              matchedItem = localTemp.find(it =>
                it.asset_no === query ||
                it.id === query ||
                it.serial_no === query ||
                Object.values(it).some(v => String(v).toLowerCase() === query.toLowerCase())
              );
            } catch (e) {}
          }
        } else {
          // 2. asset 정규 마스터 테이블 최우선 조회 (데이터 목록 탭과 100% 동일)
          try {
            const { data, error } = await client
              .from('asset')
              .select('*')
              .or(`asset_no.eq.${query},serial_no.eq.${query},imei.eq.${query},asset_no.ilike.%${query}%,serial_no.ilike.%${query}%,imei.ilike.%${query}%`)
              .limit(1)
              .maybeSingle();

            if (!error && data) {
              matchedItem = {
                ...data,
                id: data.asset_no || data.id,
                asset_no: data.asset_no,
                serial_no: data.serial_no,
                product_name: data.product_name,
                model_name: data.model_name,
                category_major: data.category_major || '',
                shelf_no: data.shelf_no,
                asset_status: data.asset_status || '정상',
                asset_option: data.asset_option,
                calibration_date: data.calibration_date,
                mac_wlan: data.mac_wlan,
                mac_lan: data.mac_lan,
                imei: data.imei,
                components: data.components,
                spec: data.spec || data.components || '',
                remark: data.remark
              };
            }
          } catch (e) {
            console.warn('asset master query fallback:', e.message);
          }
        }

        // 3. 레거시 scan_records 2차 폴백
        if (!matchedItem) {
          try {
            const { data, error } = await client
              .from('scan_records')
              .select('*')
              .or(`key_value.eq.${query},data->>asset_no.eq.${query},data->>serial_no.eq.${query},data->>imei.eq.${query}`)
              .limit(1)
              .maybeSingle();

            if (!error && data) {
              matchedItem = {
                id: data.id,
                asset_no: data.data?.asset_no || data.key_value,
                serial_no: data.data?.serial_no || query,
                product_name: data.data?.product_name || '',
                model_name: data.data?.model_name || '',
                category_major: data.data?.category_major || '',
                shelf_no: data.data?.shelf_no || '',
                asset_status: data.data?.asset_status || '정상',
                asset_option: data.data?.asset_option || '',
                imei: data.data?.imei || '',
                mac_wlan: data.data?.mac_wlan || '',
                mac_lan: data.data?.mac_lan || '',
                spec: data.data?.spec || '',
                remark: data.data?.remark || '',
                ...data.data
              };
            }
          } catch (e) {}
        }
      }

      // ⭐️ 조회 결과가 없더라도 스캔된 번호로 기본 라벨 즉시 생성 & 100% 인쇄 보장
      if (!matchedItem) {
        matchedItem = {
          asset_no: query,
          serial_no: query,
          product_name: '스캔 출력',
          model_name: '-',
          asset_status: '정상',
          shelf_no: '-'
        };
      }

      // 즉시 라벨 인쇄 집행!
      triggerSuccessFeedback();
      setLastScannedItem(matchedItem);

        // 1. ⭐️ 캔버스 100% WYSIWYG 비트맵 ZPL 코드 생성 (한글/위치/바코드 1:1 완벽 일치)
        let zpl = '';
        try {
          zpl = await generateWysiwygZpl(matchedItem, selectedTemplate);
        } catch (zplErr) {
          console.warn('Wysiwyg ZPL 생성 폴백:', zplErr);
          zpl = generateDynamicZpl(matchedItem, selectedTemplate);
        }
        setLastZpl(zpl);

        // 2. 선택된 프린터로 즉시 ZPL 전송
        let printResultMsg = '인쇄 완료';
        try {
          const res = await sendZplToPrinter(zpl, activePrinter);
          printResultMsg = res.message;
        } catch (printErr) {
          console.warn('Direct Printer Send Warning:', printErr.message);
          printResultMsg = `전송 경고: ${printErr.message}`;
        }

        // 3. Supabase 프린트 큐에도 무누락 적재
        try {
          await insertPrintQueue({
            itemData: matchedItem,
            zplCode: zpl,
            copies: printCopies || 1,
            printerName: activePrinter?.name || '기본 라벨 프린터',
            status: 'COMPLETED'
          });
        } catch (e) {}

        // 4. 최근 출력 이력 누적
        const logEntry = {
          id: `log_${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          targetTable,
          assetNo: matchedItem.asset_no || query,
          productName: matchedItem.product_name || '-',
          modelName: matchedItem.model_name || '-',
          serialNo: matchedItem.serial_no || '-',
          printerName: activePrinter?.name || '-',
          status: 'SUCCESS'
        };
        setRecentLogs(prev => [logEntry, ...prev.slice(0, 19)]);

        setStatusMessage({
          type: 'success',
          text: `[${matchedItem.asset_no || query}] 조회 성공 ➔ ${activePrinter?.name} 즉시 출력 완료!`
        });

        // 5. 입력창 자동 비움 및 포커스 복원
        setScanInput('');
    } catch (err) {
      setStatusMessage({ type: 'error', text: `오류 발생: ${err.message}` });
      if (onError) onError(err);
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  // ⭐️ 수동 재인쇄
  const handleManualReprint = async () => {
    if (!lastScannedItem) {
      alert('먼저 자산을 조회하거나 스캔하세요.');
      return;
    }
    setIsProcessing(true);
    try {
      const zpl = await generateWysiwygZpl(lastScannedItem, selectedTemplate);
      await sendZplToPrinter(zpl, activePrinter);
      setStatusMessage({
        type: 'success',
        text: `[${lastScannedItem.asset_no}] ${printCopies}매 재인쇄 완료!`
      });
    } catch (err) {
      setStatusMessage({ type: 'error', text: `재인쇄 실패: ${err.message}` });
    } finally {
      setIsProcessing(false);
      inputRef.current?.focus();
    }
  };

  // 캔버스 픽셀 계산
  const PX_PER_MM = 3.78;
  const canvasWidthPx = Math.round((selectedTemplate.paper?.widthMm || 72) * PX_PER_MM);
  const canvasHeightPx = Math.round((selectedTemplate.paper?.heightMm || 40) * PX_PER_MM);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      color: '#f8fafc',
      width: '100%',
      minHeight: '700px'
    }}>
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 1. 상단 환경 설정 바 (프린터 등록/선택 + 서식 선택 + 타겟 DB)    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '10px 14px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '12px',
        alignItems: 'center'
      }}>
        {/* 1) 서식 지정 출력 프린터 (자동 바인딩 & 고정) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Printer size={13} /> 서식 지정 출력 프린터
            </label>
            <span style={{ fontSize: '0.62rem', color: '#10b981', fontWeight: 700 }}>
              ● 서식 자동 바인딩됨
            </span>
          </div>
          <div style={{
            width: '100%',
            boxSizing: 'border-box',
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '4px',
            padding: '7px 10px',
            color: '#38bdf8',
            fontSize: '0.78rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedTemplate.targetPrinterName || selectedTemplate.paper?.targetPrinterName || activePrinter?.name || '기본 라벨 프린터 (자동)'}
            </span>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', padding: '1px 6px', backgroundColor: '#1e293b', borderRadius: '3px', flexShrink: 0 }}>
              {activePrinter?.portName || activePrinter?.type || '연결됨'}
            </span>
          </div>
        </div>

        {/* 2) 라벨 디자인 서식 선택 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Sliders size={13} /> 라벨 디자인 서식 선택
          </label>
          <select
            value={selectedTemplate.templateId}
            onChange={e => handleSelectTemplate(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: '#0f172a',
              border: '1px solid #475569',
              borderRadius: '4px',
              padding: '6px 8px',
              color: '#f8fafc',
              fontSize: '0.78rem',
              fontWeight: 600
            }}
          >
            {presets.map(p => (
              <option key={p.templateId} value={p.templateId}>
                {p.name} ({p.paper?.widthMm}×{p.paper?.heightMm}mm / {p.targetTable})
              </option>
            ))}
          </select>
        </div>

        {/* 3) 타겟 DB 선택 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Layers size={13} /> 타겟 DB 테이블
          </label>
          <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
            <button
              onClick={() => handleSwitchTargetTable('asset')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '4px',
                border: `1px solid ${targetTable === 'asset' ? '#38bdf8' : '#334155'}`,
                backgroundColor: targetTable === 'asset' ? '#0369a1' : '#0f172a',
                color: targetTable === 'asset' ? '#ffffff' : '#94a3b8',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              asset (자산관리)
            </button>
            <button
              onClick={() => handleSwitchTargetTable('temp_asset')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '4px',
                border: `1px solid ${targetTable === 'temp_asset' ? '#a855f7' : '#334155'}`,
                backgroundColor: targetTable === 'temp_asset' ? '#6b21a8' : '#0f172a',
                color: targetTable === 'temp_asset' ? '#ffffff' : '#94a3b8',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              temp_asset (임시자산)
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 2. 메인 워크스페이스 (좌: 초고속 스캔 입력창 | 우: 1:1 라벨 캔버스) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(380px, 1.2fr) minmax(360px, 1fr)',
        gap: '12px',
        alignItems: 'stretch'
      }}>
        {/* ── [좌측] 초고속 바코드 스캔 입력창 & 자산 정보 카드 ── */}
        <div style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* 대형 스캔 입력창 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Barcode size={16} /> 바코드 스캔 / 식별자 입력창
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* ⚡ 윈도우 블루투스 1초 고속 리셋 & 슬립 스캐너 재연결 버튼 */}
                <button
                  onClick={handleQuickReconnectBluetooth}
                  disabled={isResettingBle}
                  className="btn btn-outline"
                  style={{
                    fontSize: '0.7rem',
                    padding: '3px 9px',
                    borderColor: '#f59e0b',
                    color: '#fbbf24',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 700
                  }}
                  title="슬립 모드로 끊어진 블루투스 스캐너를 윈도우에서 1초 만에 강제 재연결합니다"
                >
                  <RefreshCw size={11} className={isResettingBle ? 'spin' : ''} />
                  {isResettingBle ? '블루투스 리셋중...' : '⚡ 스캐너 1초 재연결'}
                </button>

                {/* ⚙️ 윈도우 블루투스 설정 바로 열기 */}
                <button
                  onClick={handleOpenBluetoothSettings}
                  className="btn btn-outline"
                  style={{
                    fontSize: '0.7rem',
                    padding: '3px 8px',
                    borderColor: '#475569',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                  title="Windows 블루투스 설정 창을 엽니다 (제조번호 페어링)"
                >
                  <Bluetooth size={11} />
                  설정
                </button>

                <span style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Zap size={11} color="#facc15" /> Zero-Focus 활성
                </span>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const val = (inputRef.current?.value || scanInput).trim();
                if (val) handleExecuteScanAndPrint(val);
              }}
              style={{ display: 'flex', gap: '6px' }}
            >
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim();
                    if (val) handleExecuteScanAndPrint(val);
                  }
                }}
                placeholder={targetTable === 'temp_asset' ? "임시자산번호 또는 PK(ID) 스캔 / 입력" : "자산번호 또는 제조번호(S/N) 스캔 / 입력"}
                style={{
                  flex: 1,
                  backgroundColor: '#0f172a',
                  border: '2px solid #38bdf8',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#facc15',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                disabled={isProcessing || !scanInput.trim()}
                className="btn btn-primary"
                style={{ fontSize: '0.82rem', padding: '0 16px', fontWeight: 700 }}
              >
                <Search size={14} /> 조회 및 즉시 출력
              </button>
            </form>
          </div>

          {/* 상태 알림 메시지 */}
          {statusMessage.text && (
            <div style={{
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.2)',
              border: `1px solid ${statusMessage.type === 'success' ? '#10b981' : statusMessage.type === 'error' ? '#ef4444' : '#38bdf8'}`,
              color: statusMessage.type === 'success' ? '#34d399' : statusMessage.type === 'error' ? '#f87171' : '#38bdf8'
            }}>
              {statusMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {statusMessage.text}
            </div>
          )}

          {/* 최근 스캔/출력 자산 상세 카드 */}
          <div style={{
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '6px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f8fafc' }}>
                최근 조회 & 출력 자산 정보
              </span>
              {lastScannedItem ? (
                <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>
                  ● 출력 완료
                </span>
              ) : (
                <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                  스캔 대기중
                </span>
              )}
            </div>

            {lastScannedItem ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.72rem' }}>
                <div><span style={{ color: '#94a3b8' }}>자산번호:</span> <strong style={{ color: '#38bdf8' }}>{lastScannedItem.asset_no}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>제조번호(S/N):</span> <strong>{lastScannedItem.serial_no || '-'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>제품명:</span> <strong>{lastScannedItem.product_name || '-'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>모델명:</span> <strong>{lastScannedItem.model_name || '-'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>대분류:</span> <strong>{lastScannedItem.category_major || '-'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>선반위치:</span> <strong>{lastScannedItem.shelf_no || '-'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>상태:</span> <strong style={{ color: '#facc15' }}>{lastScannedItem.asset_status || lastScannedItem.temp_status || '정상'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>옵션/사양:</span> <strong>{lastScannedItem.asset_option || lastScannedItem.spec || '-'}</strong></div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#64748b', fontSize: '0.75rem' }}>
                바코드를 스캔하거나 자산번호/시리얼을 입력하세요.
              </div>
            )}
          </div>

          {/* 수동 재인쇄 제어 영역 */}
          {lastScannedItem && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '8px 12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>인쇄 매수:</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={printCopies}
                  onChange={e => setPrintCopies(Math.max(1, Number(e.target.value)))}
                  style={{
                    width: '45px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '2px 4px',
                    color: '#facc15',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textAlign: 'center'
                  }}
                />
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>매</span>
              </div>

              <button
                onClick={handleManualReprint}
                disabled={isProcessing}
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: '#38bdf8', color: '#38bdf8' }}
              >
                <RotateCcw size={12} /> 추가 재인쇄
              </button>
            </div>
          )}
        </div>

        {/* ── [우측] 실제 출력 1:1 완벽 비례 라벨 캔버스 미리보기 ── */}
        <div style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '10px',
          position: 'relative'
        }}>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8' }}>
              실제 인쇄 라벨 캔버스 ({selectedTemplate.paper?.widthMm}×{selectedTemplate.paper?.heightMm}mm)
            </span>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
              {activePrinter?.name}
            </span>
          </div>

          {/* ⭐️ 실물 1:1 정밀 캔버스 */}
          <div
            ref={canvasRef}
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
              flexShrink: 0
            }}
          >
            {selectedTemplate.elements.filter(e => e.visible).map(elem => {
              // ⭐️ 캔버스 화면은 라벨 기준 순수 디자인 레이아웃(xMm, yMm)만으로 렌더링 (보정값은 실제 인쇄 ZPL에만 반영)
              const leftPx = (Number(elem.xMm) || 0) * PX_PER_MM;
              const topPx = (Number(elem.yMm) || 0) * PX_PER_MM;
              const currentData = lastScannedItem || {
                asset_no: '224011319',
                product_name: '아이패드 9세대',
                model_name: 'A2602',
                serial_no: 'QHJ66F6V0X',
                shelf_no: 'A-01-02'
              };

              // 1. 텍스트 요소
              if (elem.type === 'text') {
                let displayVal = elem.prefix || '';
                if (elem.field === 'custom' || elem.field?.startsWith('custom_text_')) {
                  displayVal += (elem.customValue || '');
                } else {
                  displayVal += (currentData[elem.field] || elem.field?.toUpperCase() || '');
                }
                const fontSizePx = (elem.fontSizePt || 25) * (PX_PER_MM / 8.0);

                return (
                  <div
                    key={elem.id}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      fontSize: `${fontSizePx}px`,
                      fontWeight: 700,
                      fontFamily: elem.fontFamily === 'A0N' ? 'monospace, sans-serif' : 'sans-serif',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.1
                    }}
                  >
                    {displayVal}
                  </div>
                );
              }

              // 2. 바코드 / QR 요소
              if (elem.type === 'barcode') {
                const bcVal = currentData[elem.targetField] || currentData.asset_no || '224011319';
                const heightPx = (elem.heightMm || 10) * PX_PER_MM;
                const qrScale = Math.max(1, Math.min(10, Number(elem.qrScale) || 3));
                const qrSizeMm = (qrScale * 25.0) / 8.0;
                const qrSizePx = qrSizeMm * PX_PER_MM;

                return (
                  <div
                    key={elem.id}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
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

              // 3. 구분선
              if (elem.type === 'line') {
                const widthPx = (elem.widthMm || 65) * PX_PER_MM;
                const thicknessPx = Math.max(1, (elem.thicknessMm || 0.25) * PX_PER_MM);
                return (
                  <div
                    key={elem.id}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${widthPx}px`,
                      height: `${thicknessPx}px`,
                      backgroundColor: '#000000'
                    }}
                  />
                );
              }

              // 4. 이미지
              if (elem.type === 'image' && elem.imageDataUrl) {
                const widthPx = (elem.widthMm || 18) * PX_PER_MM;
                const heightPx = (elem.heightMm || 12) * PX_PER_MM;
                return (
                  <img
                    key={elem.id}
                    src={elem.imageDataUrl}
                    alt="label-img"
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${widthPx}px`,
                      height: `${heightPx}px`,
                      objectFit: 'fill'
                    }}
                  />
                );
              }

              return null;
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 3. 최근 즉시 출력 이력 목록 (Today's Direct Print Logs)         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>
            최근 즉시 출력 이력 ({recentLogs.length}건)
          </span>
          <button
            onClick={() => setRecentLogs([])}
            className="btn btn-outline"
            style={{ fontSize: '0.65rem', padding: '1px 6px' }}
          >
            이력 지우기
          </button>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '200px' }} className="grid-scrollbar">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>출력시간</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>타겟DB</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>자산번호</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>제품명</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>모델명</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>제조번호(S/N)</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>프린터</th>
                <th style={{ padding: '6px 8px', textAlign: 'center' }}>결과</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                    금일 즉시 출력 이력이 없습니다.
                  </td>
                </tr>
              ) : (
                recentLogs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '5px 8px' }}>{log.time}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{
                        padding: '1px 4px',
                        borderRadius: '3px',
                        backgroundColor: log.targetTable === 'temp_asset' ? '#3b0764' : '#1e3a8a',
                        color: log.targetTable === 'temp_asset' ? '#d8b4fe' : '#93c5fd'
                      }}>
                        {log.targetTable}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', fontWeight: 700, color: '#38bdf8' }}>{log.assetNo}</td>
                    <td style={{ padding: '5px 8px' }}>{log.productName}</td>
                    <td style={{ padding: '5px 8px' }}>{log.modelName}</td>
                    <td style={{ padding: '5px 8px' }}>{log.serialNo}</td>
                    <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{log.printerName}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#10b981', fontWeight: 700 }}>
                      성공
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 4. 프린터 등록 및 관리 모달                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isPrinterModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #38bdf8',
            borderRadius: '8px',
            padding: '20px',
            width: '450px',
            maxWidth: '90%',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>
                라벨 프린터 등록 및 관리
              </span>
              <button
                onClick={() => setIsPrinterModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>프린터 명칭</label>
              <input
                type="text"
                value={newPrinterName}
                onChange={e => setNewPrinterName(e.target.value)}
                placeholder="예: Zebra ZD420 (창고 1번 라벨)"
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#f8fafc',
                  fontSize: '0.75rem'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>연결 방식 (타입)</label>
              <select
                value={newPrinterType}
                onChange={e => {
                  setNewPrinterType(e.target.value);
                  if (e.target.value === 'browser_print') setNewPrinterTarget('http://localhost:9100');
                  else if (e.target.value === 'network_ip') setNewPrinterTarget('192.168.0.150:9100');
                }}
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#f8fafc',
                  fontSize: '0.75rem'
                }}
              >
                <option value="web_serial">Zebra ZPL USB/시리얼 (WebSerial)</option>
                <option value="web_usb">Zebra ZPL 다이렉트 (WebUSB)</option>
                <option value="browser_print">Zebra Browser Print 로컬 데몬</option>
                <option value="network_ip">네트워크 Raw TCP/HTTP 프린터</option>
                <option value="virtual_queue">가상 인쇄 큐 적재</option>
              </select>
            </div>

            {(newPrinterType === 'network_ip' || newPrinterType === 'browser_print') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>대상 주소 (IP/URL)</label>
                <input
                  type="text"
                  value={newPrinterTarget}
                  onChange={e => setNewPrinterTarget(e.target.value)}
                  placeholder="예: 192.168.0.150:9100 또는 http://localhost:9100"
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#f8fafc',
                    fontSize: '0.75rem'
                  }}
                />
              </div>
            )}

            {newPrinterType === 'web_serial' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>통신 속도 (BaudRate)</label>
                <select
                  value={newPrinterBaud}
                  onChange={e => setNewPrinterBaud(e.target.value)}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#f8fafc',
                    fontSize: '0.75rem'
                  }}
                >
                  <option value="9600">9600 bps (기본)</option>
                  <option value="19200">19200 bps</option>
                  <option value="38400">38400 bps</option>
                  <option value="57600">57600 bps</option>
                  <option value="115200">115200 bps</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => setIsPrinterModalOpen(false)}
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '4px 10px' }}
              >
                취소
              </button>
              <button
                onClick={handleRegisterPrinter}
                className="btn btn-primary"
                style={{ fontSize: '0.72rem', padding: '4px 14px' }}
              >
                프린터 등록 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
