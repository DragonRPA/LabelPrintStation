import { getDbClient, fetchScansFromDb } from '../src/utils/dbClient.js';

async function profile() {
  console.log('⏱️ [성능 프로파일링 시작] 18,033건 데이터 조회 구간별 소요 시간 측정...\n');

  const client = getDbClient();

  // 1. 순수 DB 쿼리 (SELECT *)
  const t0 = performance.now();
  const res1 = await client.from('asset').select('*').eq('category_major', 'IT').range(0, 49999);
  const t1 = performance.now();
  console.log(`1. [SELECT *] (18개 컬럼 전체) 네트워크 + DB 시간: ${(t1 - t0).toFixed(0)}ms (건수: ${res1.data?.length}건)`);

  // 2. 가벼운 컬럼만 SELECT (SELECT asset_no, category_major, product_name, model_name, serial_no, asset_status, earning_ratio, shelf_no)
  const t2 = performance.now();
  const res2 = await client.from('asset').select('asset_no, category_major, product_name, model_name, serial_no, asset_status, earning_ratio, shelf_no, calibration_date, mac_wlan, mac_lan, imei, components, remark').eq('category_major', 'IT').range(0, 49999);
  const t3 = performance.now();
  console.log(`2. [SELECT 주요컬럼] 네트워크 + DB 시간: ${(t3 - t2).toFixed(0)}ms (건수: ${res2.data?.length}건)`);

  // 3. fetchScansFromDb 전체 파이프라인 (JS 매핑 포함)
  const t4 = performance.now();
  const res3 = await fetchScansFromDb({ category_major: 'IT' });
  const t5 = performance.now();
  console.log(`3. [fetchScansFromDb] 전체 함수 실행 시간: ${(t5 - t4).toFixed(0)}ms (건수: ${res3.length}건)`);

  // 4. LIMIT 1000 (초기 1,000건만 페이징 조회 시)
  const t6 = performance.now();
  const res4 = await client.from('asset').select('*').eq('category_major', 'IT').limit(1000);
  const t7 = performance.now();
  console.log(`4. [LIMIT 1000] (첫 페이지 1,000건 조회 시): ${(t7 - t6).toFixed(0)}ms (건수: ${res4.data?.length}건)`);
}

profile().catch(console.error);
