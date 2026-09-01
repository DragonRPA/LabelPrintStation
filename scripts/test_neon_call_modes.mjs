import { neon } from '@neondatabase/serverless';

const CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function test() {
  const sql = neon(CONN);

  console.log('1. Testing sql(query)...');
  try {
    const res1 = await sql('SELECT 1 as num');
    console.log('sql(query) SUCCESS:', res1);
  } catch (e) {
    console.error('sql(query) FAILED:', e.message);
  }

  console.log('\n2. Testing sql(query, params)...');
  try {
    const res2 = await sql('SELECT $1::text as val', ['hello']);
    console.log('sql(query, params) SUCCESS:', res2);
  } catch (e) {
    console.error('sql(query, params) FAILED:', e.message);
  }

  console.log('\n3. Testing sql.query(query, params)...');
  try {
    const res3 = await sql.query('SELECT $1::text as val', ['hello']);
    console.log('sql.query(query, params) SUCCESS:', res3);
  } catch (e) {
    console.error('sql.query(query, params) FAILED:', e.message);
  }

  console.log('\n4. Testing sql.query(query)...');
  try {
    const res4 = await sql.query('SELECT 1 as num');
    console.log('sql.query(query) SUCCESS:', res4);
  } catch (e) {
    console.error('sql.query(query) FAILED:', e.message);
  }
}

test();
