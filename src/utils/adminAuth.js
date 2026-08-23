/**
 * Admin Passcode & Gatekeeper Authentication Engine
 * System: Security Gatekeeper for Schema Builder & RPA Scenario Editor
 */
import { getDbClient } from './dbClient';

export const LOCAL_KEY_ADMIN_PASSCODE = 'IMAGE_SCAN_ADMIN_PASSCODE_V1';
export const SESSION_KEY_ADMIN_AUTH = 'IMAGE_SCAN_IS_ADMIN_SESSION_V1';
export const DEFAULT_ADMIN_PASSCODE = '0000';

/**
 * 저장된 관리자 비밀번호 조회
 */
export function getStoredAdminPasscode() {
  try {
    const stored = localStorage.getItem(LOCAL_KEY_ADMIN_PASSCODE);
    if (stored) return stored;
  } catch (e) {}
  return DEFAULT_ADMIN_PASSCODE;
}

/**
 * 현재 브라우저 세션의 관리자 인증 상태 확인
 */
export function isAdminAuthenticated() {
  try {
    const sessionAuth = sessionStorage.getItem(SESSION_KEY_ADMIN_AUTH);
    return sessionAuth === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * 관리자 비밀번호 검증 및 세션 승인
 */
export function verifyAdminPasscode(inputPasscode) {
  const currentPasscode = getStoredAdminPasscode();
  if (String(inputPasscode).trim() === String(currentPasscode).trim()) {
    try {
      sessionStorage.setItem(SESSION_KEY_ADMIN_AUTH, 'true');
    } catch (e) {}
    return { success: true };
  }
  return { success: false, message: '관리자 비밀번호가 일치하지 않습니다.' };
}

/**
 * 관리자 비밀번호 변경
 */
export async function updateAdminPasscode(oldPasscode, newPasscode) {
  const verify = verifyAdminPasscode(oldPasscode);
  if (!verify.success) {
    return { success: false, message: '현재 비밀번호가 일치하지 않습니다.' };
  }

  const cleanNew = String(newPasscode).trim();
  if (cleanNew.length < 4) {
    return { success: false, message: '새 비밀번호는 4자리 이상이어야 합니다.' };
  }

  try {
    localStorage.setItem(LOCAL_KEY_ADMIN_PASSCODE, cleanNew);
    sessionStorage.setItem(SESSION_KEY_ADMIN_AUTH, 'true');

    // DB 동기화
    const client = getDbClient();
    if (client) {
      await client.from('schema_definitions').upsert({
        id: 'admin_security_config',
        schema_name: '보안설정',
        data: { admin_passcode: cleanNew },
        updated_at: new Date().toISOString()
      });
    }

    return { success: true, message: '관리자 비밀번호가 정상 변경되었습니다.' };
  } catch (err) {
    return { success: true, message: '로컬 비밀번호가 변경되었습니다.' };
  }
}

/**
 * 관리자 세션 수동 잠금 (로그아웃)
 */
export function lockAdminSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY_ADMIN_AUTH);
  } catch (e) {}
}
