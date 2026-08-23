import React, { useState } from 'react';
import { Bot, RefreshCw, CheckCircle, AlertTriangle, X, Download, ExternalLink, Sparkles, ShieldCheck } from 'lucide-react';
import { triggerAgentSelfUpdate, DEFAULT_UPDATE_EXE_URL } from '../utils/agentUpdateManager';

export default function AgentUpdateModal({ isOpen, onClose, agentStatus, onUpdateSuccess }) {
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [countdown, setCountdown] = useState(0);

  if (!isOpen) return null;

  const handleStartUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);

    const res = await triggerAgentSelfUpdate();
    setUpdating(false);
    setUpdateResult(res);

    if (res.success) {
      let left = 4;
      setCountdown(left);
      const timer = setInterval(() => {
        left -= 1;
        setCountdown(left);
        if (left <= 0) {
          clearInterval(timer);
          if (onUpdateSuccess) onUpdateSuccess();
          onClose();
        }
      }, 1000);
    }
  };

  const downloadUrl = agentStatus?.downloadUrl || DEFAULT_UPDATE_EXE_URL;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '560px', backgroundColor: '#0f172a', border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8' }}>
            <Bot size={22} />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>에이전트 스마트 자가 업데이트</h3>
          </div>
          <button className="btn btn-outline" style={{ padding: '4px 8px' }} onClick={onClose} disabled={updating}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          {/* 버전 상태 카드 */}
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ color: '#94a3b8' }}>현재 실행 중인 에이전트:</span>
              <strong style={{ color: agentStatus?.online ? '#f87171' : '#94a3b8' }}>
                {agentStatus?.online ? (agentStatus?.version || 'v1.0') : '미실행 (오프라인)'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ color: '#94a3b8' }}>GitHub 최신 릴리즈 버전:</span>
              <strong style={{ color: '#4ade80' }}>{agentStatus?.requiredVersion || 'v1.4'}</strong>
            </div>
            {agentStatus?.releaseNotes && (
              <div style={{ fontSize: '0.78rem', color: '#38bdf8', marginTop: '4px', borderTop: '1px solid #334155', paddingTop: '6px' }}>
                ✨ <strong>주요 변경사항:</strong> {agentStatus.releaseNotes}
              </div>
            )}
          </div>

          {/* 업데이트 안내 & 전자서명 보안 안내 */}
          <div style={{
            fontSize: '0.8rem',
            color: '#cbd5e1',
            lineHeight: 1.5,
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            padding: '10px 12px',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div>
              ℹ️ <strong>원클릭 업데이트 작동 방식:</strong><br />
              1. 에이전트가 GitHub에서 최신 <code>UBUS_DragonRPA_Agent.exe</code>를 다운로드합니다.<br />
              2. 사내 디지털 전자서명이 날인되어 기존 프로세스를 안전하게 1초 만에 교체/재실행합니다.<br />
              3. 기존 프린터 IP 및 DB 설정은 100% 그대로 유지됩니다.
            </div>
            <div style={{
              marginTop: '4px',
              paddingTop: '6px',
              borderTop: '1px solid rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px'
            }}>
              <span style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={14} style={{ color: '#38bdf8' }} />
                윈도우 스마트스크린/보안 차단 발생 시:
              </span>
              <a
                href="https://dragonrpa.github.io/LabelPrintStation/보안인증서_원클릭설치.bat"
                download="보안인증서_원클릭설치.bat"
                className="btn btn-outline"
                style={{ fontSize: '0.72rem', padding: '2px 8px', color: '#38bdf8', borderColor: '#38bdf8', textDecoration: 'none' }}
                title="클라이언트 PC에 DragonRPA 보안 인증서를 1초 만에 등록합니다"
              >
                보안인증서 원클릭 등록 (.bat)
              </a>
            </div>
          </div>

          {/* 결과 메시지 */}
          {updateResult && (
            <div style={{
              padding: '12px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              backgroundColor: updateResult.success ? '#052e16' : '#450a0a',
              border: `1px solid ${updateResult.success ? '#166534' : '#991b1b'}`,
              color: updateResult.success ? '#86efac' : '#fca5a5'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                {updateResult.success ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>{updateResult.message}</span>
              </div>
              {updateResult.success && countdown > 0 && (
                <div style={{ fontSize: '0.78rem', color: '#4ade80' }}>
                  ⏳ {countdown}초 후 에이전트 재시작 및 화면 자동 동기화가 완료됩니다...
                </div>
              )}
              {!updateResult.success && (
                <div style={{ fontSize: '0.75rem', color: '#fca5a5', marginTop: '4px' }}>
                  💡 구버전 에이전트는 자가 업데이트 API가 없을 수 있습니다. 아래 [직접 다운로드] 버튼으로 최신 exe를 받아 덮어써주세요.
                </div>
              )}
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <a
            href={downloadUrl}
            download="UBUS_DragonRPA_Agent.exe"
            className="btn btn-outline"
            style={{ fontSize: '0.78rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', borderColor: '#475569', color: '#94a3b8' }}
            title="GitHub에서 최신 서명된 exe 파일을 직접 다운로드합니다"
          >
            <Download size={13} /> 최신 exe 직접 다운로드
          </a>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={updating}>
              닫기
            </button>
            <button
              className="btn btn-primary"
              onClick={handleStartUpdate}
              disabled={updating || countdown > 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0284c7', borderColor: '#0284c7', fontWeight: 700 }}
            >
              {updating ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
              {updating ? '다운로드 및 교체 재실행 중...' : (countdown > 0 ? `재접속 대기중 (${countdown}s)` : '원클릭 스마트 자가 업데이트')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
