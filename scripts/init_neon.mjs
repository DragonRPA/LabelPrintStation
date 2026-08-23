import { neon } from '@neondatabase/serverless';

const CONNECTION_STRING = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  console.log('[1/4] Neon DB 연결 테스트 중...');
  const sql = neon(CONNECTION_STRING);
  const versionRes = await sql`SELECT version();`;
  console.log('  -> DB 버전:', versionRes[0].version);

  console.log('[2/4] 핵심 테이블 DDL 생성 중...');

  // 1. asset 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS asset (
      asset_no VARCHAR(50) PRIMARY KEY,
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
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_serial ON asset (serial_no);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_model ON asset (model_name);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_status ON asset (asset_status);`;

  // 2. print_queue 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS print_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key_value TEXT,
      asset_no TEXT,
      imei TEXT,
      mac_address TEXT,
      serial_no TEXT,
      zpl_payload TEXT,
      record_data JSONB,
      print_status VARCHAR(20) DEFAULT 'PENDING',
      agent_id TEXT,
      requested_by VARCHAR(50) DEFAULT 'DIRECT',
      printed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_queue_status ON print_queue (print_status);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_queue_created ON print_queue (created_at DESC);`;

  // 3. label_templates 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS label_templates (
      template_id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      paper JSONB NOT NULL,
      elements JSONB NOT NULL,
      is_locked BOOLEAN DEFAULT FALSE,
      is_default BOOLEAN DEFAULT FALSE,
      target_printer_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // 4. rpa_scenarios 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS rpa_scenarios (
      scenario_id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      trigger_type VARCHAR(50),
      steps JSONB NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // 5. schema_definitions 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS schema_definitions (
      schema_id VARCHAR(50) PRIMARY KEY,
      schema_name VARCHAR(100) NOT NULL,
      key_field VARCHAR(50) NOT NULL,
      key_field_name VARCHAR(50) NOT NULL,
      table_version INTEGER DEFAULT 1,
      fields JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // 6. scan_records 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS scan_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_no TEXT,
      key_value TEXT,
      category_major TEXT,
      product_name TEXT,
      model_name TEXT,
      serial_no TEXT,
      asset_status TEXT,
      data JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  console.log('[3/4] 생성된 테이블 검증 중...');
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;

  console.log('[4/4] Neon DB 공용 테이블 목록:');
  tables.forEach(t => console.log('  - ' + t.table_name));

  console.log('\n🎉 [성공] Neon DB 스키마 6개 테이블 초기화가 완벽히 완료되었습니다!');
}

main().catch(e => {
  console.error('❌ 실행 오류:', e);
  process.exit(1);
});
