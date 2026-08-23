import React, { useState, useEffect } from 'react';
import { Smartphone, Monitor, Database, CheckCircle, Bot, ShieldCheck } from 'lucide-react';
import MobileScannerView from './views/MobileScannerView';
import PCDashboardView from './views/PCDashboardView';
import FileExportModal from './components/FileExportModal';
import LabelPrintModal from './components/LabelPrintModal';
import DataImportModal from './components/DataImportModal';
import NeonConfigModal from './components/NeonConfigModal';
import PrinterGuideModal from './components/PrinterGuideModal';
import AgentUpdateModal from './components/AgentUpdateModal';
import AgentShutdownButton from './components/AgentShutdownButton';
import ErrorModal from './components/ErrorModal';
import { getStoredConfig } from './utils/dbClient';
import { initHardwareScannerListener } from './utils/hardwareScanner';
import { checkAgentLiveStatus } from './utils/agentUpdateManager';

export default function App() {
  const [deviceMode, setDeviceMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isSmallScreen = window.innerWidth < 768;
      return (isMobileUA || isSmallScreen) ? 'mobile' : 'pc';
    }
    return 'pc';
  });

  // Modals state
  const [errorMessage, setErrorMessage] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isPrinterGuideOpen, setIsPrinterGuideOpen] = useState(false);
  const [isAgentUpdateOpen, setIsAgentUpdateOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [exportModalState, setExportModalState] = useState({ isOpen: false, items: [] });
  const [printModalState, setPrintModalState] = useState({ isOpen: false, items: [], config: null });

  const [refreshKey, setRefreshKey] = useState(0);

  // ⭐️ 에이전트 실시간 상태 및 버전 주기적 감지 (10초 주기)
  useEffect(() => {
    const pollAgent = async () => {
      const status = await checkAgentLiveStatus();
      setAgentStatus(status);
    };
    pollAgent();
    const interval = setInterval(pollAgent, 10000);
    return () => clearInterval(interval);
  }, []);

  // ★ 블루투스 & 하드웨어 바코드 스캐너 전역 자동 감지 가동
  useEffect(() => {
    initHardwareScannerListener({
      onScanResult: (item) => {
        setToastMessage(`바코드 스캔 감지: ${item.asset_no || item.serial_no} (출력 요청 완료)`);
        setTimeout(() => setToastMessage(null), 3000);
      },
      onAutoPrintSuccess: () => {
        setRefreshKey(prev => prev + 1);
      },
      onError: (err) => {
        setErrorMessage(typeof err === 'string' ? err : (err?.message || '스캐너 오류가 발생했습니다.'));
      }
    });
  }, []);

  const supabaseConfig = getStoredConfig();
  const isConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey && !supabaseConfig.url.includes('your-supabase-project'));

  const handleImportSuccess = async () => {
    setRefreshKey(prev => prev + 1);
  };

  // 보안인증서 원클릭 설치 배치파일 다운로드
  const handleDownloadCertInstaller = () => {
    const link = document.createElement('a');
    link.href = 'https://dragonrpa.github.io/LabelPrintStation/보안인증서_원클릭설치.bat';
    link.download = '보안인증서_원클릭설치.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToastMessage('보안인증서 1클릭 설치 도구(.bat)가 다운로드되었습니다. 다운로드된 파일을 실행해 주세요.');
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleGuideTestPrint = () => {
    setIsPrinterGuideOpen(false);
    const testSampleItem = [{
      id: 'test_sample_1',
      asset_no: 'TEST0001',
      imei: '351379300225052',
      mac_address: '4CEBB0B57A51',
      serial_no: 'R5KL60F0CZW',
      status: 'TEST'
    }];
    setPrintModalState({ isOpen: true, items: testSampleItem, config: null });
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', margin: '0', padding: deviceMode === 'mobile' ? '4px' : '6px 10px' }}>
      {/* Header Bar */}
      {deviceMode === 'pc' && (
        <header style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          border: '1px solid #334155',
          marginBottom: '8px',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              backgroundColor: 'var(--primary)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '6px',
              fontWeight: 800,
              fontSize: '0.82rem',
              letterSpacing: '0.5px'
            }}>
              UBUS_DragonRPA_Agent
            </div>
            <div>
              <h1 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                라벨 출력 관리
              </h1>
              <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                v1.7.0.Build.47 | 2026-08-19
              </span>
            </div>
          </div>

          {/* Mode Switcher & DB Config & Agent Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Agent Live Status & Smart Update Button */}
            <button
              className="btn btn-outline"
              style={{
                padding: '4px 8px',
                fontSize: '0.72rem',
                borderColor: agentStatus?.isOutdated ? '#f59e0b' : (agentStatus?.online ? '#4ade80' : '#475569'),
                color: agentStatus?.isOutdated ? '#fbbf24' : (agentStatus?.online ? '#86efac' : '#94a3b8'),
                backgroundColor: agentStatus?.isOutdated ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                fontWeight: agentStatus?.isOutdated ? 700 : 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onClick={() => setIsAgentUpdateOpen(true)}
              title="에이전트 실시간 상태 및 스마트 자가 업데이트"
            >
              <Bot size={13} />
              {agentStatus?.isOutdated
                ? `에이전트 업데이트 (${agentStatus.version} ➔ ${agentStatus.requiredVersion})`
                : (agentStatus?.online ? `에이전트 ${agentStatus.version}` : '에이전트 미실행')}
            </button>
            <AgentShutdownButton
              onShutdown={() => setAgentStatus(prev => ({ ...prev, online: false }))}
              isOnline={!!agentStatus?.online}
            />

            {/* 보안인증서 1클릭 설치 버튼 (스마트업데이트 버튼 바로 옆 배치) */}
            <button
              className="btn btn-outline"
              style={{
                padding: '4px 8px',
                fontSize: '0.72rem',
                borderColor: '#38bdf8',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onClick={handleDownloadCertInstaller}
              title="Windows 스마트스크린 및 보안 차단 해제용 사내 인증서 1클릭 설치 파일(.bat) 다운로드"
            >
              <ShieldCheck size={13} />
              보안인증서 설치
            </button>

            <button
              className="btn btn-outline"
              style={{
                padding: '4px 8px',
                fontSize: '0.72rem',
                borderColor: isConfigured ? 'var(--accent-green)' : '#f59e0b',
                color: isConfigured ? '#6ee7b7' : '#fef08a'
              }}
              onClick={() => setIsConfigOpen(true)}
            >
              <Database size={13} />
              {isConfigured ? 'DB 연결됨' : 'DB 설정'}
            </button>

            {/* Device View Switcher Tabs */}
            <div style={{
              backgroundColor: '#0f172a',
              padding: '2px',
              borderRadius: '6px',
              display: 'flex',
              gap: '2px'
            }}>
              <button
                className={`btn ${deviceMode === 'mobile' ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '3px 8px', fontSize: '0.72rem', border: 'none' }}
                onClick={() => setDeviceMode('mobile')}
              >
                <Smartphone size={12} />
                모바일
              </button>
              <button
                className={`btn ${deviceMode === 'pc' ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '3px 8px', fontSize: '0.72rem', border: 'none' }}
                onClick={() => setDeviceMode('pc')}
              >
                <Monitor size={12} />
                PC
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Scan Toast Notice */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '12px',
          right: '12px',
          backgroundColor: '#052e16',
          border: '1px solid #10b981',
          color: '#4ade80',
          padding: '6px 14px',
          borderRadius: '6px',
          fontSize: '0.75rem',
          fontWeight: 600,
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <CheckCircle size={14} />
          {toastMessage}
        </div>
      )}

      {/* Main View Area */}
      <main>
        {deviceMode === 'mobile' ? (
          <MobileScannerView
            onError={(msg) => setErrorMessage(typeof msg === 'string' ? msg : (msg?.message || '모바일 오류'))}
            onOpenConfigModal={() => setIsConfigOpen(true)}
          />
        ) : (
          <PCDashboardView
            key={refreshKey}
            onError={(msg) => setErrorMessage(typeof msg === 'string' ? msg : (msg?.message || '시스템 오류'))}
            onOpenExportModal={(items) => setExportModalState({ isOpen: true, items })}
            onOpenPrintModal={(items, config) => setPrintModalState({ isOpen: true, items, config })}
            onOpenConfigModal={() => setIsConfigOpen(true)}
            onOpenImportModal={() => setIsImportOpen(true)}
            onOpenPrinterGuide={() => setIsPrinterGuideOpen(true)}
          />
        )}
      </main>

      {/* Global Modals */}
      <ErrorModal
        errorMessage={errorMessage}
        onClose={() => setErrorMessage(null)}
      />

      <NeonConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSaveSuccess={() => alert('DB 연동 정보가 정상 등록되었습니다.')}
      />

      <PrinterGuideModal
        isOpen={isPrinterGuideOpen}
        onClose={() => setIsPrinterGuideOpen(false)}
        onTestPrint={handleGuideTestPrint}
      />

      <DataImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={handleImportSuccess}
        onError={(msg) => setErrorMessage(msg)}
      />

      <FileExportModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState({ isOpen: false, items: [] })}
        items={exportModalState.items}
      />

      <LabelPrintModal
        isOpen={printModalState.isOpen}
        onClose={() => setPrintModalState({ isOpen: false, items: [], config: null })}
        items={printModalState.items}
        offsetConfig={printModalState.config}
      />

      {/* 에이전트 스마트 자가 업데이트 모달 */}
      <AgentUpdateModal
        isOpen={isAgentUpdateOpen}
        onClose={() => setIsAgentUpdateOpen(false)}
        agentStatus={agentStatus}
        onUpdateSuccess={async () => {
          setToastMessage('에이전트가 최신 버전으로 업데이트 및 재시작되었습니다.');
          const status = await checkAgentLiveStatus();
          setAgentStatus(status);
          setTimeout(() => setToastMessage(null), 4000);
        }}
      />
    </div>
  );
}
