import { neon } from '@neondatabase/serverless';

const CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function test() {
  const sql = neon(CONN);

  const testId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const row = {
    id: testId,
    key_value: 'TEST_KEY_123',
    asset_no: 'TEST_ASSET_123',
    print_status: 'PENDING'
  };

  console.log('Testing json_populate_recordset...');
  try {
    const q1 = `
      INSERT INTO print_queue
      SELECT * FROM json_populate_recordset(null::print_queue, $1::json)
      ON CONFLICT ("id") DO UPDATE SET print_status = EXCLUDED.print_status
      RETURNING *;
    `;
    const res1 = await sql.query(q1, [JSON.stringify([row])]);
    console.log('json_populate_recordset SUCCESS:', res1);
    await sql.query('DELETE FROM print_queue WHERE id = $1', [testId]);
  } catch (e) {
    console.error('json_populate_recordset FAILED:', e.message);
  }
}

test();
