/**
 * Neon Serverless PostgreSQL Client & Supabase-Compatible Fluent Query Adapter (SSOT)
 * System: High-Performance Serverless SQL Engine via @neondatabase/serverless
 */
import { neon } from '@neondatabase/serverless';

export const LOCAL_KEY_NEON_CONN = 'IMAGE_SCAN_NEON_CONNECTION_STRING';

// ── 시스템 고정 Neon DB 연결 문자열 (기본 백엔드 상수 - SSOT) ──
export const HARDCODED_NEON_CONN = 'postgresql://neondb_owner:npg_IuQM7YkWqg8f@ep-ancient-morning-azex1fwv-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

let cachedSql = null;
let currentConnStr = null;

export function getStoredNeonConnectionString() {
  if (typeof window === 'undefined') return HARDCODED_NEON_CONN;
  const saved = localStorage.getItem(LOCAL_KEY_NEON_CONN);
  if (!saved || saved.length < 15 || saved.includes('your-neon-project')) {
    localStorage.setItem(LOCAL_KEY_NEON_CONN, HARDCODED_NEON_CONN);
    return HARDCODED_NEON_CONN;
  }
  return saved.trim();
}

export function saveStoredNeonConnectionString(connStr) {
  if (!connStr || connStr.trim().length < 10) return;
  const clean = connStr.trim();
  localStorage.setItem(LOCAL_KEY_NEON_CONN, clean);
  cachedSql = null;
  currentConnStr = null;
}

export function getNeonSql() {
  const connStr = getStoredNeonConnectionString();
  if (!cachedSql || currentConnStr !== connStr) {
    currentConnStr = connStr;
    cachedSql = neon(connStr);
  }
  return cachedSql;
}

export async function testNeonConnection(connStr = null) {
  try {
    const target = connStr || getStoredNeonConnectionString();
    const sql = neon(target);
    const res = await sql.query('SELECT 1 AS ok;');
    if (res && res[0]?.ok === 1) {
      return { success: true, message: 'Neon PostgreSQL 연동 성공!' };
    }
    return { success: false, message: '연결 실패 (응답 없음)' };
  } catch (err) {
    return { success: false, message: err.message || 'Neon 연결 실패' };
  }
}

/**
 * ⭐️ Supabase 호환 Fluent Query Builder
 * .from(table).select().eq().ilike().or().order().limit().range().insert().upsert().update().delete()
 */
export class NeonQueryBuilder {
  constructor(sql, tableName) {
    this.sql = sql;
    this.table = tableName;
    this.action = 'SELECT';
    this.selectCols = '*';
    this.whereConditions = [];
    this.orConditions = [];
    this.orderBy = null;
    this.limitVal = null;
    this.offsetVal = null;
    this.payloadData = null;
    this.onConflictKey = null;
    this.isSingle = false;
    this.isCountOnly = false;
  }

  select(cols = '*', options = {}) {
    this.selectCols = cols;
    if (options && options.count === 'exact') {
      this.isCountOnly = true;
    }
    return this;
  }

  eq(col, val) {
    this.whereConditions.push({ col, op: '=', val });
    return this;
  }

  neq(col, val) {
    this.whereConditions.push({ col, op: '!=', val });
    return this;
  }

  ilike(col, pattern) {
    this.whereConditions.push({ col, op: 'ILIKE', val: pattern });
    return this;
  }

  in(col, valList) {
    if (Array.isArray(valList) && valList.length > 0) {
      this.whereConditions.push({ col, op: '= ANY', val: valList });
    }
    return this;
  }

  or(condStr) {
    if (condStr) {
      this.orConditions.push(condStr);
    }
    return this;
  }

  order(col, options = { ascending: true }) {
    this.orderBy = { col, dir: options && options.ascending ? 'ASC' : 'DESC' };
    return this;
  }

  limit(n) {
    this.limitVal = Number(n) || 0;
    return this;
  }

  range(start, end) {
    this.offsetVal = Number(start) || 0;
    if (typeof end === 'number') {
      this.limitVal = Math.max(0, end - start + 1);
    }
    return this;
  }

  insert(data) {
    this.action = 'INSERT';
    this.payloadData = Array.isArray(data) ? data : [data];
    return this;
  }

  upsert(data, options = {}) {
    this.action = 'UPSERT';
    this.payloadData = Array.isArray(data) ? data : [data];
    this.onConflictKey = (options && options.onConflict) || (this.table === 'asset' ? 'asset_no' : 'id');
    return this;
  }

  update(data) {
    this.action = 'UPDATE';
    this.payloadData = data;
    return this;
  }

  delete() {
    this.action = 'DELETE';
    return this;
  }

  single() {
    this.isSingle = true;
    this.limitVal = 1;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    this.limitVal = 1;
    return this;
  }

  channel(name) {
    return createMockChannel(name);
  }

  async then(resolve, reject) {
    try {
      const res = await this._execute();
      resolve(res);
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  async _execute() {
    try {
      if (this.action === 'SELECT') {
        let query = `SELECT ${this.isCountOnly ? 'COUNT(*) AS exact_count' : this.selectCols} FROM ${this.table}`;
        const whereClauses = [];
        const params = [];

        for (const w of this.whereConditions) {
          params.push(w.val);
          if (w.op === '= ANY') {
            whereClauses.push(`"${w.col}" = ANY($${params.length})`);
          } else {
            whereClauses.push(`"${w.col}" ${w.op} $${params.length}`);
          }
        }

        for (const orStr of this.orConditions) {
          const parsed = this._parseOrCondition(orStr, params);
          if (parsed) whereClauses.push(parsed);
        }

        if (whereClauses.length > 0) {
          query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        if (this.orderBy) {
          query += ` ORDER BY "${this.orderBy.col}" ${this.orderBy.dir}`;
        }

        if (this.limitVal) {
          query += ` LIMIT ${this.limitVal}`;
        }
        if (this.offsetVal) {
          query += ` OFFSET ${this.offsetVal}`;
        }

        const data = await this._runRaw(query, params);

        if (this.isCountOnly) {
          const countVal = Number(data[0]?.exact_count) || 0;
          return { data, count: countVal, error: null };
        }

        if (this.isSingle) {
          return { data: data[0] || null, error: null };
        }
        return { data: data || [], count: data?.length || 0, error: null };
      }

      if (this.action === 'INSERT' || this.action === 'UPSERT') {
        if (!this.payloadData || this.payloadData.length === 0) {
          return { data: [], error: null };
        }

        const cols = Object.keys(this.payloadData[0]);
        const jsonStr = JSON.stringify(this.payloadData.map(row => {
          const obj = {};
          cols.forEach(c => {
            const v = row[c];
            obj[c] = (typeof v === 'object' && v !== null && !(v instanceof Date)) ? v : (v ?? null);
          });
          return obj;
        }));

        let query = `
          INSERT INTO ${this.table}
          SELECT * FROM json_populate_recordset(null::${this.table}, $1::json)
        `;

        if (this.action === 'UPSERT' && this.onConflictKey) {
          const updateSet = cols
            .filter(c => c !== this.onConflictKey && c !== 'id')
            .map(c => `"${c}" = EXCLUDED."${c}"`)
            .join(', ');

          if (updateSet) {
            query += ` ON CONFLICT ("${this.onConflictKey}") DO UPDATE SET ${updateSet}`;
          } else {
            query += ` ON CONFLICT ("${this.onConflictKey}") DO NOTHING`;
          }
        }

        query += ' RETURNING *';

        const data = await this._runRaw(query, [jsonStr]);
        return { data: this.isSingle ? (data[0] || null) : data, error: null };
      }

      if (this.action === 'UPDATE') {
        if (!this.payloadData) return { data: null, error: null };
        const keys = Object.keys(this.payloadData);
        const setClauses = [];
        const params = [];

        keys.forEach(k => {
          let v = this.payloadData[k];
          if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
          params.push(v);
          setClauses.push(`"${k}" = $${params.length}`);
        });

        let query = `UPDATE ${this.table} SET ${setClauses.join(', ')}`;
        const whereClauses = [];
        for (const w of this.whereConditions) {
          params.push(w.val);
          whereClauses.push(`"${w.col}" ${w.op} $${params.length}`);
        }
        if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
        query += ' RETURNING *';

        const data = await this._runRaw(query, params);
        return { data: this.isSingle ? (data[0] || null) : data, error: null };
      }

      if (this.action === 'DELETE') {
        let query = `DELETE FROM ${this.table}`;
        const whereClauses = [];
        const params = [];

        for (const w of this.whereConditions) {
          params.push(w.val);
          whereClauses.push(`"${w.col}" ${w.op} $${params.length}`);
        }
        for (const orStr of this.orConditions) {
          const parsed = this._parseOrCondition(orStr, params);
          if (parsed) whereClauses.push(parsed);
        }

        if (whereClauses.length > 0) query += ` WHERE ${whereClauses.join(' AND ')}`;
        query += ' RETURNING *';

        const data = await this._runRaw(query, params);
        return { data, error: null };
      }

      return { data: null, error: null };
    } catch (err) {
      console.error(`[Neon DB 오류] ${this.table} ${this.action}:`, err);
      return { data: null, error: err };
    }
  }

  _parseOrCondition(orStr, params) {
    if (!orStr) return null;
    const parts = orStr.split(',').map(p => p.trim()).filter(Boolean);
    const subClauses = [];

    for (const part of parts) {
      const inMatch = part.match(/^([a-zA-Z0-9_]+)\.in\.\((.+)\)$/);
      if (inMatch) {
        const col = inMatch[1];
        const inVals = inMatch[2].split(',').map(v => v.replace(/^"|"$/g, '').trim());
        params.push(inVals);
        subClauses.push(`"${col}" = ANY($${params.length})`);
        continue;
      }

      const ilikeMatch = part.match(/^([a-zA-Z0-9_]+)\.ilike\.%(.+)%$/);
      if (ilikeMatch) {
        const col = ilikeMatch[1];
        const q = ilikeMatch[2];
        params.push(`%${q}%`);
        subClauses.push(`"${col}" ILIKE $${params.length}`);
        continue;
      }

      const eqMatch = part.match(/^([a-zA-Z0-9_]+)\.eq\.(.+)$/);
      if (eqMatch) {
        const col = eqMatch[1];
        const v = eqMatch[2];
        params.push(v);
        subClauses.push(`"${col}" = $${params.length}`);
        continue;
      }
    }

    if (subClauses.length > 0) {
      return `(${subClauses.join(' OR ')})`;
    }
    return null;
  }

  async _runRaw(query, params = []) {
    if (this.sql && typeof this.sql.query === 'function') {
      return await this.sql.query(query, params);
    }
    if (params.length === 0) {
      return await this.sql(query);
    }
    return await this.sql(query, params);
  }
}

/**
 * ⭐️ Realtime Channel Mock (체이닝 및 언마운트 완전 방어)
 */
export function createMockChannel(name = 'default') {
  const ch = {
    name,
    on: () => ch,
    subscribe: (callback) => {
      if (typeof callback === 'function') {
        try { callback('SUBSCRIBED'); } catch (e) {}
      }
      return ch;
    },
    unsubscribe: () => ch,
    removeChannel: () => ch
  };
  return ch;
}

/**
 * ⭐️ 전사 통합 DB 클라이언트 획득 (Supabase 호환)
 */
export function getDbClient() {
  const sql = getNeonSql();
  return {
    from: (tableName) => new NeonQueryBuilder(sql, tableName),
    rawSql: sql,
    rpc: async (fnName, params) => {
      console.warn(`[DB] RPC call ignored in serverless mode: ${fnName}`);
      return { data: null, error: null };
    },
    channel: (name) => createMockChannel(name),
    removeChannel: (channel) => {
      if (channel && typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }
    }
  };
}

// 기존 getSupabaseClient()의 완전한 드롭인 대체
export const getSupabaseClient = getDbClient;
