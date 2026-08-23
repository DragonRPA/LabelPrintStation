import React, { useRef, useEffect, useState } from 'react';
import { Camera, UploadCloud, Play, Square, Plus, Volume2, ShieldCheck, Target, Zap, ZapOff, RefreshCw, Smartphone, Eye, Mic, MicOff, CheckCircle, Search, Database, Layers, CheckSquare } from 'lucide-react';
import { getTesseractWorker, preprocessCanvasROI, parseFieldsFromTesseractResult } from '../utils/ocrWorker';
import { triggerSuccessFeedback } from '../utils/soundFeedback';
import { saveScansToDb, getStoredConfig, fetchScansFromDb, insertPrintQueue } from '../utils/dbClient';
import { isSpeechRecognitionSupported, createSpeechRecognizer, convertKoreanSpeechToDigits } from '../utils/speechRecognition';

export default function MobileScannerView({ onError, onOpenConfigModal }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const recognizerRef = useRef(null);

  // Ref to fix React closure stale state bug in Web Speech onEnd loop
  const isVoiceOnRef = useRef(false);

  const [isScanning, setIsScanning] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('카메라 준비 중');
  const [ocrStatus, setOcrStatus] = useState('초광각 접사 카메라 & 상시 음성 인식 가동 중');
  const [detectedPulse, setDetectedPulse] = useState(false);

  // Galaxy S24 Multi-Lens State
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Hardware Camera Features & Always-On Voice Recognition
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isVoiceOn, setIsVoiceOn] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');

  // Real-Time 4-Digit IMEI Direct Workstation & Candidate Matches State
  const [fourDigits, setFourDigits] = useState('');
  const [matchedRecord, setMatchedRecord] = useState(null);
  const [candidateMatches, setCandidateMatches] = useState([]);

  // Real-Time OCR Text Region Bounding Boxes
  const [liveBoxes, setLiveBoxes] = useState([]);
  const [pinpointBox, setPinpointBox] = useState(null);

  // Recent scanned items list & Master DB Cache for 4-digit auto matching
  const [scannedItems, setScannedItems] = useState([]);
  const [masterDbItems, setMasterDbItems] = useState([]);
  const [lastScannedImei, setLastScannedImei] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const dbConfig = getStoredConfig();
  const isConfigured = Boolean(dbConfig.url && !dbConfig.url.includes('your-neon-project') && !dbConfig.url.includes('your-supabase-project'));

  // Sync ref with isVoiceOn state
  useEffect(() => {
    isVoiceOnRef.current = isVoiceOn;
  }, [isVoiceOn]);

  // Pre-load Master DB Data for Instant 4-Digit Matching
  useEffect(() => {
    async function loadMasterData() {
      try {
        const dbData = await fetchScansFromDb();
        if (dbData && dbData.length > 0) {
          setMasterDbItems(dbData);
        }
      } catch (e) {
        console.warn('Master DB pre-load warning:', e);
      }
    }
    loadMasterData();
  }, [isConfigured]);

  // Enumerate REAR physical camera lenses ONLY & AUTO-SELECT ULTRA-WIDE MACRO LENS!
  const enumeratePhysicalCameras = async () => {
    if (typeof window === 'undefined' || !('navigator' in window) || !('mediaDevices' in navigator)) return;
    try {
      await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');

      // Strictly filter out FRONT / SELFIE cameras
      const rearLensesOnly = videoInputs.filter(d => {
        const lbl = (d.label || '').toLowerCase();
        const isFront = lbl.includes('front') || lbl.includes('user') || lbl.includes('selfie') || lbl.includes('전면') || lbl.includes('내면');
        return !isFront;
      });

      const formatted = rearLensesOnly.map((d, index) => {
        let label = d.label || `후면 렌즈 #${index + 1}`;
        const lower = label.toLowerCase();
        
        if (lower.includes('ultra') || lower.includes('wide') || index === 1) {
          label = `📷 초광각 접사 렌즈 (5cm 초접사)`;
        } else if (lower.includes('tele') || lower.includes('zoom') || index === 2) {
          label = `📷 3배/5배 망원 렌즈 (30cm 줌)`;
        } else {
          label = `📷 기본 메인 렌즈 (기본 광각)`;
        }

        return {
          deviceId: d.deviceId,
          label,
          rawLabel: d.label
        };
      });

      setVideoDevices(formatted);

      // AUTO UX: Prioritize Ultra-Wide Macro Lens (Index 1 or Ultra/Wide label) as DEFAULT!
      if (formatted.length > 0) {
        const macroLens = formatted.find(dev => dev.label.includes('초광각') || dev.label.includes('접사')) || formatted[1] || formatted[0];
        const defaultId = macroLens.deviceId;
        setSelectedDeviceId(defaultId);
        startCamera(defaultId);
      }
    } catch (e) {
      console.warn('Enumerate devices warning:', e);
    }
  };

  // Start Camera Stream with Robust Multi-Level Fallback
  const startCamera = async (targetDeviceId) => {
    const devId = targetDeviceId || selectedDeviceId;
    setCameraStatus('접사 렌즈 연결 중...');

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      await new Promise(r => setTimeout(r, 100));
    }

    let stream = null;

    if (devId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { ideal: devId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });
      } catch (errA) {
        console.warn('Strategy A failed, trying Strategy B:', errA);
      }
    }

    if (!stream && devId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: devId }
        });
      } catch (errB) {
        console.warn('Strategy B failed, trying Strategy C:', errB);
      }
    }

    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
      } catch (errC) {
        console.error('All camera strategies failed:', errC);
        setCameraStatus('카메라 렌즈 연결 실패');
        if (onError) onError(`카메라를 실행할 수 없습니다: ${errC.message || '장치가 사용 중이거나 지원되지 않습니다.'}`);
        return;
      }
    }

    streamRef.current = stream;

    const track = stream.getVideoTracks()[0];
    if (track && track.getCapabilities) {
      const capabilities = track.getCapabilities();
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) {}
      }
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setIsScanning(true);
    setCameraStatus('📷 초광각 접사 가동 중');
  };

  const handleDeviceChange = (e) => {
    const newId = e.target.value;
    setSelectedDeviceId(newId);
    startCamera(newId);
  };

  // Always Allow Flashlight Torch Toggle Action
  const toggleTorch = async () => {
    if (!streamRef.current) {
      alert('카메라가 정지되어 있습니다. 스캔 시작 후 플래시를 켜주세요.');
      return;
    }
    const track = streamRef.current.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      try {
        const nextState = !isTorchOn;
        await track.applyConstraints({
          advanced: [{ torch: nextState }]
        });
        setIsTorchOn(nextState);
        setOcrStatus(nextState ? '🔦 플래시 조명이 켜졌습니다 (금속 각인 음영 극대화)' : '🔦 플래시 조명이 꺼졌습니다');
      } catch (e) {
        console.warn('Torch toggle error:', e);
        alert('현재 선택된 카메라 렌즈는 LED 플래시 조명을 직접 지원하지 않습니다. 기본 메인 렌즈로 전환해 보세요.');
      }
    }
  };

  // Perform 4-Digit Auto Matching (Support Unique 1:1 vs Multi-Candidate Picker)
  const perform4DigitDataMatching = (inputDigits) => {
    const clean4 = inputDigits.replace(/\D/g, '');
    if (clean4.length < 4) {
      setMatchedRecord(null);
      setCandidateMatches([]);
      return null;
    }

    const last4 = clean4.slice(-4);

    // Search inside Master DB Items & Scanned Items
    const pool = [...masterDbItems, ...scannedItems];
    
    // Deduplicate by IMEI
    const uniquePoolMap = new Map();
    pool.forEach(item => {
      if (item && item.imei) {
        const cleanImei = item.imei.replace(/\D/g, '');
        if (!uniquePoolMap.has(cleanImei)) {
          uniquePoolMap.set(cleanImei, item);
        }
      }
    });
    const uniquePool = Array.from(uniquePoolMap.values());

    const matches = uniquePool.filter(item => {
      const targetImei = (item.imei || '').replace(/\D/g, '');
      return targetImei.endsWith(last4);
    });

    if (matches.length === 1) {
      // CASE 1: Single Unique Match (1:1)
      setMatchedRecord(matches[0]);
      setCandidateMatches([]);
      return matches[0];
    } else if (matches.length > 1) {
      // CASE 2: Multi-Candidate Match (2+ items with same ending 4 digits)
      setCandidateMatches(matches);
      setMatchedRecord(null);
      setOcrStatus(`⚠️ IMEI 끝 4자리(${last4}) 동일 장비 ${matches.length}건 발견! 해당 자산을 선택하세요.`);
      return null;
    } else {
      // CASE 3: No pre-existing record found ➔ Auto-construct candidate full IMEI placeholder
      const constructed = {
        asset_no: `TEST${last4}`,
        imei: `351379300${last4.padStart(6, '0')}`,
        mac_address: '',
        serial_no: '',
        isNewConstructed: true
      };
      setMatchedRecord(constructed);
      setCandidateMatches([]);
      return constructed;
    }
  };

  // Main Screen Seamless 1-Tap & Infinite Auto-Restart Voice Recognition
  const toggleVoice = () => {
    if (!isSpeechRecognitionSupported()) {
      alert('현재 브라우저 환경에서는 음성 인식(Speech API)을 지원하지 않습니다. 최신 크롬 또는 삼성 인터넷 브라우저를 사용해 주세요.');
      return;
    }

    if (isVoiceOn) {
      isVoiceOnRef.current = false;
      if (recognizerRef.current) {
        try { recognizerRef.current.stop(); } catch (e) {}
        recognizerRef.current = null;
      }
      setIsVoiceOn(false);
      setVoiceStatus('');
      setOcrStatus('🎙️ 음성 인식이 꺼졌습니다');
    } else {
      isVoiceOnRef.current = true;
      setIsVoiceOn(true);
      startVoiceEngine();
    }
  };

  const startVoiceEngine = () => {
    if (!isVoiceOnRef.current) return;

    if (recognizerRef.current) {
      try { recognizerRef.current.stop(); } catch (e) {}
      recognizerRef.current = null;
    }

    const recognizer = createSpeechRecognizer({
      onResult: ({ transcript, digits }) => {
        setVoiceStatus(`🎙️ 음성: "${transcript}" -> [${digits || '듣는중'}]`);
        if (digits && digits.length >= 1) {
          const last4 = digits.slice(-4);
          setFourDigits(last4);
          const matchResult = perform4DigitDataMatching(last4);

          if (last4.length === 4 && matchResult) {
            handleAutoSaveFrom4Digits(last4, matchResult);
          }
        }
      },
      onError: (err) => {
        console.warn('Voice STT warning:', err);
      },
      onEnd: () => {
        // FIX STALE CLOSURE: Use isVoiceOnRef.current to seamlessly auto-restart in 50ms!
        if (isVoiceOnRef.current) {
          setTimeout(() => {
            if (isVoiceOnRef.current) {
              startVoiceEngine();
            }
          }, 80);
        }
      }
    });

    if (recognizer) {
      try {
        recognizer.start();
        recognizerRef.current = recognizer;
        setOcrStatus('🎙️ 음성 상시 인식 가동 중! "오공오이" 또는 "5052"라고 말씀하세요.');
      } catch (e) {
        console.warn('Voice start exception:', e);
      }
    }
  };

  // Select Candidate Device from Multi-Match List
  const handleSelectCandidate = (candidateItem) => {
    setMatchedRecord(candidateItem);
    setCandidateMatches([]);
    handleAutoSaveFrom4Digits(fourDigits, candidateItem);
  };

  // Direct Auto Save Execution from 4 Digits (Zero Modal Click!)
  const handleAutoSaveFrom4Digits = async (digits4, recordObj) => {
    if (!digits4 || digits4.length < 4) return;
    const match = recordObj || matchedRecord;

    const targetImei = match ? match.imei : `351379300${digits4.padStart(6, '0')}`;
    const autoAssetNo = match ? match.asset_no : `TEST${digits4}`;

    const newItem = {
      id: `direct_${Date.now()}`,
      asset_no: autoAssetNo,
      imei: targetImei,
      mac_address: match?.mac_address || '',
      serial_no: match?.serial_no || '',
      scanned_at: new Date().toLocaleTimeString('ko-KR'),
      status: 'COMPLETED'
    };

    triggerSuccessFeedback();
    setDetectedPulse(true);
    setTimeout(() => setDetectedPulse(false), 1200);
    setScannedItems(prev => [newItem, ...prev]);
    setFourDigits('');
    setMatchedRecord(null);
    setCandidateMatches([]);

    // ── DB 저장 + 프린트 큐 등록 (isConfigured 무관하게 항상 시도) ──────────
    const cfg = getStoredConfig();
    const dbReady = Boolean(cfg.url && !cfg.url.includes('your-neon-project') && !cfg.url.includes('your-supabase-project'));

    if (dbReady) {
      // 1) 자산 DB 저장
      try {
        await saveScansToDb([newItem]);
        newItem.status = 'EXPORTED';
      } catch (e) {
        console.error('[DB] 저장 실패:', e);
        setOcrStatus(`⚠️ DB 저장 실패: ${e.message}`);
        return;
      }

      // 2) print_queue 등록 (await → 실패 시 화면에 즉시 표시)
      setOcrStatus(`🖨️ 프린트 큐 등록 중... (${autoAssetNo} / ${targetImei})`);
      try {
        const queued = await insertPrintQueue({
          asset_no:    newItem.asset_no,
          imei:        newItem.imei,
          mac_address: newItem.mac_address,
          serial_no:   newItem.serial_no
        });
        setOcrStatus(`✅ 라벨 출력 요청 완료! 큐ID: ${queued?.id?.slice(0,8) ?? '?'} / IMEI: ${targetImei}`);
      } catch (e) {
        console.error('[print_queue] 큐 등록 실패:', e);
        setOcrStatus(`❌ 프린트 큐 등록 실패: ${e.message}`);
      }
    } else {
      // DB 미연결 상태 - 로컬만 저장
      setOcrStatus(`⚠️ DB 미연결 (로컬 저장만).`);
    }
  };

  const handleFourDigitsChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setFourDigits(val);
    perform4DigitDataMatching(val);
  };

  const handleDirectSubmit = (e) => {
    e.preventDefault();
    if (fourDigits.length < 4) {
      if (onError) onError('IMEI 끝 4자리를 정확히 4자리 숫자로 입력해주세요.');
      return;
    }

    if (candidateMatches.length > 1) {
      alert('동일한 끝 4자리를 가진 장비가 복수개 존재합니다. 아래 목록에서 해당 자산을 선택해주세요.');
      return;
    }

    handleAutoSaveFrom4Digits(fourDigits, matchedRecord);
  };

  // Export Scans to DB
  const handleExportAll = async () => {
    if (scannedItems.length === 0) {
      if (onError) onError('내보낼 스캔 데이터가 없습니다.');
      return;
    }

    setIsSaving(true);
    try {
      await saveScansToDb(scannedItems);
      setScannedItems(prev => prev.map(item => ({ ...item, status: 'EXPORTED' })));
      alert(`성공적으로 ${scannedItems.length}건의 데이터를 DB에 저장하였습니다! (PC 라벨 동기화)`);
    } catch (err) {
      if (onError) onError(err.message || 'DB 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const triggerRefocus = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      try {
        setOcrStatus('🎯 렌즈 초점 재조정 진행 중...');
        await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
        setTimeout(async () => {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          setOcrStatus('🎯 렌즈 초점 재조정 완료!');
        }, 200);
      } catch (e) {}
    }
  };

  const stopCamera = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    isVoiceOnRef.current = false;
    if (recognizerRef.current) {
      try { recognizerRef.current.stop(); } catch (e) {}
      recognizerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
    setIsTorchOn(false);
    setIsVoiceOn(false);
    setLiveBoxes([]);
    setPinpointBox(null);
    setCameraStatus('카메라 정지됨');
  };

  // Scanning Loop with Real-Time Bounding Box
  useEffect(() => {
    if (!isScanning) return;

    let isProcessing = false;

    scanTimerRef.current = setInterval(async () => {
      if (isProcessing || !videoRef.current || videoRef.current.readyState !== 4) return;
      isProcessing = true;
      try {
        const video = videoRef.current;
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        if (!vWidth || !vHeight) {
          isProcessing = false;
          return;
        }

        const roiWidth = Math.floor(vWidth * 0.88);
        const roiHeight = Math.floor(vHeight * 0.75);
        const roiX = Math.floor((vWidth - roiWidth) / 2);
        const roiY = Math.floor((vHeight - roiHeight) / 2);

        // Preprocess High-Res Broad Canvas Frame with Metallic Adaptive Local Contrast Binarization
        const roiCanvas = preprocessCanvasROI(video, { x: roiX, y: roiY, width: roiWidth, height: roiHeight });

        const worker = await getTesseractWorker();
        const tesseractResult = await worker.recognize(roiCanvas);

        const { parsed, candidateBoxes } = parseFieldsFromTesseractResult(tesseractResult);

        // Convert Candidate Text Bounding Boxes into % relative to video container
        if (candidateBoxes && candidateBoxes.length > 0) {
          const mappedLiveBoxes = candidateBoxes.slice(0, 8).map((cb, idx) => {
            const relX = ((roiX + cb.bbox.x0) / vWidth) * 100;
            const relY = ((roiY + cb.bbox.y0) / vHeight) * 100;
            const relW = ((cb.bbox.x1 - cb.bbox.x0) / vWidth) * 100;
            const relH = ((cb.bbox.y1 - cb.bbox.y0) / vHeight) * 100;
            return {
              id: `box_${idx}_${Date.now()}`,
              text: cb.text,
              x: Math.max(0, relX),
              y: Math.max(0, relY),
              w: Math.max(8, relW),
              h: Math.max(4, relH)
            };
          });
          setLiveBoxes(mappedLiveBoxes);
        } else {
          setLiveBoxes([]);
        }

        if (parsed && parsed.imei && parsed.imei.length >= 15) {
          if (parsed.bbox) {
            const relX = ((roiX + parsed.bbox.x0) / vWidth) * 100;
            const relY = ((roiY + parsed.bbox.y0) / vHeight) * 100;
            const relW = ((parsed.bbox.x1 - parsed.bbox.x0) / vWidth) * 100;
            const relH = ((parsed.bbox.y1 - parsed.bbox.y0) / vHeight) * 100;
            setPinpointBox({ x: relX, y: relY, w: Math.max(20, relW), h: Math.max(8, relH) });
          }
        }
      } catch (err) {
        console.error('OCR Broad Loop Error:', err);
      } finally {
        isProcessing = false;
      }
    }, 400);

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [isScanning]);

  useEffect(() => {
    enumeratePhysicalCameras();
    return () => stopCamera();
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 12px)',
      gap: '8px',
      position: 'relative',
      margin: '-12px -12px 0 -12px',
      padding: '6px'
    }}>
      {/* Viewfinder Screen - Main Camera Screen */}
      <div style={{
        flex: 1,
        position: 'relative',
        backgroundColor: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        border: `3px solid ${detectedPulse ? '#10b981' : '#334155'}`,
        boxShadow: detectedPulse ? '0 0 25px rgba(16, 185, 129, 0.9)' : 'none',
        transition: 'all 0.2s ease'
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Top Floating Translucent Overlay Control Bar inside Viewfinder */}
        <div style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          right: '8px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(6px)',
          borderRadius: '8px',
          padding: '6px 8px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          gap: '6px',
          zIndex: 20,
          border: '1px solid rgba(255,255,255,0.15)'
        }}>
          {/* Physical Lens Select Dropdown */}
          {videoDevices.length > 0 ? (
            <select
              style={{
                fontSize: '0.7rem',
                padding: '4px 6px',
                backgroundColor: '#0f172a',
                borderColor: '#38bdf8',
                color: '#38bdf8',
                fontWeight: 700,
                borderRadius: '6px',
                maxWidth: '45%'
              }}
              value={selectedDeviceId}
              onChange={handleDeviceChange}
            >
              {videoDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 700 }}>📷 초광각 접사 렌즈</span>
          )}

          {/* Controls: Focus, Torch, and Voice Recognition */}
          <div style={{ display: 'flex', gap: '3px' }}>
            <button className="btn btn-outline" style={{ padding: '3px 5px', fontSize: '0.68rem', borderColor: '#38bdf8', color: '#7dd3fc', backgroundColor: 'rgba(15,23,42,0.6)' }} onClick={triggerRefocus}>
              <RefreshCw size={11} /> 초점
            </button>

            <button className={`btn ${isTorchOn ? 'btn-success' : 'btn-outline'}`} style={{ padding: '3px 5px', fontSize: '0.68rem', backgroundColor: isTorchOn ? '#10b981' : 'rgba(15,23,42,0.6)' }} onClick={toggleTorch}>
              {isTorchOn ? <Zap size={11} /> : <ZapOff size={11} />}
              {isTorchOn ? '플래시ON' : '플래시OFF'}
            </button>

            <button className={`btn ${isVoiceOn ? 'btn-success' : 'btn-outline'}`} style={{ padding: '3px 5px', fontSize: '0.68rem', backgroundColor: isVoiceOn ? '#8b5cf6' : 'rgba(15,23,42,0.6)', borderColor: '#a78bfa', color: '#c4b5fd' }} onClick={toggleVoice}>
              {isVoiceOn ? <Mic size={11} /> : <MicOff size={11} />}
              {isVoiceOn ? '음성ON' : '음성OFF'}
            </button>
          </div>
        </div>

        {/* Broad Scanning Area Guide Box Overlay */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '88%',
          height: '75%',
          border: '1px dashed rgba(56, 189, 248, 0.5)',
          borderRadius: '12px',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
          pointerEvents: 'none'
        }}>
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '0.72rem',
            color: '#e0f2fe',
            fontWeight: 700,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            padding: '3px 8px',
            borderRadius: '4px',
            whiteSpace: 'nowrap'
          }}>
            {isVoiceOn ? '💡 마이크 상시 가동 중! "오공오이" 또는 "5052"라고 불러주세요.' : '기기 뒷면 조준 (아래 직통 바에 4자리 타핑/음성)'}
          </div>
        </div>

        {/* REAL-TIME LIVE TEXT CANDIDATE BOUNDING BOXES */}
        {isScanning && liveBoxes.map((b) => (
          <div
            key={b.id}
            style={{
              position: 'absolute',
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.w}%`,
              height: `${b.h}%`,
              border: '1px solid #38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.2)',
              borderRadius: '3px',
              pointerEvents: 'none',
              zIndex: 15,
              transition: 'all 0.1s ease'
            }}
          />
        ))}

        {/* Live Pinpoint Bounding Box Highlight on Matched Target IMEI Location */}
        {pinpointBox && (
          <div style={{
            position: 'absolute',
            left: `${pinpointBox.x}%`,
            top: `${pinpointBox.y}%`,
            width: `${pinpointBox.w}%`,
            height: `${pinpointBox.h}%`,
            border: '3px solid #10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.3)',
            borderRadius: '6px',
            boxShadow: '0 0 25px rgba(16, 185, 129, 1)',
            display: 'flex',
            alignItems: 'center',
            justify: 'center',
            zIndex: 30,
            transition: 'all 0.15s ease'
          }}>
            <span style={{
              fontSize: '0.72rem',
              color: '#ffffff',
              fontWeight: 800,
              backgroundColor: '#10b981',
              padding: '2px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Target size={13} /> IMEI 포착!
            </span>
          </div>
        )}

        {/* Bottom Floating Status Controls over Camera */}
        <div style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          right: '8px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          zIndex: 20
        }}>
          <div style={{
            fontSize: '0.7rem',
            color: '#fff',
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            padding: '4px 8px',
            borderRadius: '6px'
          }}>
            {cameraStatus}
          </div>

          <button className={`btn ${isScanning ? 'btn-danger' : 'btn-primary'}`} style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={isScanning ? stopCamera : () => startCamera()}>
            {isScanning ? <Square size={12} /> : <Play size={12} />}
            {isScanning ? '스캔 정지' : '스캔 시작'}
          </button>
        </div>
      </div>

      {/* MULTI-CANDIDATE PICKER CARD PANEL (Shown when multiple DB items share same ending 4 digits) */}
      {candidateMatches.length > 1 && (
        <div style={{
          backgroundColor: '#0f172a',
          border: '2px solid #f59e0b',
          borderRadius: '10px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          boxShadow: '0 0 15px rgba(245, 158, 11, 0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 800, color: '#fef08a' }}>
            <Layers size={15} style={{ color: '#f59e0b' }} />
            <span>⚠️ 끝 4자리({fourDigits}) 동일 장비가 {candidateMatches.length}건 발견되었습니다! 해당 자산을 터치하세요:</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
            {candidateMatches.map((cand, idx) => (
              <button
                key={cand.id || `cand_${idx}`}
                type="button"
                className="btn btn-outline"
                style={{
                  display: 'flex',
                  justify: 'space-between',
                  alignItems: 'center',
                  backgroundColor: '#1e293b',
                  borderColor: '#38bdf8',
                  color: '#fff',
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: '0.76rem'
                }}
                onClick={() => handleSelectCandidate(cand)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 800, color: '#38bdf8' }}>
                    #{idx + 1}. 자산: {cand.asset_no || '미지정'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#fef08a' }}>
                    IMEI: {cand.imei}
                  </span>
                </div>
                <span style={{
                  fontSize: '0.68rem',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 800
                }}>
                  선택 확정 ➔
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAIN VIEW INTEGRATED 4-DIGIT & VOICE QUICK WORKSTATION BAR (NO MODAL NEEDED!) */}
      <div style={{
        backgroundColor: '#1e293b',
        borderRadius: '10px',
        padding: '8px 10px',
        border: '1px solid #38bdf8',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)'
      }}>
        <form onSubmit={handleDirectSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            placeholder="끝 4자리 (5052)"
            value={fourDigits}
            onChange={handleFourDigitsChange}
            maxLength={4}
            style={{
              flex: 1,
              fontSize: '1.15rem',
              fontWeight: 900,
              letterSpacing: '2px',
              textAlign: 'center',
              borderColor: candidateMatches.length > 1 ? '#f59e0b' : fourDigits.length === 4 ? '#10b981' : '#38bdf8',
              backgroundColor: '#0f172a',
              color: candidateMatches.length > 1 ? '#fef08a' : '#6ee7b7',
              padding: '6px 8px'
            }}
          />

          <button
            type="button"
            className={`btn ${isVoiceOn ? 'btn-success' : 'btn-outline'}`}
            style={{
              padding: '6px 10px',
              fontSize: '0.75rem',
              borderColor: '#a78bfa',
              color: isVoiceOn ? '#fff' : '#c4b5fd',
              backgroundColor: isVoiceOn ? '#8b5cf6' : '#1e1b4b',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 700
            }}
            onClick={toggleVoice}
          >
            <Mic size={14} />
            {isVoiceOn ? '🎙️ 음성듣는중' : '🎙️ 음성ON'}
          </button>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={fourDigits.length < 4 || candidateMatches.length > 1}
            style={{
              padding: '6px 12px',
              fontSize: '0.78rem',
              fontWeight: 800,
              whiteSpace: 'nowrap'
            }}
          >
            ⚡ DB 저장
          </button>
        </form>

        {/* Real-time Single Unique DB Auto Match Result Card */}
        {matchedRecord && (
          <div style={{
            backgroundColor: matchedRecord.isNewConstructed ? '#0f172a' : '#064e3b',
            border: `1px solid ${matchedRecord.isNewConstructed ? '#334155' : '#10b981'}`,
            borderRadius: '6px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justify: 'space-between',
            fontSize: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <CheckCircle size={14} style={{ color: matchedRecord.isNewConstructed ? '#fef08a' : '#6ee7b7', flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontFamily: 'monospace', color: '#ffffff', whiteSpace: 'nowrap' }}>
                {matchedRecord.imei}
              </span>
              <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>({matchedRecord.asset_no})</span>
            </div>

            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: matchedRecord.isNewConstructed ? '#fef08a' : '#6ee7b7', whiteSpace: 'nowrap' }}>
              {matchedRecord.isNewConstructed ? '신규생성' : '★ 100% DB 매칭 (PC 라벨연동)'}
            </span>
          </div>
        )}
      </div>

      {/* OCR Status Banner */}
      <div style={{
        backgroundColor: '#1e293b',
        padding: '6px 10px',
        borderRadius: '6px',
        fontSize: '0.76rem',
        color: detectedPulse ? '#6ee7b7' : isVoiceOn ? '#c4b5fd' : '#94a3b8',
        fontWeight: detectedPulse ? 700 : 500,
        textAlign: 'center',
        border: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justify: 'center',
        gap: '6px'
      }}>
        {isVoiceOn ? <Mic size={13} style={{ color: '#a78bfa' }} /> : <Eye size={13} style={{ color: '#38bdf8' }} />}
        <span>{voiceStatus || ocrStatus}</span>
      </div>

      {/* Bottom Compact Summary Toolbar */}
      <div style={{
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        padding: '6px 10px',
        border: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={14} style={{ color: isConfigured ? '#10b981' : '#f59e0b' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isConfigured ? '#6ee7b7' : '#fef08a' }}>
              {isConfigured ? 'DB 실시간 동기화' : '로컬 스캔 모드'}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>| 누적 {scannedItems.length}건</span>
          </div>

          <button className="btn btn-success" style={{ padding: '2px 8px', fontSize: '0.72rem' }} onClick={handleExportAll} disabled={scannedItems.length === 0 || isSaving}>
            <UploadCloud size={12} /> DB 내보내기
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
          {scannedItems.length === 0 ? (
            <span style={{ fontSize: '0.7rem', color: '#64748b', padding: '2px 0' }}>
              아직 스캔 완료된 항목이 없습니다.
            </span>
          ) : (
            scannedItems.slice(0, 5).map((item) => (
              <div
                key={item.id}
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '3px 6px',
                  fontSize: '0.68rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
              >
                <div style={{ fontWeight: 700, color: '#38bdf8' }}>{item.asset_no}</div>
                <div style={{ fontFamily: 'monospace', color: '#fef08a' }}>{item.imei}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
