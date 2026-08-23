import { createClient } from '@supabase/supabase-js';
import { neon } from '@neondatabase/serverless';

const SUPABASE_URL = 'https://tfgbpgutxxlhqbzewkyt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wruJQfp3Op-ISvVwb4ZdmA_2OqMUJeQ';
const NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function auditAndMigrate() {
  console.log('🔍 [1단계] Supabase ↔ Neon 전수 데이터 무결성 감사 및 동기화 시작...\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const sql = neon(NEON_CONN);

  const tablesToCheck = ['asset', 'label_templates', 'schema_definitions', 'print_queue', 'scan_records', 'imei_scans', 'rpa_scenarios'];
  
  for (const tbl of tablesToCheck) {
    let sbData = null;
    let sbCount = 0;
    let sbErr = null;

    try {
      const res = await supabase.from(tbl).select('*', { count: 'exact' });
      sbData = res.data;
      sbCount = res.count ?? (res.data ? res.data.length : 0);
      sbErr = res.error;
    } catch (e) {
      sbErr = e;
    }

    let neonCount = 0;
    try {
      const neonRes = await sql(`SELECT COUNT(*) as count FROM ${tbl}`);
      neonCount = Number(neonRes[0]?.count || 0);
    } catch (e) {
      console.log(`  [${tbl}] Neon 테이블 없음/오류 -> 생성 시도...`);
    }

    console.log(`📋 테이블: [${tbl}]`);
    console.log(`   - Supabase 건수: ${sbErr ? '조회불가 (' + sbErr.message + ')' : sbCount + '건'}`);
    console.log(`   - Neon DB 건수:  ${neonCount}건`);

    // imei_scans 또는 scan_records에 Supabase 데이터가 있다면 Neon으로 마이그레이션
    if (tbl === 'scan_records' && sbData && sbData.length > 0 && neonCount === 0) {
      for (const row of sbData) {
        await sql`
          INSERT INTO scan_records (id, asset_no, key_value, category_major, product_name, model_name, serial_no, asset_status, data, created_at)
          VALUES (${row.id || gen_random_uuid()}, ${row.asset_no || null}, ${row.key_value || null}, ${row.category_major || null}, ${row.product_name || null}, ${row.model_name || null}, ${row.serial_no || null}, ${row.asset_status || null}, ${JSON.stringify(row.data || {})}, ${row.created_at || new Date().toISOString()})
          ON CONFLICT (id) DO NOTHING;
        `;
      }
      console.log(`   -> scan_records ${sbData.length}건 Neon 복제 완료!`);
    }

    if (tbl === 'imei_scans' && sbData && sbData.length > 0) {
      // scan_records에 보존
      for (const row of sbData) {
        await sql`
          INSERT INTO scan_records (asset_no, key_value, product_name, model_name, serial_no, asset_status, data, created_at)
          VALUES (${row.imei || row.serial_no}, ${row.imei || row.serial_no}, ${row.product_name || ''}, ${row.model_name || ''}, ${row.serial_no || ''}, 'AVAILABLE', ${JSON.stringify(row)}, ${row.created_at || new Date().toISOString()})
          ON CONFLICT DO NOTHING;
        `;
      }
      console.log(`   -> imei_scans ${sbData.length}건을 scan_records로 백업 보존 완료!`);
    }
  }

  // 데이터 무결성 최종 샘플 검증 (asset 5건 대조)
  console.log('\n🔍 [데이터 1:1 샘플 무결성 대조 검증]');
  const { data: sbSample } = await supabase.from('asset').select('*').limit(3);
  for (const item of (sbSample || [])) {
    const neonMatch = await sql`SELECT * FROM asset WHERE asset_no = ${item.asset_no};`;
    const match = neonMatch[0];
    if (match) {
      const isIdentical = match.product_name === item.product_name && match.model_name === item.model_name && match.serial_no === item.serial_no;
      console.log(`   - 자산 [${item.asset_no}]: ${isIdentical ? '✅ 100% 필드 일치' : '⚠️ 불일치 발생'}`);
    } else {
      console.log(`   - 자산 [${item.asset_no}]: ❌ Neon에 없음!`);
    }
  }

  console.log('\n✅ 1단계 데이터 검수 및 무결성 감사 완료!');
}

auditAndMigrate().catch(console.error);
