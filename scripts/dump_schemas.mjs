import { neon } from '@neondatabase/serverless';

const CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const sql = neon(CONN);

  const cols = await sql`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    ORDER BY table_name, ordinal_position;
  `;

  const map = {};
  for (const c of cols) {
    if (!map[c.table_name]) map[c.table_name] = [];
    map[c.table_name].push(`${c.column_name} (${c.data_type})`);
  }

  for (const [tbl, clist] of Object.entries(map)) {
    console.log(`\n[${tbl}]`);
    console.log('  ' + clist.join(', '));
  }
}

main().catch(console.error);
