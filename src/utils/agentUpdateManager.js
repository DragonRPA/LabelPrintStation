/**
 * UBUS_DragonRPA_Agent 실시간 상태 감지 및 스마트 자가 업데이트 매니저 (SSOT)
 * - GitHub 원격 version.json 실시간 조회 기반
 */

export const DEFAULT_AGENT_PORT = 9988;
export const REMOTE_VERSION_JSON_URL = 'https://raw.githubusercontent.com/DragonRPA/LabelPrintStation/main/print-agent/version.json';
export const DEFAULT_UPDATE_EXE_URL = 'https://dragonrpa.github.io/LabelPrintStation/UBUS_DragonRPA_Agent.exe';

let cachedLatestRelease = null;
let lastVersionFetchTime = 0;

/**
 * ⭐️ GitHub 원격 저장소에서 실제 배포된 최신 에이전트 버전 실시간 조회
 */
export async function fetchLatestRemoteAgentVersion() {
  const now = Date.now();
  if (cachedLatestRelease && (now - lastVersionFetchTime < 60000)) {
    return cachedLatestRelease;
  }

  try {
    const res = await fetch(`${REMOTE_VERSION_JSON_URL}?t=${now}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      cachedLatestRelease = data;
      lastVersionFetchTime = now;
      return data;
    }
  } catch (e) {
    console.warn('원격 에이전트 버전 조회 실패 (기존 캐시 유지):', e);
  }

  return cachedLatestRelease || {
    version: 'v1.4',
    downloadUrl: DEFAULT_UPDATE_EXE_URL,
    releaseDate: '2026-08-15',
    releaseNotes: 'Windows 블루투스 1초 재연결 및 실제 프린터 실시간 스캔 탑재'
  };
}

/**
 * ⭐️ 로컬 PC 에이전트 실시간 실행 여부 및 버전 체크
 */
export async function checkAgentLiveStatus(port = DEFAULT_AGENT_PORT) {
  // 1. 원격 최신 버전 확인
  const remoteMeta = await fetchLatestRemoteAgentVersion();
  const latestRequiredVersion = remoteMeta.version || 'v1.4';

  // 2. 로컬 PC 실행 중인 에이전트 상태 확인
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let res = null;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/status`, {
        method: 'GET',
        signal: controller.signal
      });
    } catch (e1) {
      try {
        res = await fetch(`http://localhost:${port}/api/status`, {
          method: 'GET',
          signal: controller.signal
        });
      } catch (e2) {}
    }
    clearTimeout(timeoutId);

    if (res && res.ok) {
      const data = await res.json();
      const currentVersion = data.version || 'v1.0';
      const isOutdated = compareVersions(currentVersion, latestRequiredVersion) < 0;

      return {
        online: true,
        version: currentVersion,
        requiredVersion: latestRequiredVersion,
        isOutdated,
        agentId: data.agentId,
        printer: data.printer,
        todayCount: data.todayCount,
        downloadUrl: remoteMeta.downloadUrl || DEFAULT_UPDATE_EXE_URL,
        releaseNotes: remoteMeta.releaseNotes
      };
    }
  } catch (err) {
    // 오프라인 또는 연결 불가
  }

  return {
    online: false,
    version: null,
    requiredVersion: latestRequiredVersion,
    isOutdated: false,
    downloadUrl: remoteMeta.downloadUrl || DEFAULT_UPDATE_EXE_URL,
    releaseNotes: remoteMeta.releaseNotes
  };
}

/**
 * ⭐️ 에이전트 원클릭 스마트 자가 업데이트 트리거
 */
export async function triggerAgentSelfUpdate(port = DEFAULT_AGENT_PORT, updateUrl = DEFAULT_UPDATE_EXE_URL) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/self-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ updateUrl })
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, message: data.message || '에이전트 업데이트가 시작되었습니다.' };
    } else {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || `업데이트 요청 실패 (HTTP ${res.status})` };
    }
  } catch (err) {
    return {
      success: false,
      message: `에이전트 통신 실패: 로컬 PC의 에이전트(UBUS_DragonRPA_Agent.exe)가 실행 중인지 확인하세요.`
    };
  }
}

/**
 * 버전 비교 유틸리티 (v1.3 vs v1.4)
 */
export function compareVersions(v1, v2) {
  const clean1 = (v1 || '').replace(/[^0-9.]/g, '').split('.').map(Number);
  const clean2 = (v2 || '').replace(/[^0-9.]/g, '').split('.').map(Number);
  const maxLen = Math.max(clean1.length, clean2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = clean1[i] || 0;
    const num2 = clean2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}
