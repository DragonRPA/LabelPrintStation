import { createClient } from '@supabase/supabase-js';
import { neon } from '@neondatabase/serverless';

const SUPABASE_URL = 'https://tfgbpgutxxlhqbzewkyt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wruJQfp3Op-ISvVwb4ZdmA_2OqMUJeQ';
const NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const sql = neon(NEON_CONN);

  console.log('[1/3] Neon DB에 temp_asset 테이블 생성 중...');
  await sql`
    CREATE TABLE IF NOT EXISTS temp_asset (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_no VARCHAR(50),
      category_major VARCHAR(50),
      product_name VARCHAR(100),
      model_name VARCHAR(100),
      serial_no VARCHAR(50),
      asset_status VARCHAR(30) DEFAULT 'AVAILABLE',
      earning_ratio REAL DEFAULT 0,
      shelf_no VARCHAR(50),
      asset_option TEXT,
      calibration_date VARCHAR(30),
      mac_wlan VARCHAR(50),
      mac_lan VARCHAR(50),
      imei VARCHAR(50),
      components TEXT,
      remark TEXT,
      data JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_temp_asset_no ON temp_asset (asset_no);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_temp_asset_serial ON temp_asset (serial_no);`;

  console.log('[2/3] Supabase temp_asset 데이터 조회 및 복제 중...');
  try {
    const { data: tempRows, error } = await supabase.from('temp_asset').select('*');
    if (!error && tempRows && tempRows.length > 0) {
      console.log(`  -> Supabase에서 ${tempRows.length}건 temp_asset 데이터 발견, Neon으로 이전 중...`);
      for (const r of tempRows) {
        await sql`
          INSERT INTO temp_asset (
            id, asset_no, category_major, product_name, model_name, serial_no,
            asset_status, earning_ratio, shelf_no, asset_option, calibration_date,
            mac_wlan, mac_lan, imei, components, remark, data, created_at, updated_at
          ) VALUES (
            ${r.id || gen_random_uuid()}, ${r.asset_no || null}, ${r.category_major || null}, ${r.product_name || null}, ${r.model_name || null}, ${r.serial_no || null},
            ${r.asset_status || 'AVAILABLE'}, ${parseFloat(r.earning_ratio) || 0}, ${r.shelf_no || null}, ${r.asset_option || null}, ${r.calibration_date || null},
            ${r.mac_wlan || null}, ${r.mac_lan || null}, ${r.imei || null}, ${r.components || null}, ${r.remark || null}, ${JSON.stringify(r.data || {})}, ${r.created_at || new Date().toISOString()}, ${r.updated_at || new Date().toISOString()}
          )
          ON CONFLICT (id) DO NOTHING;
        `;
      }
      console.log(`  ✅ temp_asset ${tempRows.length}건 이전 완료!`);
    } else {
      console.log('  -> Supabase temp_asset에 데이터 없음 (테이블 스키마 생성 완료)');
    }
  } catch (e) {
    console.log('  -> Supabase temp_asset 조회 불가 (신규 테이블 생성 완료)');
  }

  console.log('[3/3] Neon DB 전체 테이블 목록 확인:');
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;
  tables.forEach(t => console.log('  - ' + t.table_name));
}

main().catch(console.error);
