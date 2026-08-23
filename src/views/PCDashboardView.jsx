import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Printer,
  Sliders,
  RefreshCw,
  Layers,
  Settings,
  Play,
  Bot,
  Lock,
  Unlock,
  FileText,
  FolderOpen
} from 'lucide-react';
import DirectPrintTab from './DirectPrintTab';
import PCDashboard from '../components/PCDashboard';
import TempDataTab from './TempDataTab';
import LabelDesignerTab from './LabelDesignerTab';
import SchemaBuilderTab from './SchemaBuilderTab';
import RPADashboardTab from './RPADashboardTab';
import RPABuilderTab from './RPABuilderTab';
import AdminGatekeeperModal from '../components/AdminGatekeeperModal';
import DocViewerModal from '../components/DocViewerModal';
import { getDbClient } from '../utils/dbClient';

const STATUS_MAP = {
  PENDING:  { label: '대기중',    color: '#f59e0b', bg: '#451a03' },
  PRINTING: { label: '출력중',    color: '#60a5fa', bg: '#0c2340' },
  PRINTED:  { label: '출력완료',  color: '#4ade80', bg: '#052e16' },
  ERROR:    { label: '오류',      color: '#f87171', bg: '#3b0000' },
};

function PrintQueueMonitor() {
  const [queueItems, setQueueItems] = useState([]);
  const [stats, setStats] = useState({ PENDING: 0, PRINTING: 0, PRINTED: 0, ERROR: 0 });
  const [agentSeen, setAgentSeen] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef(null);

  const loadQueueData = async () => {
    const client = getDbClient();
    if (!client) { setIsLoading(false); return; }

    const { data, error } = await client
      .from('print_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) { setIsLoading(false); return; }

    setQueueItems(data || []);
    setIsLoading(false);

    const s = { PENDING: 0, PRINTING: 0, PRINTED: 0, ERROR: 0 };
    (data || []).forEach(row => { if (s[row.print_status] !== undefined) s[row.print_status]++; });
    setStats(s);

    const latestAgent = (data || []).find(r => r.agent_id)?.agent_id;
    if (latestAgent) setAgentSeen(latestAgent);
  };
const clearQueue = async () => {
  if (!window.confirm('큐를 모두 삭제하시겠습니까?')) return;
  const client = getDbClient();
  if (!client) { alert('DB 클라이언트 없음'); return; }
  const { error } = await client.from('print_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) { console.error(error); alert('프린트 큐 삭제 실패'); }
  else { alert('프린트 큐 삭제 완료'); loadQueueData(); }
};

  useEffect(() => {
    loadQueueData();

    const client = getDbClient();
    if (!client) return;

    const channel = client
      .channel('pc-dashboard-print-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'print_queue' }, () => {
        loadQueueData();
      })
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, []);

  const statItems = [
    { key: 'PENDING',  label: '대기' },
    { key: 'PRINTING', label: '출력중' },
    { key: 'PRINTED',  label: '완료' },
    { key: 'ERROR',    label: '오류' },
  ];

  return (
    <div style={{
      backgroundColor: '#1e293b',
      border: '1px solid #334155',
      borderRadius: '8px',
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.85rem' }}>
            프린트 큐 모니터
          </span>
          <span style={{
            fontSize: '0.65rem',
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: agentSeen ? '#052e16' : '#1c1917',
            color: agentSeen ? '#4ade80' : '#78716c',
            border: `1px solid ${agentSeen ? '#4ade80' : '#44403c'}`
          }}>
            {agentSeen ? `에이전트 연결됨: ${agentSeen}` : '에이전트 대기중'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {statItems.map(st => (
            <div
              key={st.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: STATUS_MAP[st.key].bg,
                border: `1px solid ${STATUS_MAP[st.key].color}44`,
                fontSize: '0.68rem',
                color: STATUS_MAP[st.key].color,
                fontWeight: 600
              }}
            >
              <span>{st.label}</span>
              <span style={{ fontWeight: 700 }}>{stats[st.key]}</span>
            </div>
          ))}
            <button
              onClick={loadQueueData}
              className="btn btn-outline"
              style={{ padding: '2px 6px', fontSize: '0.68rem', border: '1px solid #475569' }}
              title="새로고침"
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={clearQueue}
              className="btn btn-outline"
              style={{ padding: '2px 6px', fontSize: '0.68rem', border: '1px solid #475569', marginLeft: '4px' }}
              title="큐 삭제"
            >
              큐 삭제
            </button>
        </div>
      </div>

      <div style={{
        overflowX: 'auto',
        borderRadius: '4px',
        border: '1px solid #334155'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>상태</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>자산번호</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>시리얼번호</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>요청자</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>요청일시</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                  인쇄 대기열 조회 중...
                </td>
              </tr>
            ) : queueItems.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                  인쇄 대기열이 비어 있습니다.
                </td>
              </tr>
            ) : (
              queueItems.map(row => {
                const sInfo = STATUS_MAP[row.print_status] || { label: row.print_status, color: '#94a3b8', bg: '#1e293b' };
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: '#0f172a'
                    }}
                  >
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: sInfo.bg,
                        color: sInfo.color,
                        fontWeight: 600,
                        fontSize: '0.65rem'
                      }}>
                        {sInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#f8fafc', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.key_value || row.asset_no || '-'}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                      {row.serial_no || row.record_data?.serial_no || '-'}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {row.requested_by || '-'}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {row.created_at ? new Date(row.created_at).toLocaleTimeString() : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PCDashboardView({
  onError,
  onOpenExportModal,
  onOpenPrintModal,
  onOpenImportModal
}) {
  const [activeTab, setActiveTab] = useState('direct-print'); // 'direct-print' | 'data' | 'rpa-run' | 'designer' | 'queue' | 'rpa-builder' | 'schema'
  const [isAdmin, setIsAdmin] = useState(isAdminAuthenticated);
  const [docViewerOpen, setDocViewerOpen] = useState(false);

  // Admin Gatekeeper Modal State
  const [gatekeeperOpen, setGatekeeperOpen] = useState(false);
  const [pendingAdminTab, setPendingAdminTab] = useState(null);
  const [pendingFeatureName, setPendingFeatureName] = useState('');

  // 탭 클릭 핸들러 (관리자 탭 보호)
  const handleTabClick = (tabKey, featureName, isProtected = false) => {
    if (isProtected && !isAdminAuthenticated()) {
      setPendingAdminTab(tabKey);
      setPendingFeatureName(featureName);
      setGatekeeperOpen(true);
      return;
    }
    setActiveTab(tabKey);
  };

  const handleAdminAuthSuccess = () => {
    setIsAdmin(true);
    setGatekeeperOpen(false);
    if (pendingAdminTab) {
      setActiveTab(pendingAdminTab);
      setPendingAdminTab(null);
    }
  };

  const handleAdminLock = () => {
    lockAdminSession();
    setIsAdmin(false);
    if (activeTab === 'schema' || activeTab === 'rpa-builder') {
      setActiveTab('direct-print');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {/* Sub Navigation Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '4px 8px',
        flexWrap: 'wrap',
        gap: '4px'
      }}>
        {/* Left Sub Tabs */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* ⭐️ [첫 번째 메인 랜딩 탭] 라벨 즉시 출력 */}
          <button
            onClick={() => handleTabClick('direct-print', '라벨 즉시 출력', false)}
            className={`btn ${activeTab === 'direct-print' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 12px', fontWeight: 700, border: activeTab === 'direct-print' ? 'none' : '1px solid #38bdf8', color: activeTab === 'direct-print' ? '#fff' : '#38bdf8' }}
          >
            <Printer size={13} /> 라벨 즉시 출력
          </button>

          {/* 일반 실무 탭 */}
          <button
            onClick={() => handleTabClick('data', '데이터 목록', false)}
            className={`btn ${activeTab === 'data' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'data' ? 'none' : '1px solid #475569' }}
          >
            데이터 목록
          </button>
          <button
            onClick={() => handleTabClick('temp-data', '임시 데이터 관리', false)}
            className={`btn ${activeTab === 'temp-data' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'temp-data' ? 'none' : '1px solid #38bdf8', color: activeTab === 'temp-data' ? '#fff' : '#38bdf8', fontWeight: 600 }}
          >
            <FolderOpen size={12} /> 임시 데이터 관리
          </button>
          <button
            onClick={() => handleTabClick('designer', '라벨 서식 디자인', false)}
            className={`btn ${activeTab === 'designer' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'designer' ? 'none' : '1px solid #475569' }}
          >
            라벨 서식 디자인
          </button>
          <button
            onClick={() => handleTabClick('schema', '스키마 빌더', false)}
            className={`btn ${activeTab === 'schema' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'schema' ? 'none' : '1px solid #475569' }}
          >
            <Database size={12} /> 스키마 빌더
          </button>
          <button
            onClick={() => handleTabClick('queue', '프린트 큐 모니터', false)}
            className={`btn ${activeTab === 'queue' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'queue' ? 'none' : '1px solid #475569' }}
          >
            프린트 큐 모니터
          </button>
          <button
            onClick={() => handleTabClick('rpa-run', 'RPA 실행', false)}
            className={`btn ${activeTab === 'rpa-run' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: activeTab === 'rpa-run' ? 'none' : '1px solid #475569' }}
          >
            <Play size={12} /> RPA 실행
          </button>

          {/* 관리자 전용 탭 */}
          <div style={{ height: '16px', width: '1px', backgroundColor: '#475569', margin: '0 4px' }} />

          <button
            onClick={() => handleTabClick('rpa-builder', 'RPA 시나리오 편집기', true)}
            className={`btn ${activeTab === 'rpa-builder' ? 'btn-primary' : 'btn-outline'}`}
            style={{
              fontSize: '0.75rem',
              padding: '4px 10px',
              border: activeTab === 'rpa-builder' ? 'none' : '1px solid #f59e0b44',
              color: activeTab === 'rpa-builder' ? '#000' : '#f59e0b',
              backgroundColor: activeTab === 'rpa-builder' ? '#f59e0b' : 'transparent'
            }}
          >
            <Bot size={12} /> RPA 시나리오 편집
          </button>
        </div>

        {/* Right Admin Lock Status & Doc Viewer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setDocViewerOpen(true)}
            className="btn btn-outline"
            style={{ fontSize: '0.68rem', padding: '2px 8px', borderColor: '#475569', color: '#94a3b8' }}
            title="기능 명세서 및 매뉴얼"
          >
            <FileText size={11} /> 문서 / 매뉴얼
          </button>

          {isAdmin ? (
            <button
              onClick={handleAdminLock}
              className="btn btn-outline"
              style={{ fontSize: '0.68rem', padding: '2px 8px', borderColor: '#f59e0b', color: '#f59e0b' }}
              title="관리자 세션 잠금"
            >
              <Unlock size={12} /> 관리자 모드 (클릭 시 잠금)
            </button>
          ) : (
            <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Lock size={11} /> 일반 사용자 모드
            </span>
          )}
        </div>
      </div>

      {/* ── 탭별 본문 렌더링 ──────────────────────────────────────── */}

      {/* Tab 0: 라벨 즉시 출력 (메인 랜딩 탭) */}
      {activeTab === 'direct-print' && (
        <DirectPrintTab
          onError={onError}
          onOpenPrintModal={onOpenPrintModal}
        />
      )}

      {/* Tab 1: 데이터 목록 (정규 자산) */}
      {activeTab === 'data' && (
        <PCDashboard
          onError={onError}
          onOpenExportModal={onOpenExportModal}
          onOpenPrintModal={onOpenPrintModal}
          onOpenImportModal={onOpenImportModal}
        />
      )}

      {/* Tab 2: 임시 데이터 관리 (temp_asset) */}
      {activeTab === 'temp-data' && (
        <TempDataTab
          onError={onError}
          onOpenPrintModal={onOpenPrintModal}
        />
      )}

      {/* Tab 2: RPA 실행 컨트롤러 */}
      {activeTab === 'rpa-run' && (
        <RPADashboardTab onError={onError} />
      )}

      {/* Tab 3: 라벨 서식 디자인 */}
      {activeTab === 'designer' && (
        <LabelDesignerTab
          onError={onError}
          onOpenPrintModal={(items) => onOpenPrintModal && onOpenPrintModal(items)}
        />
      )}

      {/* Tab 4: 프린트 큐 모니터 */}
      {activeTab === 'queue' && (
        <PrintQueueMonitor />
      )}

      {/* Tab 5: RPA 시나리오 편집기 (관리자 보호) */}
      {activeTab === 'rpa-builder' && (
        <RPABuilderTab onError={onError} />
      )}

      {/* Tab 6: 스키마 빌더 (관리자 보호) */}
      {activeTab === 'schema' && (
        <SchemaBuilderTab
          onError={onError}
          onSchemaUpdated={() => {}}
        />
      )}

      {/* 관리자 인증 모달 */}
      <AdminGatekeeperModal
        isOpen={gatekeeperOpen}
        targetFeatureName={pendingFeatureName}
        onClose={() => {
          setGatekeeperOpen(false);
          setPendingAdminTab(null);
        }}
        onSuccess={handleAdminAuthSuccess}
      />

      {/* 문서 및 매뉴얼 뷰어 모달 */}
      <DocViewerModal
        isOpen={docViewerOpen}
        onClose={() => setDocViewerOpen(false)}
      />
    </div>
  );
}
