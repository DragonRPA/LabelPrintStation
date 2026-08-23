import React, { useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, RefreshCw, X, Download, Loader2, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveScansToDbBatch, getDbClient } from '../utils/dbClient';
import { parseAndValidateExcel } from '../utils/excelParserEngine';

export default function DataImportModal({ isOpen, onClose, onImportSuccess, onError }) {
  const [importMode, setImportMode] = useState('replace'); // 'replace' vs 'append'
  const [parsedRows, setParsedRows] = useState([]);
  const [fileName, setFileName] = useState('');
  
  // Progress State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressInfo, setProgressInfo] = useState({ percent: 0, message: '' });
  
  // Completion Result State
  const [completeResult, setCompleteResult] = useState(null);

  if (!isOpen) return null;

  // Reset modal state
  const handleClose = () => {
    if (isProcessing) return;
    setParsedRows([]);
    setFileName('');
    setIsProcessing(false);
    setProgressInfo({ percent: 0, message: '' });
    setCompleteResult(null);
    onClose();
  };

  // Handle File Selected (.xlsx, .csv)
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setCompleteResult(null);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        // ★ 컬럼 위치 무관 엑셀 파서 & 선행 헤더 검증 엔진 실행
        const result = parseAndValidateExcel(bstr, ['asset_no']);

        if (!result.isValid) {
          onError(result.error || '엑셀 파일 검증 실패');
          setParsedRows([]);
          return;
        }

        const normalized = result.rows.map((row, idx) => ({
          id: `import_${idx}_${Date.now()}`,
          key_value: row.asset_no,
          asset_no: row.asset_no,
          category_major: row.category_major || '',
          product_name: row.product_name || '',
          model_name: row.model_name || '',
          serial_no: row.serial_no || '',
          asset_status: row.asset_status || '',
          earning_ratio: row.earning_ratio !== undefined && row.earning_ratio !== '' ? parseFloat(row.earning_ratio) : 0,
          shelf_no: row.shelf_no || '',
          asset_option: row.asset_option || '',
          calibration_date: row.calibration_date || '',
          mac_wlan: row.mac_wlan || '',
          mac_lan: row.mac_lan || '',
          imei: row.imei || '',
          components: row.components || '',
          remark: row.remark || '',
          status: 'COMPLETED',
          created_at: new Date().toISOString()
        }));

        setParsedRows(normalized);
      } catch (err) {
        console.error('File parse error:', err);
        onError(`파일 파싱 실패: ${err.message}`);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Download Sample Template (.xlsx) - 표준 자산/RPA 양식
  const downloadSampleTemplate = () => {
    const templateData = [
      {
        '자산번호': 'TEST0001',
        '제품명': '갤럭시 S24',
        '모델명': 'SM-S921N',
        '제조번호(시리얼)': 'R5KL60F0CZW',
        '선반번호': 'A-01',
        '자산상태': '정상',
        '옵션': '기본',
        '교정일자': '2026-08-01',
        'MAC wlan': '4C:EB:B0:B5:7A:51',
        'MAC lan': '00:1A:2B:3C:4D:5E',
        '구성요소': 'SSD 512GB, RAM 16GB',
        '비고': 'RPA 입고'
      },
      {
        '자산번호': 'TEST0002',
        '제품명': '갤럭시 S24',
        '모델명': 'SM-S921N',
        '제조번호(시리얼)': 'R5KL60F0C6F',
        '선반번호': 'A-02',
        '자산상태': '정상',
        '옵션': '기본',
        '교정일자': '2026-08-01',
        'MAC wlan': '4C:EB:B0:B5:7A:1D',
        'MAC lan': '00:1A:2B:3C:4D:5F',
        '구성요소': 'SSD 256GB, RAM 8GB',
        '비고': 'RPA 입고'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '자산목록');
    XLSX.writeFile(workbook, '자산목록_RPA양식.xlsx');
  };

  // Execute Batch Import with Progress Bar
  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) {
      onError('가져올 데이터가 없습니다. 먼저 엑셀 또는 CSV 파일을 선택해주세요.');
      return;
    }

    if (importMode === 'replace') {
      if (!confirm(`[경고] 기존 데이터를 전체 삭제하고 파일의 ${parsedRows.length}건으로 새로 입력(덮어쓰기)하시겠습니까?`)) {
        return;
      }
    }

    setIsProcessing(true);
    setProgressInfo({ percent: 5, message: '데이터 일괄 가공 및 저장 준비 중...' });

    const startTime = Date.now();
    try {
      // Execute chunked batch save with progress updates
      const results = await saveScansToDbBatch(
        parsedRows,
        (progress) => {
          setProgressInfo(progress);
        },
        importMode
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const isDbConnected = Boolean(getDbClient());

      // Show Completion Result Screen
      setCompleteResult({
        count: parsedRows.length,
        mode: importMode,
        elapsed,
        isDbConnected
      });

      // Reload dashboard items
      await onImportSuccess();
    } catch (err) {
      console.error('Import Error:', err);
      onError(err.message || '데이터 입력 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '800px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
            <Upload size={22} />
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>양식 데이터 일괄 입력 & 전체 덮어쓰기</h3>
          </div>
          <button className="btn btn-outline" style={{ padding: '4px 8px' }} onClick={handleClose} disabled={isProcessing}>
            <X size={18} />
          </button>
        </div>

        {/* 1. Completion Success Screen */}
        {completeResult ? (
          <div style={{
            backgroundColor: '#0f172a',
            border: '1px solid #10b981',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px'
          }}>
            <CheckCircle2 size={48} style={{ color: '#10b981' }} />
            <div>
              <h4 style={{ margin: 0, fontSize: '1.2rem', color: '#6ee7b7', fontWeight: 800 }}>
                총 {completeResult.count}건 데이터 {completeResult.mode === 'replace' ? '전체 덮어쓰기' : '추가'} 성공!
              </h4>
              <p style={{ margin: '8px 0 0 0', fontSize: '0.88rem', color: '#94a3b8' }}>
                {completeResult.isDbConnected
                  ? `DB에 정상 반영되었습니다. (소요 시간: ${completeResult.elapsed}초)`
                  : `로컬 대시보드에 정상 반영되었습니다. (소요 시간: ${completeResult.elapsed}초)`}
              </p>
            </div>

            <button className="btn btn-success" style={{ marginTop: '8px', padding: '10px 24px' }} onClick={handleClose}>
              완료 및 대시보드 확인
            </button>
          </div>
        ) : (
          <>
            {/* 2. Controls & Mode Selection */}
            <div style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', cursor: 'pointer', color: importMode === 'replace' ? '#f43f5e' : '#f8fafc' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      disabled={isProcessing}
                    />
                    <strong style={{ color: '#f43f5e' }}>[초기화 및 덮어쓰기]</strong> 기존 DB 삭제 후 전체 새로 입력
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      disabled={isProcessing}
                    />
                    <strong>[기존 데이터 유지]</strong> 누적 추가하기
                  </label>
                </div>

                <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={downloadSampleTemplate} disabled={isProcessing}>
                  <Download size={14} /> 양식 템플릿 (.xlsx) 받기
                </button>
              </div>

              {/* File Input */}
              <div className="form-group">
                <label className="form-label">엑셀 또는 CSV 파일 선택 (.xlsx, .csv)</label>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="form-input"
                  onChange={handleFileUpload}
                  disabled={isProcessing}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* 3. Real-Time Processing Progress Bar */}
            {isProcessing && (
              <div style={{
                backgroundColor: '#0f172a',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #38bdf8',
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#38bdf8', fontWeight: 700 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={16} className="spin" /> {progressInfo.message || '처리 진행 중...'}
                  </span>
                  <span>{progressInfo.percent}%</span>
                </div>

                {/* Animated Progress Bar */}
                <div style={{
                  height: '10px',
                  backgroundColor: '#1e293b',
                  borderRadius: '5px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progressInfo.percent}%`,
                    backgroundColor: '#38bdf8',
                    borderRadius: '5px',
                    transition: 'width 0.2s ease'
                  }} />
                </div>
              </div>
            )}

            {/* 4. Parsed Preview Table */}
            {parsedRows.length > 0 && !isProcessing && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    파일 ({fileName}) ➔ 파싱된 총 <strong style={{ color: '#38bdf8' }}>{parsedRows.length}건</strong> 데이터 미리보기
                  </span>
                </div>

                <div style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  backgroundColor: '#0f172a',
                  borderRadius: '6px',
                  border: '1px solid #334155'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#1e293b', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                        <th style={{ padding: '8px 12px' }} className="nowrap-cell">자산번호</th>
                        <th style={{ padding: '8px 12px' }} className="nowrap-cell">IMEI</th>
                        <th style={{ padding: '8px 12px' }} className="nowrap-cell">MAC Address</th>
                        <th style={{ padding: '8px 12px' }} className="nowrap-cell">시리얼</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 100).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '6px 12px', color: '#38bdf8', fontWeight: 600 }} className="nowrap-cell">{row.asset_no}</td>
                          <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontWeight: 700 }} className="nowrap-cell">{row.imei}</td>
                          <td style={{ padding: '6px 12px', color: '#fda4af' }} className="nowrap-cell">{row.mac_address || '-'}</td>
                          <td style={{ padding: '6px 12px', color: '#d8b4fe' }} className="nowrap-cell">{row.serial_no || '-'}</td>
                        </tr>
                      ))}
                      {parsedRows.length > 100 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '8px', textAlign: 'center', color: '#64748b', fontSize: '0.75rem' }}>
                            ...외 {parsedRows.length - 100}건 추가 항목 존재
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-outline" onClick={handleClose} disabled={isProcessing}>
                취소
              </button>
              <button
                className={`btn ${importMode === 'replace' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleExecuteImport}
                disabled={parsedRows.length === 0 || isProcessing}
              >
                {isProcessing ? 'DB 처리 중...' : importMode === 'replace' ? `기존 DB 삭제 후 ${parsedRows.length}건 전체 덮어쓰기` : `${parsedRows.length}건 DB에 추가하기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
