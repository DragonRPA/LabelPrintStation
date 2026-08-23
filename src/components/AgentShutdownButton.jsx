import React, { useState } from 'react';
import { Power } from 'lucide-react';

export default function AgentShutdownButton({ onShutdown, isOnline = true }) {
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  const handleClick = async () => {
    if (!window.confirm('실행 중인 에이전트(UBUS_DragonRPA_Agent.exe)를 종료하시겠습니까?')) {
      return;
    }

    setIsShuttingDown(true);
    let success = false;

    // 127.0.0.1 및 localhost 순차 시도
    const endpoints = [
      'http://127.0.0.1:9988/api/agent/shutdown',
      'http://localhost:9988/api/agent/shutdown',
      'http://127.0.0.1:9988/api/shutdown',
      'http://localhost:9988/api/shutdown'
    ];

    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'shutdown' }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          success = true;
          break;
        }
      } catch (e) {
        // 다음 엔드포인트 시도
      }
    }

    setIsShuttingDown(false);

    if (success) {
      alert('에이전트가 정상적으로 종료되었습니다.');
      if (onShutdown) onShutdown();
    } else {
      alert('에이전트 종료 요청 실패: 에이전트가 이미 종료되었거나 응답하지 않습니다.');
      if (onShutdown) onShutdown();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isShuttingDown}
      className="btn btn-outline"
      style={{
        padding: '4px 8px',
        fontSize: '0.72rem',
        borderColor: '#ef4444',
        color: '#f87171',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: isShuttingDown ? 'wait' : 'pointer'
      }}
      title="실행 중인 로컬 에이전트 프로세스 즉시 종료"
    >
      <Power size={13} />
      {isShuttingDown ? '종료 처리중' : '에이전트 끄기'}
    </button>
  );
}
