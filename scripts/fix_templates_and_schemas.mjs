import { createClient } from '@supabase/supabase-js';
import { neon } from '@neondatabase/serverless';

const SUPABASE_URL = 'https://tfgbpgutxxlhqbzewkyt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wruJQfp3Op-ISvVwb4ZdmA_2OqMUJeQ';
const NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const sql = neon(NEON_CONN);

  console.log('[1/3] label_templates & schema_definitions 테이블 재구성...');
  await sql`DROP TABLE IF EXISTS label_templates;`;
  await sql`
    CREATE TABLE label_templates (
      id VARCHAR(50) PRIMARY KEY,
      template_id VARCHAR(50),
      name VARCHAR(100) NOT NULL,
      description TEXT,
      paper JSONB,
      elements JSONB,
      is_locked BOOLEAN DEFAULT FALSE,
      is_default BOOLEAN DEFAULT FALSE,
      schema_id VARCHAR(50),
      target_printer_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`DROP TABLE IF EXISTS schema_definitions;`;
  await sql`
    CREATE TABLE schema_definitions (
      id VARCHAR(50) PRIMARY KEY,
      schema_id VARCHAR(50),
      schema_name VARCHAR(100),
      key_field VARCHAR(50),
      key_field_name VARCHAR(50),
      table_version INTEGER DEFAULT 1,
      fields JSONB,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  console.log('[2/3] Supabase 서식 데이터 복제...');
  const { data: templates } = await supabase.from('label_templates').select('*');
  if (templates && templates.length > 0) {
    for (const t of templates) {
      const idVal = String(t.id || t.template_id || t.templateId || 'default_template');
      await sql`
        INSERT INTO label_templates (id, template_id, name, description, paper, elements, is_locked, is_default, schema_id, target_printer_id, created_at, updated_at)
        VALUES (
          ${idVal},
          ${idVal},
          ${t.name || '라벨 서식'},
          ${t.description || ''},
          ${JSON.stringify(t.paper || {})},
          ${JSON.stringify(t.elements || [])},
          ${Boolean(t.is_locked)},
          ${Boolean(t.is_default)},
          ${t.schema_id || 'main_schema'},
          ${t.target_printer_id || t.paper?.targetPrinterId || null},
          ${t.created_at || new Date().toISOString()},
          ${t.updated_at || new Date().toISOString()}
        );
      `;
    }
    console.log(`  -> label_templates ${templates.length}건 이전 완료`);
  }

  console.log('[3/3] Supabase 스키마 정의 복제...');
  const { data: schemas } = await supabase.from('schema_definitions').select('*');
  if (schemas && schemas.length > 0) {
    for (const s of schemas) {
      const sId = String(s.id || s.schema_id || 'asset_schema');
      await sql`
        INSERT INTO schema_definitions (id, schema_id, schema_name, key_field, key_field_name, table_version, fields, updated_at)
        VALUES (
          ${sId},
          ${sId},
          ${s.schema_name || '자산 스키마'},
          ${s.key_field || 'asset_no'},
          ${s.key_field_name || '자산번호'},
          ${s.table_version || 1},
          ${JSON.stringify(s.fields || [])},
          ${s.updated_at || new Date().toISOString()}
        );
      `;
    }
    console.log(`  -> schema_definitions ${schemas.length}건 이전 완료`);
  }

  const [tCnt] = await sql`SELECT COUNT(*) FROM label_templates;`;
  const [sCnt] = await sql`SELECT COUNT(*) FROM schema_definitions;`;
  console.log(`\n✅ 최종 현황: label_templates ${tCnt.count}건, schema_definitions ${sCnt.count}건`);
}

main().catch(console.error);
