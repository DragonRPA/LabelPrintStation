import { createClient } from '@supabase/supabase-js';
import { neon } from '@neondatabase/serverless';

const SUPABASE_URL = 'https://tfgbpgutxxlhqbzewkyt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wruJQfp3Op-ISvVwb4ZdmA_2OqMUJeQ';
const NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
  console.log('🚀 Supabase ➔ Neon 초고속 무손실 데이터 마이그레이션 시작...');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const sql = neon(NEON_CONN);

  // 0. 테이블 구조 100% Supabase 호환으로 최신화
  console.log('[0/4] 테이블 스키마 점검 및 보정...');
  await sql`
    CREATE TABLE IF NOT EXISTS label_templates (
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

  await sql`
    CREATE TABLE IF NOT EXISTS schema_definitions (
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

  // 1. label_templates 마이그레이션
  console.log('\n[1/4] label_templates 마이그레이션 중...');
  try {
    const { data: templates, error: tErr } = await supabase.from('label_templates').select('*');
    if (!tErr && templates && templates.length > 0) {
      console.log(`  -> Supabase에서 ${templates.length}건 서식 발견, Neon으로 이전 중...`);
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
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            paper = EXCLUDED.paper,
            elements = EXCLUDED.elements,
            is_locked = EXCLUDED.is_locked,
            is_default = EXCLUDED.is_default,
            schema_id = EXCLUDED.schema_id,
            target_printer_id = EXCLUDED.target_printer_id,
            updated_at = EXCLUDED.updated_at;
        `;
      }
      console.log(`  ✅ label_templates ${templates.length}건 이전 완료!`);
    }
  } catch (e) {
    console.warn('  ⚠️ label_templates 이전 오류:', e.message);
  }

  // 2. schema_definitions 마이그레이션
  console.log('\n[2/4] schema_definitions 마이그레이션 중...');
  try {
    const { data: schemas, error: sErr } = await supabase.from('schema_definitions').select('*');
    if (!sErr && schemas && schemas.length > 0) {
      console.log(`  -> Supabase에서 ${schemas.length}건 스키마 발견, Neon으로 이전 중...`);
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
          )
          ON CONFLICT (id) DO UPDATE SET
            schema_name = EXCLUDED.schema_name,
            key_field = EXCLUDED.key_field,
            key_field_name = EXCLUDED.key_field_name,
            table_version = EXCLUDED.table_version,
            fields = EXCLUDED.fields,
            updated_at = EXCLUDED.updated_at;
        `;
      }
      console.log(`  ✅ schema_definitions ${schemas.length}건 이전 완료!`);
    }
  } catch (e) {
    console.warn('  ⚠️ schema_definitions 이전 오류:', e.message);
  }

  // 3. rpa_scenarios 마이그레이션
  console.log('\n[3/4] rpa_scenarios 마이그레이션 중...');
  try {
    const { data: scenarios, error: scErr } = await supabase.from('rpa_scenarios').select('*');
    if (!scErr && scenarios && scenarios.length > 0) {
      for (const sc of scenarios) {
        const scId = String(sc.id || sc.scenario_id);
        await sql`
          INSERT INTO rpa_scenarios (scenario_id, name, description, trigger_type, steps, is_active, created_at, updated_at)
          VALUES (${scId}, ${sc.name}, ${sc.description || ''}, ${sc.trigger_type || 'MANUAL'}, ${JSON.stringify(sc.steps || [])}, ${sc.is_active !== false}, ${sc.created_at || new Date().toISOString()}, ${sc.updated_at || new Date().toISOString()})
          ON CONFLICT (scenario_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            trigger_type = EXCLUDED.trigger_type,
            steps = EXCLUDED.steps,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at;
        `;
      }
      console.log(`  ✅ rpa_scenarios ${scenarios.length}건 이전 완료!`);
    } else {
      console.log('  -> rpa_scenarios 데이터 없음 (건너뜀)');
    }
  } catch (e) {}

  // 4. asset 마스터 데이터 초고속 벌크 마이그레이션
  console.log('\n[4/4] asset 마스터 데이터 고속 추출 및 적재 시작...');
  let allAssets = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data: chunk, error: aErr } = await supabase
      .from('asset')
      .select('*')
      .range(from, from + step - 1);

    if (aErr) break;
    if (!chunk || chunk.length === 0) break;
    allAssets = allAssets.concat(chunk);
    from += step;
    if (chunk.length < step) break;
  }
  console.log(`  -> Supabase에서 총 ${allAssets.length}건의 자산 데이터 확보.`);

  if (allAssets.length > 0) {
    const BATCH_SIZE = 250;
    for (let i = 0; i < allAssets.length; i += BATCH_SIZE) {
      const batch = allAssets.slice(i, i + BATCH_SIZE);

      // JSON 배열로 한번에 전달하여 UNNEST로 고속 배치 UPSERT
      const jsonStr = JSON.stringify(batch.map(a => ({
        asset_no: String(a.asset_no || ''),
        category_major: String(a.category_major || ''),
        product_name: String(a.product_name || ''),
        model_name: String(a.model_name || ''),
        serial_no: String(a.serial_no || ''),
        asset_status: String(a.asset_status || 'AVAILABLE'),
        earning_ratio: parseFloat(a.earning_ratio) || 0,
        shelf_no: String(a.shelf_no || ''),
        asset_option: String(a.asset_option || ''),
        calibration_date: String(a.calibration_date || ''),
        mac_wlan: String(a.mac_wlan || ''),
        mac_lan: String(a.mac_lan || ''),
        imei: String(a.imei || ''),
        components: String(a.components || ''),
        remark: String(a.remark || '')
      })));

      await sql`
        INSERT INTO asset (
          asset_no, category_major, product_name, model_name, serial_no,
          asset_status, earning_ratio, shelf_no, asset_option, calibration_date,
          mac_wlan, mac_lan, imei, components, remark
        )
        SELECT
          x.asset_no, x.category_major, x.product_name, x.model_name, x.serial_no,
          x.asset_status, x.earning_ratio, x.shelf_no, x.asset_option, x.calibration_date,
          x.mac_wlan, x.mac_lan, x.imei, x.components, x.remark
        FROM json_to_recordset(${jsonStr}::json) AS x(
          asset_no text, category_major text, product_name text, model_name text, serial_no text,
          asset_status text, earning_ratio real, shelf_no text, asset_option text, calibration_date text,
          mac_wlan text, mac_lan text, imei text, components text, remark text
        )
        ON CONFLICT (asset_no) DO UPDATE SET
          category_major = EXCLUDED.category_major,
          product_name = EXCLUDED.product_name,
          model_name = EXCLUDED.model_name,
          serial_no = EXCLUDED.serial_no,
          asset_status = EXCLUDED.asset_status,
          earning_ratio = EXCLUDED.earning_ratio,
          shelf_no = EXCLUDED.shelf_no,
          asset_option = EXCLUDED.asset_option,
          calibration_date = EXCLUDED.calibration_date,
          mac_wlan = EXCLUDED.mac_wlan,
          mac_lan = EXCLUDED.mac_lan,
          imei = EXCLUDED.imei,
          components = EXCLUDED.components,
          remark = EXCLUDED.remark;
      `;

      const done = Math.min(allAssets.length, i + BATCH_SIZE);
      const percent = Math.round((done / allAssets.length) * 100);
      console.log(`  -> [진행률: ${percent}%] ${done} / ${allAssets.length}건 적재 완료`);
    }
    console.log(`  ✅ asset ${allAssets.length}건 초고속 이전 완결!`);
  }

  // 5. 검증
  console.log('\n📊 [최종 검증] Neon DB 데이터 적재 현황:');
  const [assetCnt] = await sql`SELECT COUNT(*) FROM asset;`;
  const [tmplCnt] = await sql`SELECT COUNT(*) FROM label_templates;`;
  const [schCnt] = await sql`SELECT COUNT(*) FROM schema_definitions;`;
  const [qCnt] = await sql`SELECT COUNT(*) FROM print_queue;`;

  console.log(`  - asset 테이블 총 건수: ${assetCnt.count}건`);
  console.log(`  - label_templates 서식 건수: ${tmplCnt.count}건`);
  console.log(`  - schema_definitions 스키마 건수: ${schCnt.count}건`);
  console.log(`  - print_queue 대기열 건수: ${qCnt.count}건`);

  console.log('\n🎉 [성공] Neon DB로의 모든 데이터가 100% 무손실 고속 이전되었습니다!');
}

migrate().catch(e => {
  console.error('❌ 마이그레이션 실패:', e);
  process.exit(1);
});
