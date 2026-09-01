import { neon } from '@neondatabase/serverless';

const HARDCODED_NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function test() {
  console.log('Testing Neon connection to:', HARDCODED_NEON_CONN);
  try {
    const sql = neon(HARDCODED_NEON_CONN);
    const start = Date.now();
    const res = await sql`SELECT 1 AS ok, current_database() as db, version();`;
    console.log(`Connection SUCCESS (${Date.now() - start}ms):`, res);

    console.log('\nChecking tables:');
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`;
    console.log('Tables in DB:', tables.map(t => t.table_name));

    const [assets] = await sql`SELECT COUNT(*) FROM asset;`;
    console.log(`Total Assets in DB: ${assets.count} rows`);
  } catch (e) {
    console.error('Connection FAILED:', e);
  }
}

test();
