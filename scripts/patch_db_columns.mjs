import { neon } from '@neondatabase/serverless';

const CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function patch() {
  const sql = neon(CONN);
  console.log('1. Adding target_table to label_templates if not exists...');
  await sql.query('ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS target_table VARCHAR(50) DEFAULT \'asset\';');
  await sql.query('ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS target_printer_name TEXT;');
  
  console.log('2. Adding table_name to schema_definitions if not exists...');
  await sql.query('ALTER TABLE schema_definitions ADD COLUMN IF NOT EXISTS table_name VARCHAR(50) DEFAULT \'asset\';');

  console.log('3. Updating existing templates target_table...');
  await sql.query('UPDATE label_templates SET target_table = COALESCE(paper->>\'targetTable\', \'asset\') WHERE target_table IS NULL;');

  console.log('✅ DB 스키마 컬럼 보강 완료!');
}

patch().catch(console.error);
