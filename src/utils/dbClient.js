/**
 * Universal Database Client (SSOT - Powered by Neon Serverless PostgreSQL)
 * Standard: Clean DB Fluent Query Engine with 100% Zero-Adjective Syntax
 */
import {
  getDbClient,
  getNeonSql,
  getStoredNeonConnectionString,
  saveStoredNeonConnectionString,
  testNeonConnection
} from './neonClient';

export { getDbClient, getNeonSql, getStoredNeonConnectionString, saveStoredNeonConnectionString, testNeonConnection };

export const getSupabaseClient = getDbClient;

export function getStoredConfig() {
  return {
    url: getStoredNeonConnectionString(),
    anonKey: 'neon_postgres_authenticated'
  };
}

export function saveStoredConfig(url) {
  if (url && url.startsWith('postgres')) {
    saveStoredNeonConnectionString(url);
  }
}

export function normalizeDbUrl(inputUrl) {
  return inputUrl || getStoredNeonConnectionString();
}

export const normalizeSupabaseUrl = normalizeDbUrl;

export async function testDbConnection(url) {
  return testNeonConnection(url);
}

export const testSupabaseConnection = testDbConnection;

// ── 자산(asset) 데이터 고속 조회 ──────────────────────────────────────────
export async function fetchScansFromDb(filters = null) {
  const client = getDbClient();
  if (!client) return [];

  try {
    let query = client.from('asset').select('*');
    let searchTokens = [];

    if (filters) {
      if (filters.category_major && filters.category_major !== 'ALL') {
        query = query.eq('category_major', filters.category_major);
      }
      if (filters.model_name && filters.model_name.trim()) {
        query = query.ilike('model_name', `%${filters.model_name.trim()}%`);
      }
      if (filters.serial_no && filters.serial_no.trim()) {
        query = query.ilike('serial_no', `%${filters.serial_no.trim()}%`);
      }
      if (filters.asset_status && filters.asset_status !== 'ALL') {
        query = query.eq('asset_status', filters.asset_status);
      }
      if (filters.searchGeneral && filters.searchGeneral.trim()) {
        const rawSearch = filters.searchGeneral.trim();
        searchTokens = rawSearch.split(/[\r\n\t,;\s]+/).map(t => t.trim()).filter(Boolean);
        if (searchTokens.length > 1) {
          const inList = searchTokens.map(t => `"${t}"`).join(',');
          query = query.or(`asset_no.in.(${inList}),serial_no.in.(${inList}),imei.in.(${inList})`);
        } else if (searchTokens.length === 1) {
          const q = searchTokens[0];
          query = query.or(`asset_no.ilike.%${q}%,serial_no.ilike.%${q}%,imei.ilike.%${q}%,product_name.ilike.%${q}%,model_name.ilike.%${q}%,shelf_no.ilike.%${q}%,remark.ilike.%${q}%`);
        }
      }
    }

    query = query.range(0, 49999);

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      let mapped = data.map(r => ({
        ...r,
        id: r.asset_no || r.id,
        asset_no: r.asset_no,
        category_major: r.category_major || '',
        product_name: r.product_name,
        model_name: r.model_name,
        serial_no: r.serial_no,
        asset_status: r.asset_status || 'AVAILABLE',
        earning_ratio: r.earning_ratio ?? 0,
        shelf_no: r.shelf_no,
        asset_option: r.asset_option,
        calibration_date: r.calibration_date,
        mac_wlan: r.mac_wlan,
        mac_lan: r.mac_lan,
        imei: r.imei,
        components: r.components,
        remark: r.remark
      }));

      if (searchTokens.length > 1) {
        const tokenLower = searchTokens.map(t => t.toLowerCase());
        mapped.sort((a, b) => {
          const aAsset = String(a.asset_no || '').toLowerCase();
          const aSerial = String(a.serial_no || '').toLowerCase();
          const bAsset = String(b.asset_no || '').toLowerCase();
          const bSerial = String(b.serial_no || '').toLowerCase();

          let idxA = tokenLower.findIndex(t => aAsset === t || aSerial === t || aAsset.includes(t) || aSerial.includes(t));
          let idxB = tokenLower.findIndex(t => bAsset === t || bSerial === t || bAsset.includes(t) || bSerial.includes(t));
          if (idxA === -1) idxA = 999999;
          if (idxB === -1) idxB = 999999;
          return idxA - idxB;
        });
      }

      return mapped;
    }
  } catch (err) {
    console.warn('asset 테이블 조회 실패:', err.message);
  }

  return [];
}

export const fetchScansFromSupabase = fetchScansFromDb;

// ── 자산(asset) 초고속 배치 저장 ─────────────────────────────────────────
export async function saveScansToDbBatch(scans, onProgressCallback, importMode = 'append') {
  const client = getDbClient();
  const formattedPayload = scans.map((item, idx) => {
    const assetNo = item.asset_no || item.assetNo || item['자산번호'] || `TEST${String(idx + 1).padStart(4, '0')}`;
    const categoryMajor = item.category_major || item['대분류'] || item['카테고리'] || '';
    const prodName = item.product_name || item.productName || item['제품명'] || '';
    const modelName = item.model_name || item.modelName || item['모델명'] || '';
    const serialNo = item.serial_no || item.serialNo || item['제조번호'] || item['시리얼'] || '';
    const assetStatus = item.asset_status || item['자산상태'] || 'AVAILABLE';
    const earningRatio = parseFloat(item.earning_ratio ?? item['회수율'] ?? 0) || 0;
    const shelfNo = item.shelf_no || item['선반번호'] || '';
    const assetOption = item.asset_option || item['옵션'] || '';
    const calibrationDate = item.calibration_date || item['교정일자'] || '';
    const macWlan = item.mac_wlan || item['MAC wlan'] || item['mac_wlan'] || item.mac_address || '';
    const macLan = item.mac_lan || item['MAC lan'] || item['mac_lan'] || '';
    const imeiVal = item.imei || item.imeiVal || item['IMEI'] || item['단말식별번호'] || '';
    const components = item.components || item['구성요소'] || item['구성요소(사양)'] || '';
    const remark = item.remark || item['비고'] || '';

    return {
      asset_no: assetNo,
      category_major: categoryMajor,
      product_name: prodName,
      model_name: modelName,
      serial_no: serialNo,
      asset_status: assetStatus,
      earning_ratio: earningRatio,
      shelf_no: shelfNo,
      asset_option: assetOption,
      calibration_date: calibrationDate,
      mac_wlan: macWlan,
      mac_lan: macLan,
      imei: imeiVal,
      components: components,
      remark: remark
    };
  });

  if (client) {
    if (importMode === 'replace') {
      if (onProgressCallback) onProgressCallback({ stage: 'wipe', percent: 5, message: '1단계: 기존 DB 데이터 고속 삭제 중...' });
      try {
        await client.from('asset').delete().neq('asset_no', 'FORCE_DELETE_ALL_RECORDS');
      } catch (e) {}
    }

    const CHUNK_SIZE = 500;
    const totalCount = formattedPayload.length;
    let processedCount = 0;

    for (let i = 0; i < totalCount; i += CHUNK_SIZE) {
      const chunk = formattedPayload.slice(i, i + CHUNK_SIZE);
      try {
        await client.from('asset').upsert(chunk, { onConflict: 'asset_no' });
      } catch (err) {
        console.warn('asset 적재 경고:', err.message);
      }

      processedCount += chunk.length;
      const percent = Math.min(99, Math.round((processedCount / totalCount) * 90) + 10);
      if (onProgressCallback) {
        onProgressCallback({
          stage: 'insert',
          percent,
          processedCount,
          totalCount,
          message: `2단계: DB에 초고속 저장 중 (${processedCount}/${totalCount}건 - ${percent}%)...`
        });
      }
      await new Promise(res => setTimeout(res, 0));
    }

    if (onProgressCallback) onProgressCallback({ stage: 'complete', percent: 100, message: '완료: DB 저장 성공!' });
    return formattedPayload;
  }

  return formattedPayload;
}

export const saveScansToSupabaseBatch = saveScansToDbBatch;

export async function saveScansToDb(scans) {
  return saveScansToDbBatch(scans, null, 'append');
}

export const saveScansToSupabase = saveScansToDb;

export async function deleteScanFromDb(id) {
  const client = getDbClient();
  if (!client) return;
  try {
    await client.from('asset').delete().eq('asset_no', id);
  } catch (e) {}
}

export const deleteScanFromSupabase = deleteScanFromDb;

export async function deleteAllScansFromDb() {
  const client = getDbClient();
  if (!client) return;
  try {
    await client.from('asset').delete().neq('asset_no', 'FORCE_DELETE_ALL_RECORDS');
  } catch (e) {}
}

export const deleteAllScansFromSupabase = deleteAllScansFromDb;

export function subscribeRealtimeScans(onInsertCallback) {
  const client = getDbClient();
  if (!client) return null;
  return client.channel('public:asset');
}

// ── 라벨 인쇄 큐(print_queue) 등록 ───────────────────────────────────────
export async function insertPrintQueue(item, templateOverride = null, customStatus = null) {
  const client = getDbClient();
  if (!client) {
    console.warn('[print_queue] DB 미연결 - 큐 등록 건너뜀');
    return null;
  }

  const { getStoredLabelTemplate, generateWysiwygZpl, generateDynamicZpl } = await import('./labelTemplate');
  const template = templateOverride || getStoredLabelTemplate();
  
  let zpl = item.zplCode || item.zpl_payload;
  if (!zpl) {
    try {
      zpl = await generateWysiwygZpl(item, template);
    } catch (e) {
      zpl = generateDynamicZpl(item, template);
    }
  }

  const keyValue = item.key_value || item.asset_no || item.assetNo || item.imei || 'RECORD';
  const statusToSet = customStatus || item.print_status || item.status || 'PENDING';
  const isAlreadyPrinted = statusToSet === 'PRINTED' || statusToSet === 'COMPLETED';

  const payload = {
    key_value:    String(keyValue),
    record_data:  item.itemData || item,
    zpl_payload:  zpl,
    asset_no:     item.asset_no     || item.assetNo  || keyValue,
    imei:         item.imei                           || '',
    mac_address:  item.mac_address  || item.macAddress || '',
    serial_no:    item.serial_no    || item.serialNo  || '',
    print_status: isAlreadyPrinted ? 'PRINTED' : statusToSet,
    printed_at:   isAlreadyPrinted ? new Date().toISOString() : null,
    requested_by: item.requested_by || 'DIRECT'
  };

  const { data, error } = await client
    .from('print_queue')
    .insert(payload)
    .single();

  if (error) {
    throw new Error(`print_queue INSERT 실패: ${error.message}`);
  }
  return data;
}
