import React, { useRef, useEffect, useState } from 'react';
import { Camera, RefreshCw, UploadCloud, CheckCircle2, Play, Square, Plus, Trash2 } from 'lucide-react';
import { getTesseractWorker, preprocessCanvasROI, parseFieldsFromText } from '../utils/ocrWorker';
import { triggerSuccessFeedback } from '../utils/soundFeedback';
import { saveScansToDb } from '../utils/dbClient';

export default function AutoCameraScanner({ onError }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);

  const [isScanning, setIsScanning] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('카메라 대기 중');
  const [ocrStatus, setOcrStatus] = useState('실시간 무버튼 감지 준비됨');
  const [detectedPulse, setDetectedPulse] = useState(false);

  // Accumulated Scanned List (Image 2 columns)
  const [scannedItems, setScannedItems] = useState([]);
  const [lastScannedImei, setLastScannedImei] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Manual Add Form
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualAssetNo, setManualAssetNo] = useState('');
  const [manualImei, setManualImei] = useState('');
  const [manualMac, setManualMac] = useState('');
  const [manualSerial, setManualSerial] = useState('');

  // Start Camera
  const startCamera = async () => {
    try {
      setCameraStatus('카메라 권한 요청 중...');
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsScanning(true);
      setCameraStatus('카메라 연결 완료 (무버튼 감지 중)');
    } catch (err) {
      console.error('Camera Access Error:', err);
      setCameraStatus('카메라 연결 실패');
      onError(`카메라 권한을 얻을 수 없습니다: ${err.message}`);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
    setCameraStatus('카메라 정지됨');
  };

  // Continuous OCR Scan Loop
  useEffect(() => {
    if (!isScanning) return;

    let isProcessing = false;
    let lastScanTime = 0;

    scanTimerRef.current = setInterval(async () => {
      if (isProcessing || !videoRef.current || videoRef.current.readyState !== 4) return;
      const now = Date.now();
      if (now - lastScanTime < 400) return; // 400ms throttle

      isProcessing = true;
      try {
        const video = videoRef.current;
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        if (!vWidth || !vHeight) {
          isProcessing = false;
          return;
        }

        // ROI Box Bounds (Middle 70% width, 30% height)
        const roiWidth = Math.floor(vWidth * 0.75);
        const roiHeight = Math.floor(vHeight * 0.35);
        const roiX = Math.floor((vWidth - roiWidth) / 2);
        const roiY = Math.floor((vHeight - roiHeight) / 2);

        // Preprocess Frame ROI
        const roiCanvas = preprocessCanvasROI(video, { x: roiX, y: roiY, width: roiWidth, height: roiHeight });

        // Tesseract OCR execution
        const worker = await getTesseractWorker();
        const { data: { text } } = await worker.recognize(roiCanvas);

        setOcrStatus(text.trim() ? `감지 텍스트: ${text.slice(0, 30)}...` : 'IMEI 감지 대기 중...');

        const parsed = parseFieldsFromText(text);

        if (parsed && parsed.imei) {
          // Check Cooldown & Duplication
          const exists = scannedItems.some(item => item.imei === parsed.imei);
          if (!exists && parsed.imei !== lastScannedImei) {
            lastScanTime = now;
            setLastScannedImei(parsed.imei);

            // Generate default asset_no if not detected
            const autoAssetNo = parsed.asset_no || `${Date.now().toString().slice(-8)}`;

            const newItem = {
              id: `scanned_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              asset_no: autoAssetNo,
              imei: parsed.imei,
              mac_address: parsed.mac_address || '',
              serial_no: parsed.serial_no || '',
              scanned_at: new Date().toLocaleTimeString('ko-KR'),
              status: 'COMPLETED'
            };

            // Trigger sound & haptic feedback & pulse effect
            triggerSuccessFeedback();
            setDetectedPulse(true);
            setTimeout(() => setDetectedPulse(false), 800);

            setScannedItems(prev => [newItem, ...prev]);
            setOcrStatus(`★ 자동 감지 성공! IMEI: ${parsed.imei}`);
          }
        }
      } catch (err) {
        console.error('OCR Loop Error:', err);
      } finally {
        isProcessing = false;
      }
    }, 350);

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [isScanning, lastScannedImei, scannedItems]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Save Scans to DB
  const handleExportToDb = async () => {
    if (scannedItems.length === 0) {
      onError('내보낼 스캔 데이터가 없습니다.');
      return;
    }

    setIsSaving(true);
    try {
      await saveScansToDb(scannedItems);
      setScannedItems(prev => prev.map(item => ({ ...item, status: 'EXPORTED' })));
      alert(`성공적으로 ${scannedItems.length}건의 데이터가 DB에 저장되었습니다.`);
    } catch (err) {
      console.error('Export Error:', err);
      onError(err.message || 'DB 내보내기 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // Add Manual Item
  const handleAddManualItem = (e) => {
    e.preventDefault();
    if (!manualImei || manualImei.length < 15) {
      onError('올바른 15자리 IMEI 번호를 입력해주세요.');
      return;
    }

    const newItem = {
      id: `manual_${Date.now()}`,
      asset_no: manualAssetNo || `${Date.now().toString().slice(-8)}`,
      imei: manualImei,
      mac_address: manualMac || '',
      serial_no: manualSerial || '',
      scanned_at: new Date().toLocaleTimeString('ko-KR'),
      status: 'COMPLETED'
    };

    setScannedItems(prev => [newItem, ...prev]);
    setManualAssetNo('');
    setManualImei('');
    setManualMac('');
    setManualSerial('');
    setShowManualForm(false);
  };

  const removeItem = (id) => {
    setScannedItems(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Camera Stream Section */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '280px',
        backgroundColor: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        border: `2px solid ${detectedPulse ? '#10b981' : '#334155'}`,
        transition: 'border-color 0.3s ease'
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Central Target Overlay Box (ROI) */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '75%',
          height: '35%',
          border: `2px dashed ${detectedPulse ? '#10b981' : '#38bdf8'}`,
          borderRadius: '8px',
          boxShadow: detectedPulse ? '0 0 20px rgba(16, 185, 129, 0.8)' : '0 0 0 9999px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease'
        }}>
          <span style={{
            fontSize: '0.75rem',
            color: detectedPulse ? '#6ee7b7' : '#e0f2fe',
            fontWeight: 700,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '4px 8px',
            borderRadius: '4px'
          }}>
            {detectedPulse ? '★ IMEI 자동 감지됨!' : 'IMEI / 텍스트 타겟 박스'}
          </span>
        </div>

        {/* Camera Control Overlay */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '12px',
          right: '12px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{
            fontSize: '0.75rem',
            color: '#fff',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            padding: '4px 10px',
            borderRadius: '6px'
          }}>
            {cameraStatus}
          </div>

          <button
            className={`btn ${isScanning ? 'btn-danger' : 'btn-primary'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={isScanning ? stopCamera : startCamera}
          >
            {isScanning ? <Square size={14} /> : <Play size={14} />}
            {isScanning ? '카메라 정지' : '카메라 시작'}
          </button>
        </div>
      </div>

      {/* OCR Status Banner */}
      <div style={{
        backgroundColor: '#1e293b',
        padding: '10px 14px',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: '#94a3b8',
        display: 'flex',
        alignItems: 'center',
        justify: 'space-between',
        border: '1px solid #334155'
      }}>
        <span>{ocrStatus}</span>
        <span style={{ fontWeight: 700, color: '#38bdf8' }}>누적 {scannedItems.length}건</span>
      </div>

      {/* Bottom Controls */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <button
          className="btn btn-outline"
          onClick={() => setShowManualForm(!showManualForm)}
          style={{ fontSize: '0.85rem' }}
        >
          <Plus size={16} />
          {showManualForm ? '접기' : '수동 IMEI 추가'}
        </button>

        <button
          className="btn btn-success"
          onClick={handleExportToDb}
          disabled={isSaving || scannedItems.length === 0}
          style={{ fontSize: '0.85rem' }}
        >
          <UploadCloud size={16} />
          {isSaving ? 'DB 저장 중...' : 'DB에 내보내기'}
        </button>
      </div>

      {/* Manual Input Form */}
      {showManualForm && (
        <form onSubmit={handleAddManualItem} style={{
          backgroundColor: '#1e293b',
          padding: '14px',
          borderRadius: '8px',
          border: '1px solid #334155',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label">자산번호 (관리번호)</label>
              <input
                type="text"
                className="form-input"
                placeholder="11112222"
                value={manualAssetNo}
                onChange={e => setManualAssetNo(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">IMEI (15자리 필수)</label>
              <input
                type="text"
                className="form-input"
                placeholder="351379300225052"
                value={manualImei}
                onChange={e => setManualImei(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">MAC Address</label>
              <input
                type="text"
                className="form-input"
                placeholder="4CEBB0B57A51"
                value={manualMac}
                onChange={e => setManualMac(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">시리얼</label>
              <input
                type="text"
                className="form-input"
                placeholder="R5KL60F0CZW"
                value={manualSerial}
                onChange={e => setManualSerial(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-end' }}>
            목록에 추가
          </button>
        </form>
      )}

      {/* Scanned Items Table (Image 2 Columns) */}
      <div style={{
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #334155',
        overflowX: 'auto'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '10px 12px' }} className="nowrap-cell">자산번호</th>
              <th style={{ padding: '10px 12px' }} className="nowrap-cell">IMEI</th>
              <th style={{ padding: '10px 12px' }} className="nowrap-cell">MAC Address</th>
              <th style={{ padding: '10px 12px' }} className="nowrap-cell">시리얼</th>
              <th style={{ padding: '10px 12px' }} className="nowrap-cell">시간</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }} className="nowrap-cell">삭제</th>
            </tr>
          </thead>
          <tbody>
            {scannedItems.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  감지된 IMEI 데이터가 없습니다. 카메라를 IMEI 각인 부위에 가져다대세요.
                </td>
              </tr>
            ) : (
              scannedItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#38bdf8' }} className="nowrap-cell">
                    {item.asset_no}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700 }} className="nowrap-cell">
                    {item.imei}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#f43f5e' }} className="nowrap-cell">
                    {item.mac_address || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#f59e0b' }} className="nowrap-cell">
                    {item.serial_no || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: '0.75rem' }} className="nowrap-cell">
                    {item.scanned_at}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }} className="nowrap-cell">
                    <button
                      className="btn btn-outline"
                      style={{ padding: '2px 6px', color: '#ef4444' }}
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
