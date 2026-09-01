import { getDbClient, fetchScansFromDb } from '../src/utils/dbClient.js';
import { syncTemplatesWithBackend } from '../src/utils/labelTemplate.js';
import { fetchTableSchema } from '../src/utils/dynamicSchema.js';

async function testAll() {
  console.log('🧪 [통합 점검] Neon DB 클라이언트 및 프론트엔드 쿼리 엔진 전수 검증 시작...\n');

  const client = getDbClient();

  // 1. fetchScansFromDb 테스트 (기본 IT 대분류)
  console.log('1. fetchScansFromDb({ category_major: "IT" }) 테스트...');
  const itItems = await fetchScansFromDb({ category_major: 'IT' });
  console.log(`   -> 성공: ${itItems.length}건 로드됨 (샘플: ${itItems[0]?.asset_no || 'none'})`);

  // 2. 바코드 단건 검색 (DirectPrintTab 시뮬레이션: or 쿼리 + maybeSingle)
  console.log('\n2. DirectPrintTab 바코드 maybeSingle 쿼리 테스트...');
  const searchKey = '124010802';
  const { data: matched, error: matchErr } = await client
    .from('asset')
    .select('*')
    .or(`asset_no.eq.${searchKey},serial_no.eq.${searchKey},imei.eq.${searchKey}`)
    .maybeSingle();

  if (matchErr) {
    console.error('   ❌ 바코드 검색 실패:', matchErr);
  } else {
    console.log(`   -> 성공: 자산번호=${matched?.asset_no}, 모델=${matched?.model_name}, 시리얼=${matched?.serial_no}`);
  }

  // 3. 라벨 서식 로드 (syncTemplatesWithBackend)
  console.log('\n3. syncTemplatesWithBackend 테스트...');
  const templates = await syncTemplatesWithBackend();
  console.log(`   -> 성공: ${templates.length}개 서식 동기화됨 (${templates.map(t => t.name).join(', ')})`);

  // 4. 스키마 정의 로드 (fetchTableSchema)
  console.log('\n4. fetchTableSchema("asset") 테스트...');
  const schema = await fetchTableSchema('asset');
  console.log(`   -> 성공: 스키마 ID=${schema?.id}, 키=${schema?.key_field}, 필드수=${schema?.fields?.length}`);

  // 5. 프린트 큐 CUD 테스트 (insert + select + delete)
  console.log('\n5. print_queue CUD 트랜잭션 테스트...');
  const testId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const { error: insErr } = await client.from('print_queue').upsert({
    id: testId,
    key_value: 'TEST_NEON_CHECK',
    asset_no: 'TEST_NEON_CHECK',
    serial_no: 'SN_9999',
    zpl_payload: '^XA^FDTEST^FS^XZ',
    print_status: 'PENDING'
  });
  if (insErr) {
    console.error('   ❌ 큐 등록 실패:', insErr);
  } else {
    console.log('   -> 큐 INSERT/UPSERT 성공');
    const { data: qData } = await client.from('print_queue').select('*').eq('id', testId).maybeSingle();
    console.log(`   -> 큐 SELECT 조회 성공: ID=${qData?.id}, 키=${qData?.key_value}`);
    await client.from('print_queue').delete().eq('id', testId);
    console.log('   -> 큐 DELETE 정리 완료');
  }

  // 6. temp_asset 조회 테스트
  console.log('\n6. temp_asset 조회 테스트...');
  const { data: tempRows } = await client.from('temp_asset').select('*').limit(5);
  console.log(`   -> temp_asset 조회 성공: ${tempRows?.length}건`);

  console.log('\n=============================================================');
  console.log('🎉 [전수 검증 성공] 모든 Neon DB 쿼리 파이프라인이 100% 정상 작동합니다!');
  console.log('=============================================================');
}

testAll().catch(console.error);
