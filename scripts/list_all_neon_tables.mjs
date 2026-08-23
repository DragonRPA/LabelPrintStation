import { neon } from '@neondatabase/serverless';

const NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function list() {
  const sql = neon(NEON_CONN);
  const tables = ['asset', 'temp_asset', 'label_templates', 'print_queue', 'schema_definitions', 'rpa_scenarios', 'scan_records'];

  console.log('📊 [Neon DB 전체 7대 테이블 및 레코드 현황]');
  const [a] = await sql`SELECT COUNT(*) FROM asset;`;
  const [t] = await sql`SELECT COUNT(*) FROM temp_asset;`;
  const [l] = await sql`SELECT COUNT(*) FROM label_templates;`;
  const [p] = await sql`SELECT COUNT(*) FROM print_queue;`;
  const [s] = await sql`SELECT COUNT(*) FROM schema_definitions;`;
  const [r] = await sql`SELECT COUNT(*) FROM rpa_scenarios;`;
  const [sc] = await sql`SELECT COUNT(*) FROM scan_records;`;

  console.log(`  - asset (정규 자산 마스터)     : ${a.count}건`);
  console.log(`  - temp_asset (임시 자산 데이터) : ${t.count}건`);
  console.log(`  - label_templates (라벨 서식)  : ${l.count}건`);
  console.log(`  - print_queue (인쇄 대기열)    : ${p.count}건`);
  console.log(`  - schema_definitions (스키마)  : ${s.count}건`);
  console.log(`  - rpa_scenarios (RPA 시나리오) : ${r.count}건`);
  console.log(`  - scan_records (스캔 로그)     : ${sc.count}건`);
}

list().catch(console.error);
