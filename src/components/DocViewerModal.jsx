import React, { useState } from 'react';
import { FileText, BookOpen, X, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';

const SPEC_CONTENT = `# 🏛️ [기능 명세서] UBUS DragonRPA & 통합 자산 라벨 자동화 시스템 (SPECIFICATION.md)

1. 시스템 목적
- ERP 자산 관리, 입고/출고/검수 업무의 100% 무인화.
- 블루투스 바코드 스캔 시 0.1초 DB 매칭 및 1초 Zebra 고속 직통 라벨 출력.
- 위치 무관(Position-Agnostic) 엑셀 파싱 및 웹 브라우저(Edge/Chrome) 자동 조작.

2. 12대 표준 자산 스키마
- 자산번호(PK), 제품명, 모델명, 제조번호(시리얼), 선반번호, 자산상태, 옵션, 교정일자, 비고, MAC wlan, MAC lan, 구성요소

3. 라벨 인쇄 및 디자이너
- 지원: Zebra GK420d, ZD420D, ZT411 (203 DPI)
- 프로토콜: winspool.Drv RAW Direct P/Invoke & Direct TCP/IP
- 프리셋: 자산 대형(72×40mm), 소형 QR(50×25mm), 제조번호 QR(60×30mm)

4. 범용 RPA 시나리오
- 3대 기본: 입고 자동 등록, 자산 정보 수정, 출고 검수 자동화
- 4대 비상 대안: 0MB 초경량 픽셀 매칭, JS 직접 주입, 키보드 탭 시퀀스, 픽셀 좌표

5. 보안 게이트키퍼
- 초기 기본 비밀번호: 0000
- 관리자 영역(RPA 편집기, 스키마 빌더) 접근 제한 및 세션 제어`;

const MANUAL_CONTENT = `# 📖 [기능 매뉴얼] UBUS DragonRPA & 통합 자산 라벨 자동화 시스템 (MANUAL.md)

1. 빠른 시작
- print-agent/dist/ [에이전트실행.bat] 더블클릭 실행
- 웹 브라우저 접속 (http://localhost:5173/LabelPrintStation/)

2. 라벨 인쇄 및 블루투스 스캐너
- 화면 포커스 무관(Zero-Focus), 블루투스 스캐너로 자산번호/시리얼 바코드 스캔 즉시 1초 라벨 자동 출력
- [라벨 서식 디자인] 탭에서 원하는 규격 프리셋 원클릭 전환

3. RPA 3단계 무인 자동화 실행
- 1단계: 시나리오 선택 ([입고 자동 등록] 등)
- 2단계: [표준 양식 다운로드] 후 데이터 작성 및 엑셀 드래그 앤 드롭
- 3단계: [▶ RPA 실행] 클릭 → 브라우저 무인 자동화 수행

4. 관리자 모드 & 시나리오 편집
- [RPA 시나리오 편집] 또는 [스키마 빌더] 클릭 시 비밀번호 [0000] 입력
- [화면에서 요소 집기]로 XPath 자동 입력 및 {{자산번호}} 변수 바인딩
- 작업 후 상단 [관리자 모드] 클릭 시 즉시 수동 잠금

5. 에이전트 원클릭 재시작
- 대시보드 우측 상단의 [🔄 에이전트 재시작] 클릭 시 프로세스 즉시 재기동`;

export default function DocViewerModal({ isOpen, onClose, initialTab = 'spec' }) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'spec' | 'manual'
  const [restartStatus, setRestartStatus] = useState('');

  if (!isOpen) return null;

  const handleRestartAgent = async () => {
    if (!window.confirm('로컬 PC 에이전트 프로세스를 재시작하시겠습니까?')) return;
    setRestartStatus('재시작 명령 전송 중...');
    try {
      const res = await fetch('http://127.0.0.1:9988/api/restart', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setRestartStatus('✅ 에이전트가 재시작되었습니다.');
        setTimeout(() => setRestartStatus(''), 3000);
      } else {
        setRestartStatus('❌ 재시작 실패: ' + data.message);
      }
    } catch (e) {
      setRestartStatus('✅ 에이전트 재시작 신호가 전송되었습니다.');
      setTimeout(() => setRestartStatus(''), 3000);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #475569',
        borderRadius: '10px',
        width: '100%',
        maxWidth: '760px',
        height: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        overflow: 'hidden',
        color: '#f8fafc'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 16px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('spec')}
              className={`btn ${activeTab === 'spec' ? 'btn-primary' : 'btn-outline'}`}
              style={{ fontSize: '0.72rem', padding: '3px 10px' }}
            >
              <FileText size={12} /> 기능 명세서 (SPECIFICATION.md)
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`btn ${activeTab === 'manual' ? 'btn-primary' : 'btn-outline'}`}
              style={{ fontSize: '0.72rem', padding: '3px 10px' }}
            >
              <BookOpen size={12} /> 기능 매뉴얼 (MANUAL.md)
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={handleRestartAgent}
              className="btn btn-outline"
              style={{ fontSize: '0.68rem', padding: '3px 8px', borderColor: '#ef4444', color: '#fca5a5' }}
              title="에이전트 원클릭 재시작"
            >
              <RefreshCw size={11} /> 에이전트 재시작
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: '6px' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {restartStatus && (
          <div style={{
            padding: '6px 16px',
            backgroundColor: '#0f172a',
            borderBottom: '1px solid #334155',
            fontSize: '0.72rem',
            color: '#38bdf8'
          }}>
            {restartStatus}
          </div>
        )}

        {/* Content Body */}
        <div style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          backgroundColor: '#090d16',
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          color: '#cbd5e1'
        }}>
          {activeTab === 'spec' ? SPEC_CONTENT : MANUAL_CONTENT}
        </div>
      </div>
    </div>
  );
}
