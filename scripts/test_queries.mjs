import { neon } from '@neondatabase/serverless';

const CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const sql = neon(CONN);

  console.log('1. asset 테이블 category_major 분포:');
  const catDist = await sql`SELECT category_major, COUNT(*) as count FROM asset GROUP BY category_major;`;
  console.log(catDist);

  console.log('\n2. asset 샘플 3건:');
  const samples = await sql`SELECT asset_no, category_major, product_name, model_name, serial_no, asset_status FROM asset LIMIT 3;`;
  console.log(samples);

  console.log('\n3. label_templates 건수 및 목록:');
  const tpls = await sql`SELECT id, name, target_table FROM label_templates;`;
  console.log(tpls);

  console.log('\n4. schema_definitions 건수:');
  const schemas = await sql`SELECT id, schema_name, table_name, key_field FROM schema_definitions;`;
  console.log(schemas);

  console.log('\n5. temp_asset 건수:');
  const [tempCount] = await sql`SELECT COUNT(*) as count FROM temp_asset;`;
  console.log(tempCount);

  console.log('\n6. print_queue 건수:');
  const [pqCount] = await sql`SELECT COUNT(*) as count FROM print_queue;`;
  console.log(pqCount);
}

main().catch(console.error);
