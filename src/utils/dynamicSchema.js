/**
 * Universal Dynamic Schema & Record Engine (SSOT)
 * System: Universal Dynamic Schema, Scan Queue & Label Pipeline
 */
import { getDbClient } from './dbClient.js';

export const LOCAL_KEY_SCHEMA_DEF = 'IMAGE_SCAN_UNIVERSAL_SCHEMA_DEF_V1';

/**
 * ⭐️ 콤마(,)로 연결된 표시명 중 첫 번째 주된 표시명(Main Label) 추출
 * 예: '자산번호, 자산_번호, AssetNo' -> '자산번호'
 */
export function getMainFieldName(fieldOrName) {
  if (!fieldOrName) return '';
  const rawName = typeof fieldOrName === 'string' ? fieldOrName : (fieldOrName.name || fieldOrName.id || '');
  if (!rawName) return '';
  const firstPart = rawName.split(',')[0];
  return firstPart ? firstPart.trim() : rawName.trim();
}

/**
 * ⭐️ 필드의 모든 식별 가능한 별칭(Aliases) 목록 추출
 * 콤마로 연결된 모든 텍스트 + 영문 필드 ID를 정규화하여 반환
 */
export function getFieldAliases(field) {
  if (!field) return [];
  const aliases = new Set();
  if (field.id) aliases.add(String(field.id).trim().toLowerCase());

  if (field.name) {
    String(field.name).split(',').forEach(part => {
      const trimmed = part.trim();
      if (trimmed) {
        aliases.add(trimmed.toLowerCase());
        aliases.add(trimmed.toLowerCase().replace(/[\s_\-]/g, '')); // 공백 및 언더바 제거 버전도 매핑
      }
    });
  }
  return Array.from(aliases);
}

/**
 * ⭐️ 엑셀 헤더명 또는 입력 텍스트를 스키마의 정확한 field.id로 매핑
 */
export function resolveFieldId(headerName, fields = []) {
  if (!headerName || !Array.isArray(fields) || fields.length === 0) return headerName;
  const normalized = String(headerName).trim().toLowerCase();
  const normalizedNoSpaces = normalized.replace(/[\s_\-]/g, '');

  for (const field of fields) {
    if (field.id && field.id.toLowerCase() === normalized) return field.id;
    const aliases = getFieldAliases(field);
    if (aliases.includes(normalized) || aliases.includes(normalizedNoSpaces)) {
      return field.id;
    }
  }
  return headerName;
}

// ── 자산(asset) 정규 스키마 정의 (SSOT) ──────────────────────────────────
export const DEFAULT_SCHEMA_DEF = {
  id: 'asset_schema',
  schema_name: '자산 관리 정규 스키마 (asset)',
  key_field: 'asset_no',
  key_field_name: '자산번호',
  table_version: 1,
  fields: [
    {
      id: 'asset_no',
      name: '자산번호',
      type: 'VARCHAR',
      length: 50,
      isKey: true,
      isRequired: true,
      isBarcodeTarget: true,
      order: 1
    },
    {
      id: 'category_major',
      name: '대분류',
      type: 'VARCHAR',
      length: 20,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 2
    },
    {
      id: 'product_name',
      name: '제품명',
      type: 'VARCHAR',
      length: 100,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 3
    },
    {
      id: 'model_name',
      name: '모델명',
      type: 'VARCHAR',
      length: 100,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 4
    },
    {
      id: 'serial_no',
      name: '제조번호(시리얼)',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: true,
      order: 5
    },
    {
      id: 'asset_status',
      name: '자산상태',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 6
    },
    {
      id: 'earning_ratio',
      name: '회수율',
      type: 'NUMERIC(5,1)',
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 7
    },
    {
      id: 'shelf_no',
      name: '선반번호',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 8
    },
    {
      id: 'asset_option',
      name: '옵션',
      type: 'VARCHAR',
      length: 100,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 9
    },
    {
      id: 'calibration_date',
      name: '교정일자',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 10
    },
    {
      id: 'mac_wlan',
      name: 'MAC wlan',
      type: 'VARCHAR',
      length: 30,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 11
    },
    {
      id: 'mac_lan',
      name: 'MAC lan',
      type: 'VARCHAR',
      length: 30,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 12
    },
    {
      id: 'imei',
      name: 'IMEI',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: true,
      order: 13
    },
    {
      id: 'components',
      name: '구성요소(사양)',
      type: 'VARCHAR',
      length: 255,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 14
    },
    {
      id: 'remark',
      name: '비고',
      type: 'VARCHAR',
      length: 255,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 15
    }
  ]
};

// ── 임시자산(temp_asset) 정규 스키마 정의 (SSOT) ─────────────────────────
export const TEMP_ASSET_SCHEMA_DEF = {
  id: 'temp_asset_schema',
  table_name: 'temp_asset',
  schema_name: '임시 자산 (temp_asset)',
  key_field: 'asset_no',
  key_field_name: '임시자산번호',
  table_version: 1,
  fields: [
    {
      id: 'asset_no',
      name: '임시자산번호',
      type: 'VARCHAR',
      length: 50,
      isKey: true,
      isRequired: true,
      isBarcodeTarget: true,
      order: 1
    },
    {
      id: 'product_name',
      name: '제품명',
      type: 'VARCHAR',
      length: 100,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 2
    },
    {
      id: 'category',
      name: '분류',
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 3
    },
    {
      id: 'remark',
      name: '비고',
      type: 'VARCHAR',
      length: 255,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: false,
      order: 4
    }
  ]
};

export const LOCAL_KEY_TEMP_ASSET_SCHEMA = 'IMAGE_SCAN_TEMP_ASSET_SCHEMA_DEF_V1';

// ── 지원 테이블 카탈로그 (SSOT: asset, temp_asset) ────────────────────────
export const SUPPORTED_TABLES = [
  { id: 'asset', name: '자산 관리 (asset)', schema: DEFAULT_SCHEMA_DEF },
  { id: 'temp_asset', name: '임시 자산 (temp_asset)', schema: TEMP_ASSET_SCHEMA_DEF }
];

export function getTableSchema(tableId = 'asset') {
  if (tableId === 'temp_asset') {
    try {
      const stored = localStorage.getItem(LOCAL_KEY_TEMP_ASSET_SCHEMA);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.fields) && parsed.key_field) return parsed;
      }
    } catch (e) {}
    return TEMP_ASSET_SCHEMA_DEF;
  }
  return DEFAULT_SCHEMA_DEF;
}

/**
 * ⭐️ 비동기 원격 DB 및 로컬 스키마 통합 조회 (Supabase schema_definitions 1:1 직접 바인딩)
 */
export async function fetchTableSchema(tableId = 'temp_asset') {
  const localKey = tableId === 'temp_asset' ? LOCAL_KEY_TEMP_ASSET_SCHEMA : LOCAL_KEY_SCHEMA_DEF;

  const client = getDbClient();
  if (!client) return getTableSchema(tableId);

  try {
    // 1. schema_definitions 테이블에서 활성 스키마 조회 (temp_asset_schema 또는 main_schema 또는 첫 번째 레코드)
    let schemaRow = null;

    const { data: specificData } = await client
      .from('schema_definitions')
      .select('*')
      .in('id', [tableId === 'temp_asset' ? 'temp_asset_schema' : 'asset_schema', 'main_schema'])
      .limit(2);

    if (specificData && specificData.length > 0) {
      schemaRow = specificData.find(r => r.id === (tableId === 'temp_asset' ? 'temp_asset_schema' : 'asset_schema')) || specificData[0];
    } else {
      // 아무 ID나 첫 번째 레코드 가져오기
      const { data: firstData } = await client
        .from('schema_definitions')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (firstData) schemaRow = firstData;
    }

    if (schemaRow && Array.isArray(schemaRow.fields) && schemaRow.fields.length > 0) {
      const schemaDef = {
        id: schemaRow.id,
        table_name: tableId,
        schema_name: schemaRow.schema_name || '임시 자산 스키마',
        key_field: schemaRow.key_field || 'imei',
        key_field_name: schemaRow.key_field_name || (schemaRow.fields.find(f => f.id === schemaRow.key_field)?.name || '식별키'),
        table_version: schemaRow.table_version || 1,
        fields: schemaRow.fields
      };
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(localKey, JSON.stringify(schemaDef));
      }
      return schemaDef;
    }
  } catch (err) {
    console.warn(`[${tableId}] 원격 스키마 조회 실패 (로컬 사용):`, err);
  }

  // 로컬 스토리지 캐시
  try {
    const stored = localStorage.getItem(localKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Array.isArray(parsed.fields) && parsed.fields.length > 0) return parsed;
    }
  } catch (e) {}

  return getTableSchema(tableId);
}

/**
 * ⭐️ 스키마 정의 DB 및 로컬 영구 저장
 */
export async function saveTableSchema(tableId, schemaDef) {
  const schemaId = 'main_schema';
  const localKey = tableId === 'temp_asset' ? LOCAL_KEY_TEMP_ASSET_SCHEMA : LOCAL_KEY_SCHEMA_DEF;

  const normalized = {
    ...schemaDef,
    id: schemaId,
    table_name: tableId,
    updated_at: new Date().toISOString()
  };

  try {
    localStorage.setItem(localKey, JSON.stringify(normalized));
  } catch (e) {}

  const client = getDbClient();
  if (!client) return { success: true, message: '로컬 스키마 저장 완료' };

  try {
    const { error } = await client.from('schema_definitions').upsert({
      id: schemaId,
      schema_name: normalized.schema_name || '임시 자산 스키마',
      key_field: normalized.key_field || 'imei',
      key_field_name: normalized.key_field_name || '식별키',
      fields: normalized.fields || [],
      table_version: (normalized.table_version || 1) + 1,
      updated_at: new Date().toISOString()
    });

    if (error) throw error;
    return { success: true, message: '온라인 DB 스키마 저장 완료' };
  } catch (err) {
    console.warn('DB 스키마 저장 실패 (로컬 보존):', err);
    return { success: true, localOnly: true, message: `로컬 스키마 저장 완료 (DB: ${err.message})` };
  }
}

/**
 * 하위 호환성 헬퍼
 */
export async function fetchActiveSchema() {
  return fetchTableSchema('temp_asset');
}

export function getLocalSchemaDef() {
  return getTableSchema('temp_asset');
}

/**
 * DDL 스키마 패치 실행 (Supabase RPC 및 테이블 동기화)
 */
export async function applySchemaPatch(schemaDef, resetData = false) {
  const client = getDbClient();
  saveLocalSchemaDef(schemaDef);

  if (!client) {
    return { success: true, message: '로컬 스키마 저장 완료 (DB 미연결)' };
  }

  try {
    // 1. RPC 함수 exec_schema_patch 호출 시도
    const { data, error } = await client.rpc('exec_schema_patch', {
      p_schema_id: schemaDef.id || 'main_schema',
      p_schema_name: schemaDef.schema_name || '기본 자산 스키마',
      p_key_field: schemaDef.key_field,
      p_key_field_name: schemaDef.key_field_name,
      p_fields: schemaDef.fields,
      p_reset_data: Boolean(resetData)
    });

    if (!error && data?.success) {
      return { success: true, message: 'DB 스키마 DDL 패치 및 테이블 동기화 완료' };
    }

    // 2. RPC 실패 시 테이블 직접 UPSERT 폴백
    const { error: upsertErr } = await client.from('schema_definitions').upsert({
      id: schemaDef.id || 'main_schema',
      schema_name: schemaDef.schema_name,
      key_field: schemaDef.key_field,
      key_field_name: schemaDef.key_field_name,
      fields: schemaDef.fields,
      updated_at: new Date().toISOString()
    });

    if (upsertErr) throw upsertErr;

    if (resetData) {
      await client.from('print_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await client.from('scan_records').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    return { success: true, message: '스키마 정의 저장 완료' };
  } catch (err) {
    const errMsg = err.message || '';
    if (errMsg.includes('schema_definitions') || errMsg.includes('schema cache') || errMsg.includes('404')) {
      return {
        success: true,
        localOnly: true,
        message: '로컬 스키마 저장 완료 (원격 DB 테이블 미생성 - 상단 [DDL 복사] 후 Supabase SQL Editor에서 1회 실행 필요)'
      };
    }
    console.error('스키마 패치 오류:', err);
    throw new Error(`스키마 패치 실패: ${errMsg}`);
  }
}

/**
 * 동적 레코드 전체 목록 조회 (scan_records)
 */
export async function fetchScanRecords(limit = 500) {
  const client = getDbClient();
  if (!client) return [];

  try {
    // 1. scan_records 시도
    const { data, error } = await client
      .from('scan_records')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(limit);

    if (!error && data && data.length > 0) {
      return data.map(r => ({
        id: r.id,
        key_value: r.key_value,
        scan_status: r.scan_status,
        scanned_at: r.scanned_at,
        ...r.data
      }));
    }

    // 2. scan_records가 비어있을 때 imei_scans 호환 폴백
    const { data: oldData, error: oldErr } = await client
      .from('imei_scans')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(limit);

    if (!oldErr && oldData) {
      return oldData.map(r => ({
        id: r.id,
        key_value: r.asset_no || r.imei,
        scan_status: r.status,
        scanned_at: r.scanned_at,
        asset_no: r.asset_no,
        imei: r.imei,
        serial_no: r.serial_no,
        mac_address: r.mac_address
      }));
    }

    return [];
  } catch (err) {
    console.warn('레코드 목록 조회 오류:', err);
    return [];
  }
}

/**
 * 동적 레코드 단건 저장 (모바일 스캐너 및 수기 입력)
 */
export async function saveScanRecord(keyValue, recordData, status = 'SCANNED') {
  const client = getDbClient();
  if (!client) throw new Error('DB 클라이언트가 초기화되지 않았습니다.');
  if (!keyValue) throw new Error('키 인덱스 값이 필요합니다.');

  const payload = {
    key_value: String(keyValue).trim(),
    data: recordData,
    scan_status: status,
    scanned_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from('scan_records')
    .upsert(payload, { onConflict: 'key_value' })
    .select()
    .single();

  if (error) {
    // scan_records 테이블이 없으면 imei_scans에 폴백
    await client.from('imei_scans').upsert({
      asset_no: recordData.asset_no || keyValue,
      imei: recordData.imei || keyValue,
      mac_address: recordData.mac_address || '',
      serial_no: recordData.serial_no || '',
      status: status,
      scanned_at: new Date().toISOString()
    });
    return { key_value: keyValue, ...recordData };
  }

  return { id: data.id, key_value: data.key_value, ...data.data };
}
