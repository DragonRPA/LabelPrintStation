import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FolderOpen,
  Upload,
  Download,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
  Printer,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  X,
  Database
} from 'lucide-react';
import { getDbClient } from '../utils/dbClient';
import {
  fetchTableSchema,
  getTableSchema,
  TEMP_ASSET_SCHEMA_DEF,
  getMainFieldName,
  resolveFieldId
} from '../utils/dynamicSchema';
import { getAllPresets, generateDynamicZpl } from '../utils/labelTemplate';
import { getRegisteredPrinters, getActivePrinterId, sendZplToPrinter } from '../utils/printerManager';

const LOCAL_KEY_TEMP_ASSETS = 'IMAGE_SCAN_TEMP_ASSET_ITEMS';

export default function TempDataTab({ onError, onOpenPrintModal }) {
  const [schema, setSchema] = useState(() => getTableSchema('temp_asset') || TEMP_ASSET_SCHEMA_DEF);
  const [items, setItems] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const localData = localStorage.getItem(LOCAL_KEY_TEMP_ASSETS);
        if (localData) {
          const parsed = JSON.parse(localData);
          return Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {}
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [statusMessage, setStatusMessage] = useState(null);

  // ⭐️ 엑셀 스타일 셀 범위 선택(Cell Range Selection) 상태 머신
  const [cellSelection, setCellSelection] = useState(null); // { startRow, startCol, endRow, endCol }
  const [isSelectingCells, setIsSelectingCells] = useState(false);
  const [copyToast, setCopyToast] = useState('');

  // 모달 상태 (단건 등록 / 수정)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isNewRecord, setIsNewRecord] = useState(false);

  const fileInputRef = useRef(null);

  // 전역 마우스 업 감지 (드래그 선택 종료)
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsSelectingCells(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // 1. ⭐️ 비동기 실시간 스키마 로드 (Supabase schema_definitions 1:1 동기화)
  const loadSchema = async () => {
    try {
      const currentSchema = await fetchTableSchema('temp_asset');
      if (currentSchema && Array.isArray(currentSchema.fields)) {
        setSchema(currentSchema);
      }
    } catch (e) {
      console.warn('temp_asset 스키마 로드 예외:', e);
    }
  };

  // ⭐️ Supabase DB 물리 컬럼 정의 (그 외 커스텀 필드는 data JSONB로 100% 저장)
  const KNOWN_COLUMNS = useMemo(() => new Set([
    'key_value', 'asset_no', 'product_name', 'model_name', 'serial_no',
    'asset_status', 'earning_ratio', 'shelf_no', 'asset_option',
    'calibration_date', 'mac_wlan', 'mac_lan', 'imei', 'components', 'remark', 'data'
  ]), []);

  const normalizeRowForDb = (rawItem, currentKeyField = 'imei') => {
    const dbRow = {
      data: { ...rawItem }
    };
    Object.entries(rawItem).forEach(([k, v]) => {
      if (k === 'id') {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
          dbRow.id = v;
        }
        return;
      }
      if (k === 'mac_address') {
        dbRow.mac_wlan = String(v || '');
      }
      if (KNOWN_COLUMNS.has(k)) {
        dbRow[k] = v;
      }
    });

    dbRow.key_value = String(rawItem[currentKeyField] || rawItem.imei || rawItem.asset_no || '');
    if (!dbRow.asset_no && rawItem.asset_no) dbRow.asset_no = String(rawItem.asset_no);
    if (!dbRow.imei && rawItem.imei) dbRow.imei = String(rawItem.imei);
    return dbRow;
  };

  // 2. ⭐️ 데이터 로드 (Supabase 실제 DB 최우선 1:1 전수 페칭 & JSONB 자동 매핑)
  const loadData = async (isManualQuery = false) => {
    setIsLoading(true);
    setStatusMessage(null);
    setCellSelection(null);
    try {
      const client = getDbClient();
      if (client) {
        const { data, error } = await client
          .from('temp_asset')
          .select('*')
          .range(0, 49999);

        if (error) {
          console.error('temp_asset 페칭 오류:', error);
          setStatusMessage({ type: 'error', text: `DB 조회 실패: ${error.message}` });
          return;
        }

        const formatted = (data || []).map(r => ({
          ...r,
          ...(r.data || {}),
          id: r.id,
          asset_no: r.asset_no || r.data?.asset_no || '',
          imei: r.imei || r.data?.imei || r.key_value || '',
          serial_no: r.serial_no || r.data?.serial_no || '',
          mac_address: r.mac_wlan || r.data?.mac_address || r.data?.mac_wlan || '',
          mac_wlan: r.mac_wlan || r.data?.mac_wlan || '',
          product_name: r.product_name || r.data?.product_name || '',
          model_name: r.model_name || r.data?.model_name || ''
        }));
        setItems(formatted);
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(LOCAL_KEY_TEMP_ASSETS, JSON.stringify(formatted));
        }
        setIsLoading(false);
        if (isManualQuery) {
          setStatusMessage({ type: 'success', text: `DB에서 총 ${formatted.length}건의 데이터를 성공적으로 조회하였습니다.` });
          setTimeout(() => setStatusMessage(null), 3000);
        }
        return;
      }
      // 오프라인/DB 미연결 시에만 로컬 캐시 폴백
      const localData = localStorage.getItem(LOCAL_KEY_TEMP_ASSETS);
      if (localData) {
        try {
          const parsed = JSON.parse(localData);
          setItems(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          setItems([]);
        }
      } else {
        setItems([]);
      }
    } catch (err) {
      console.warn('temp_asset 데이터 로드 예외:', err);
      setStatusMessage({ type: 'error', text: `데이터 조회 오류: ${err.message}` });
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSchema();
    // ⭐️ 메뉴 진입 시 자동 DB 조회 차단: 사용자가 [DB 조회] 버튼 클릭 시에만 수동 조회 실행
  }, []);

  const fields = useMemo(() => schema.fields || [], [schema]);
  const keyField = schema.key_field || 'asset_no';

  // ⭐️ 셀 마우스 다운 (순수 엑셀 스타일 영역 선택 시작 - 기본 텍스트 드래그 방지)
  const handleCellMouseDown = (rowIdx, colIdx, e) => {
    if (e.button !== 0) return;
    if (e.preventDefault) e.preventDefault();
    setCellSelection({
      startRow: rowIdx,
      startCol: colIdx,
      endRow: rowIdx,
      endCol: colIdx
    });
    setIsSelectingCells(true);
  };

  // ⭐️ 셀 마우스 엔터 (영역 드래그 확장)
  const handleCellMouseEnter = (rowIdx, colIdx) => {
    if (!isSelectingCells) return;
    setCellSelection(prev => (prev ? { ...prev, endRow: rowIdx, endCol: colIdx } : null));
  };

  // ⭐️ 셀이 선택 범위 내에 있는지 판별
  const isCellInSelection = (rowIdx, colIdx) => {
    if (!cellSelection) return false;
    const minRow = Math.min(cellSelection.startRow, cellSelection.endRow);
    const maxRow = Math.max(cellSelection.startRow, cellSelection.endRow);
    const minCol = Math.min(cellSelection.startCol, cellSelection.endCol);
    const maxCol = Math.max(cellSelection.startCol, cellSelection.endCol);
    return rowIdx >= minRow && rowIdx <= maxRow && colIdx >= minCol && colIdx <= maxCol;
  };

  // 3. 필터링된 데이터
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(item => {
      return Object.values(item).some(val =>
        String(val || '').toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  // ⭐️ [복사 엔진] Ctrl + C 키보드 복사 이벤트 리스너
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 입력창에 포커스가 있을 때는 기본 텍스트 복사 동작 유지
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (!cellSelection) return;

        const minRow = Math.min(cellSelection.startRow, cellSelection.endRow);
        const maxRow = Math.max(cellSelection.startRow, cellSelection.endRow);
        const minCol = Math.min(cellSelection.startCol, cellSelection.endCol);
        const maxCol = Math.max(cellSelection.startCol, cellSelection.endCol);

        const selectedRows = filteredItems.slice(minRow, maxRow + 1);
        if (selectedRows.length === 0) return;

        const lines = selectedRows.map((row) => {
          const rowValues = [];
          for (let c = minCol; c <= maxCol; c++) {
            const field = fields[c];
            if (field) {
              const val = row[field.id] ?? row[field.name] ?? '';
              rowValues.push(val);
            }
          }
          return rowValues.join('\t');
        });

        const copyText = lines.join('\r\n');
        if (copyText) {
          e.preventDefault();
          const doToast = () => {
            const cellCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
            setCopyToast(`${cellCount}개 셀 복사 완료 (${minRow + 1}~${maxRow + 1}행)`);
            setTimeout(() => setCopyToast(''), 2500);
          };

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(copyText)
              .then(doToast)
              .catch(() => {
                // 폴백 복사
                fallbackCopy(copyText);
                doToast();
              });
          } else {
            fallbackCopy(copyText);
            doToast();
          }
        }
      }
    };

    // 클립보드 폴백 함수
    const fallbackCopy = (text) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } catch (err) {}
      document.body.removeChild(ta);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cellSelection, filteredItems, fields]);

  // 4. 단건 저장 (추가 / 수정)
  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!editingItem[keyField] || !String(editingItem[keyField]).trim()) {
      alert(`기본 식별자(${schema.key_field_name || keyField})는 필수 입력 항목입니다.`);
      return;
    }

    const payload = {
      ...editingItem,
      updated_at: new Date().toISOString()
    };

    // ⭐️ Supabase 온라인 DB 동기화 (전사 표준 헌장: 무음 실패 방지)
    try {
      const client = getDbClient();
      if (client) {
        const dbRow = normalizeRowForDb(payload, keyField);
        const { data: savedData, error: saveErr } = await client.from('temp_asset').upsert(dbRow).select();
        if (saveErr) throw saveErr;
        if (savedData && savedData[0]) {
          payload.id = savedData[0].id;
        }
      }
    } catch (err) {
      console.error('Supabase 단건 저장 실패:', err);
      alert(`DB 저장 실패: ${err.message}`);
      return;
    }

    let updatedList = [];
    if (isNewRecord) {
      payload.created_at = new Date().toISOString();
      updatedList = [payload, ...items];
    } else {
      updatedList = items.map(it => (it.id === payload.id || it[keyField] === payload[keyField]) ? payload : it);
    }

    setItems(updatedList);
    localStorage.setItem(LOCAL_KEY_TEMP_ASSETS, JSON.stringify(updatedList));

    setIsEditModalOpen(false);
    setEditingItem(null);
    setStatusMessage({ type: 'success', text: `[${payload[keyField]}] 데이터가 DB에 성공적으로 저장되었습니다.` });
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // 5. 단건 삭제
  const handleDeleteItem = async (item, e) => {
    e.stopPropagation();
    if (!window.confirm(`'${item[keyField]}' 데이터를 삭제하시겠습니까?`)) return;

    const updated = items.filter(it => it.id !== item.id && it[keyField] !== item[keyField]);
    setItems(updated);
    localStorage.setItem(LOCAL_KEY_TEMP_ASSETS, JSON.stringify(updated));

    try {
      const client = getDbClient();
      if (client) {
        if (item.id && /^[0-9a-f-]{36}$/i.test(item.id)) {
          await client.from('temp_asset').delete().eq('id', item.id);
        } else if (item[keyField]) {
          await client.from('temp_asset').delete().or(`key_value.eq.${item[keyField]},asset_no.eq.${item[keyField]},imei.eq.${item[keyField]}`);
        }
      }
    } catch (err) {
      console.warn('Supabase 삭제 실패:', err);
    }
  };

  // 6. 전체 비우기 (초기화)
  const handleClearAll = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`임시 자산 데이터 전체(${items.length}건)를 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    setSelectedIds(new Set());
    localStorage.removeItem(LOCAL_KEY_TEMP_ASSETS);

    try {
      const client = getDbClient();
      if (client) {
        await client.from('temp_asset').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }
    } catch (err) {
      console.warn('Supabase 전체 삭제 실패:', err);
    }

    await loadData();
    setStatusMessage({ type: 'success', text: '임시 데이터가 모두 초기화되었습니다.' });
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // 7. 엑셀 양식 다운로드 (.xlsx) - 스키마 정의 필드명 중 첫 번째 주된 헤더로 순수 템플릿 생성
  const handleDownloadExcelTemplate = () => {
    const mainHeaders = fields.map(f => getMainFieldName(f.name));
    const worksheet = XLSX.utils.json_to_sheet([], { header: mainHeaders });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '임시데이터_양식');
    worksheet['!cols'] = fields.map(() => ({ wch: 18 }));
    XLSX.writeFile(workbook, `임시데이터_업로드양식_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // 8. ⭐️ 엑셀 대량 업로드 (Supabase 실제 DB 100% 실시간 일괄 저장 및 정밀 예외처리)
  const handleExcelUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. 파일 확장자 검사
    const fileName = file.name || '';
    const fileExt = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(fileExt)) {
      const errMsg = `지원하지 않는 파일 형식입니다 (${fileExt}).\n.xlsx, .xls, .csv 형식의 파일만 업로드할 수 있습니다.`;
      setStatusMessage({ type: 'error', text: errMsg });
      alert(`[업로드 실패] ${errMsg}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsLoading(true);
    setStatusMessage({ type: 'success', text: '엑셀 파일을 분석하고 데이터베이스에 동기화하는 중...' });

    const reader = new FileReader();

    reader.onerror = () => {
      setIsLoading(false);
      const errMsg = '파일을 읽는 중 I/O 오류가 발생했습니다. 파일이 손상되었거나 열려 있는지 확인하세요.';
      setStatusMessage({ type: 'error', text: errMsg });
      alert(`[파일 읽기 실패]\n\n${errMsg}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        let wb;
        try {
          wb = XLSX.read(bstr, { type: 'binary' });
        } catch (parseErr) {
          throw new Error(`엑셀 파일 구조 파싱 실패: 손상되었거나 암호화된 파일입니다 (${parseErr.message})`);
        }

        const wsName = wb.SheetNames[0];
        if (!wsName) {
          throw new Error('엑셀 파일 내에 유효한 워크시트가 존재하지 않습니다.');
        }

        const ws = wb.Sheets[wsName];
        const rawJson = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          throw new Error('선택한 엑셀 시트에 데이터 행이 존재하지 않습니다. 헤더와 데이터를 확인하세요.');
        }

        // 2. 엑셀 열 이름 매핑 및 행 정규화
        const parsedRows = [];
        for (let idx = 0; idx < rawJson.length; idx++) {
          const row = rawJson[idx];
          const item = {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          Object.entries(row).forEach(([colName, val]) => {
            const trimmedCol = String(colName).trim();
            const matchedFieldId = resolveFieldId(trimmedCol, fields);
            item[matchedFieldId] = String(val).trim();
          });

          // 키 인덱스 값 유효성 사전 검증
          const rowKeyVal = item[keyField] || item.key_value || item.imei || item.asset_no;
          if (!rowKeyVal && fields.some(f => f.id === keyField && (f.isRequired || f.isKey))) {
            const keyLabel = getMainFieldName(schema.key_field_name) || keyField;
            throw new Error(`엑셀 ${idx + 2}번째 행에서 필수 키 항목인 [${keyLabel}] 값이 누락되었습니다.`);
          }

          parsedRows.push(item);
        }

        // ⭐️ 3. 기존 DB temp_asset 테이블의 모든 기존 데이터 완전 삭제 (최종 데이터로 교체 적재)
        const client = getDbClient();
        if (!client) {
          throw new Error('데이터베이스 클라이언트 연결 객체를 생성할 수 없습니다. DB 설정을 확인하세요.');
        }

        const { error: delErr } = await client
          .from('temp_asset')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (delErr) {
          console.error('기존 DB 삭제 오류:', delErr);
          const detail = delErr.message;
          throw new Error(`기존 데이터 초기화 실패: ${detail}`);
        }

        // ⭐️ 4. 이번에 업로드된 최종 엑셀 행들만 초고속 벌크 INSERT (전사 표준 1,000건 단위)
        const dbRows = parsedRows.map(row => normalizeRowForDb(row, keyField));
        const chunkSize = 1000;
        for (let i = 0; i < dbRows.length; i += chunkSize) {
          const chunk = dbRows.slice(i, i + chunkSize);
          const chunkIndex = Math.floor(i / chunkSize) + 1;
          const totalChunks = Math.ceil(dbRows.length / chunkSize);

          const { error: chunkErr } = await client.from('temp_asset').insert(chunk);
          if (chunkErr) {
            console.error('DB 벌크 주입 오류:', chunkErr);
            let detail = chunkErr.message;
            if (chunkErr.code === '23505') detail = `중복된 고유 키(PK)가 존재합니다 (${chunkErr.details || chunkErr.message})`;
            else if (chunkErr.code === '42703') detail = `DB 테이블에 존재하지 않는 컬럼이 포함되었습니다 (${chunkErr.message})`;
            else if (chunkErr.code === '22001') detail = `데이터 길이가 DB 컬럼 허용 길이를 초과했습니다 (${chunkErr.message})`;

            throw new Error(`DB 벌크 저장 실패 (청크 ${chunkIndex}/${totalChunks}, 행 ${i + 1}~${i + chunk.length}): ${detail}`);
          }
        }

        // ⭐️ 5. DB 저장 완료 후 최신 DB 데이터 전수 재조회 (DB 건수와 UI 건수 100% 1:1 일치)
        await loadData();

        setStatusMessage({
          type: 'success',
          text: `엑셀에서 ${parsedRows.length}건의 데이터를 DB에 성공적으로 업로드 및 반영하였습니다!`
        });
        setTimeout(() => setStatusMessage(null), 4000);
      } catch (err) {
        console.error('엑셀 업로드 종합 실패:', err);
        const failMessage = `엑셀 업로드 실패: ${err.message}`;
        setStatusMessage({ type: 'error', text: failMessage });
        alert(`[엑셀 업로드 실패 원인 안내]\n\n${err.message}`);
        if (onError) onError(failMessage);
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  // 9. 선택 항목 체크박스 토글
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      const allIds = new Set(filteredItems.map(it => it.id || it[keyField]));
      setSelectedIds(allIds);
    }
  };

  const handleToggleSelectRow = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 10. 선택 항목 일괄 인쇄
  const handlePrintSelected = async () => {
    const targetItems = items.filter(it => selectedIds.has(it.id || it[keyField]));
    if (targetItems.length === 0) {
      alert('인쇄할 항목을 1개 이상 선택하세요.');
      return;
    }

    const allPresets = getAllPresets();
    const tempPreset = allPresets.find(p => p.targetTable === 'temp_asset') || allPresets[0];

    const registered = getRegisteredPrinters();
    const targetId = tempPreset?.targetPrinterId || getActivePrinterId();
    const targetPrinter = registered.find(p => p.id === targetId) || registered[0] || { type: 'agent_auto', name: '기본 라벨 프린터' };

    try {
      for (const item of targetItems) {
        const zpl = generateDynamicZpl(item, tempPreset);
        await sendZplToPrinter(zpl, targetPrinter);
      }
      alert(`[임시 데이터 ${targetItems.length}건 출력 완료] ${targetPrinter.name}으로 전송되었습니다.`);
    } catch (err) {
      if (onOpenPrintModal) {
        onOpenPrintModal(targetItems);
      } else {
        alert(`인쇄 오류: ${err.message}`);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', color: '#f8fafc' }}>
      {/* Top Control Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '8px 12px',
        flexWrap: 'wrap',
        gap: '6px'
      }}>
        {/* Left Title & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FolderOpen size={16} style={{ color: '#38bdf8' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
            임시 데이터 관리 (temp_asset)
          </span>
          <span style={{
            fontSize: '0.68rem',
            backgroundColor: '#0f172a',
            color: '#38bdf8',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid #334155',
            fontWeight: 700
          }}>
            총 {items.length}건
          </span>
        </div>

        {/* Right Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '8px', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="데이터 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '4px 8px 4px 26px',
                color: '#f8fafc',
                fontSize: '0.72rem',
                width: '130px'
              }}
            />
          </div>

          <button
            onClick={handleDownloadExcelTemplate}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: '#10b981', color: '#34d399' }}
            title="현재 스키마에 맞는 엑셀 업로드 양식 다운로드"
          >
            <Download size={12} /> 엑셀 양식 다운
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleExcelUpload}
            accept=".xlsx, .xls, .csv"
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: '#38bdf8', color: '#38bdf8' }}
            title="엑셀 파일 대량 업로드 및 데이터 주입"
          >
            <Upload size={12} /> 엑셀 대량 업로드
          </button>

          <button
            onClick={() => {
              const newItem = { id: `temp_${Date.now()}` };
              fields.forEach(f => { newItem[f.id] = ''; });
              newItem[keyField] = `TEMP-${Date.now().toString().slice(-4)}`;
              setEditingItem(newItem);
              setIsNewRecord(true);
              setIsEditModalOpen(true);
            }}
            className="btn btn-primary"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
          >
            <Plus size={12} /> 신규 등록
          </button>

          {selectedIds.size > 0 && (
            <button
              onClick={handlePrintSelected}
              className="btn btn-primary"
              style={{ fontSize: '0.72rem', padding: '4px 12px', backgroundColor: '#0284c7' }}
            >
              <Printer size={12} /> 선택 출력 ({selectedIds.size})
            </button>
          )}

          <button
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="btn btn-primary"
            style={{
              fontSize: '0.72rem',
              padding: '4px 10px',
              backgroundColor: '#0284c7',
              borderColor: '#38bdf8',
              color: '#ffffff',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="실제 DB에서 최신 데이터 전수 조회"
          >
            <Search size={12} className={isLoading ? 'animate-spin' : ''} /> DB 조회
          </button>

          <button
            onClick={handleClearAll}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 8px', borderColor: '#ef444444', color: '#f87171' }}
            title="임시 데이터 전체 삭제"
          >
            <Trash2 size={12} /> 전체 비우기
          </button>
        </div>
      </div>

      {/* Status Notice Toast */}
      {statusMessage && (
        <div style={{
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '0.75rem',
          backgroundColor: statusMessage.type === 'success' ? '#052e16' : '#450a0a',
          color: statusMessage.type === 'success' ? '#4ade80' : '#f87171',
          border: `1px solid ${statusMessage.type === 'success' ? '#10b981' : '#ef4444'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <CheckCircle size={14} /> {statusMessage.text}
        </div>
      )}

      {/* Main Data Table */}
      <div style={{
        backgroundColor: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '8px',
        overflowX: 'auto',
        maxHeight: 'calc(100vh - 220px)',
        position: 'relative'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e293b', color: '#94a3b8', borderBottom: '1px solid #334155', position: 'sticky', top: 0, zIndex: 10 }}>
              <th style={{ padding: '6px 8px', width: '32px', textAlign: 'center' }}>
                <button
                  onClick={handleToggleSelectAll}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? (
                    <CheckSquare size={13} style={{ color: '#38bdf8' }} />
                  ) : (
                    <Square size={13} />
                  )}
                </button>
              </th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: '60px', whiteSpace: 'nowrap' }}>관리</th>
              {fields.map(f => (
                <th key={f.id} style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }} title={f.name}>
                  {getMainFieldName(f.name)}
                  {f.isKey && <span style={{ color: '#facc15', marginLeft: '3px' }}>*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={fields.length + 2} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  데이터를 불러오는 중...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 2} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  등록된 임시 데이터가 없습니다. [엑셀 대량 업로드] 또는 [신규 등록]을 이용해 데이터를 채워주세요.
                </td>
              </tr>
            ) : (
              filteredItems.map((row, rowIdx) => {
                const isSelected = selectedIds.has(row.id || row[keyField]);
                return (
                  <tr
                    key={row.id || row[keyField] || `row_${rowIdx}`}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: isSelected 
                        ? 'rgba(2, 132, 199, 0.15)' 
                        : (rowIdx % 2 === 0 ? '#0f172a' : '#141e30'),
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      transition: 'background-color 0.15s'
                    }}
                  >
                    {/* 1. 체크박스 (명시적 선택) */}
                    <td style={{ padding: '6px 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleToggleSelectRow(row.id || row[keyField], e)}
                        style={{ background: 'none', border: 'none', color: isSelected ? '#38bdf8' : '#64748b', cursor: 'pointer' }}
                        title="선택"
                      >
                        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                      </button>
                    </td>

                    {/* 2. 관리 (명시적 편집/삭제 버튼) */}
                    <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem({ ...row });
                            setIsNewRecord(false);
                            setIsEditModalOpen(true);
                          }}
                          className="btn btn-outline"
                          style={{ padding: '2px 5px', fontSize: '0.65rem', borderColor: '#38bdf8', color: '#38bdf8' }}
                          title="수정"
                        >
                          <Edit2 size={10} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteItem(row, e)}
                          className="btn btn-outline"
                          style={{ padding: '2px 5px', fontSize: '0.65rem', borderColor: '#ef444444', color: '#f87171' }}
                          title="삭제"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>

                    {/* 3. 동적 데이터 셀 (순수 엑셀 드래그 영역 선택 & Ctrl+C 복사) */}
                    {fields.map((f, colIdx) => {
                      const cellVal = row[f.id] ?? row[f.name] ?? '';
                      const inSelection = isCellInSelection(rowIdx, colIdx);
                      return (
                        <td
                          key={f.id}
                          onMouseDown={(e) => handleCellMouseDown(rowIdx, colIdx, e)}
                          onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                          style={{
                            padding: '6px 8px',
                            color: f.isKey ? '#facc15' : '#cbd5e1',
                            fontWeight: f.isKey ? 700 : 400,
                            fontFamily: f.isKey ? 'monospace' : 'inherit',
                            whiteSpace: 'nowrap',
                            cursor: 'cell',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            backgroundColor: inSelection ? 'rgba(2, 132, 199, 0.35)' : 'transparent',
                            outline: inSelection ? '1px solid #38bdf8' : 'none'
                          }}
                        >
                          {cellVal || '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* ⭐️ 복사 완료 플로팅 토스트 */}
        {copyToast && (
          <div style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            fontSize: '0.78rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 9999,
            animation: 'fadeIn 0.2s ease-in-out'
          }}>
            <CheckCircle size={14} />
            {copyToast}
          </div>
        )}
      </div>

      {/* [모달] 데이터 단건 추가 / 수정 모달 */}
      {isEditModalOpen && editingItem && (
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
            padding: '16px',
            width: '460px',
            maxWidth: '95vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>
                {isNewRecord ? '임시 데이터 신규 등록' : '임시 데이터 수정'}
              </span>
              <button
                onClick={() => setIsEditModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: '60vh', paddingRight: '4px' }}>
              {fields.map(f => (
                <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '0.70rem', color: '#cbd5e1', fontWeight: 600 }}>
                    {f.name} {f.isKey && <span style={{ color: '#facc15' }}>(식별키 PK)</span>}
                  </label>
                  <input
                    type="text"
                    required={f.isRequired || f.isKey}
                    value={editingItem[f.id] || ''}
                    onChange={e => setEditingItem(prev => ({ ...prev, [f.id]: e.target.value }))}
                    style={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      padding: '5px 8px',
                      color: f.isKey ? '#facc15' : '#f8fafc',
                      fontSize: '0.75rem'
                    }}
                  />
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="btn btn-outline"
                  style={{ fontSize: '0.72rem', padding: '5px 12px' }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ fontSize: '0.72rem', padding: '5px 16px' }}
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
