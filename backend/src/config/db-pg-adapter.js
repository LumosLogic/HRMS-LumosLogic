/**
 * db-pg-adapter.js
 * Supabase-compatible chaining API backed by PostgreSQL via `pg`.
 * Supports: select, insert, update, delete, upsert
 * Filters:  eq, neq, gt, gte, lt, lte, like, ilike, is, in, not
 * Modifiers: order, limit, range, single, maybeSingle, count
 */

const { Pool, types } = require('pg');

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date objects.
// Without this, pg converts DATE to a JS Date using local timezone (IST = UTC+5:30),
// which shifts 2026-01-01 IST → 2025-12-31T18:30:00Z, corrupting all date fields.
types.setTypeParser(1082, val => val); // 1082 = DATE OID

const pool = new Pool({
  host:                    process.env.DB_HOST     || 'localhost',
  port:                    parseInt(process.env.DB_PORT) || 5432,
  database:                process.env.DB_NAME     || 'lumos_hrms',
  user:                    process.env.DB_USER     || 'lumos_admin',
  password:                process.env.DB_PASSWORD,
  max:                     20,       // max concurrent connections
  idleTimeoutMillis:       30000,    // close idle connections after 30s
  connectionTimeoutMillis: 5000,     // fail fast if no connection in 5s
  statement_timeout:       30000,    // cancel queries exceeding 30s
});

pool.on('error', (err) => console.error('PG pool error:', err.message));

// ─── Query builder ────────────────────────────────────────────────────────────

function from(table) {
  const state = {
    table,
    operation: null,   // 'select' | 'insert' | 'update' | 'delete' | 'upsert'
    columns: '*',
    countMode: false,  // true when head:true (count only)
    countExact: false,
    insertData: null,
    updateData: null,
    upsertData: null,
    onConflict: null,
    filters: [],       // [{ col, op, val }] — all joined with AND
    orFilters: [],     // [filterString] — each becomes (A OR B) ANDed with the rest
    notNegate: false,  // tracks pending .not()
    orderClauses: [],  // [{ col, asc }]
    limitVal: null,
    offsetVal: null,
    singleRow: false,
    maybeSingleRow: false,
    params: [],        // accumulated parameterised values
  };

  // ── param helper ──────────────────────────────────────────────────────────
  function addParam(val) {
    state.params.push(val);
    return `$${state.params.length}`;
  }

  // ── filter builder ────────────────────────────────────────────────────────
  function buildWhere(tablePrefix) {
    if (!state.filters.length && !state.orFilters.length) return '';
    const prefix = tablePrefix ? `"${tablePrefix}".` : '';
    const allClauses = [];

    // ── AND conditions (.eq, .in, .gte, etc.) ────────────────────────────
    if (state.filters.length) {
      const andClauses = state.filters.map(f => {
        const col = f.col.includes('.') ? f.col : `${prefix}"${f.col}"`;
        switch (f.op) {
          case 'eq':    return `${col} = ${addParam(f.val)}`;
          case 'neq':   return `${col} <> ${addParam(f.val)}`;
          case 'gt':    return `${col} > ${addParam(f.val)}`;
          case 'gte':   return `${col} >= ${addParam(f.val)}`;
          case 'lt':    return `${col} < ${addParam(f.val)}`;
          case 'lte':   return `${col} <= ${addParam(f.val)}`;
          case 'like':  return `${col} LIKE ${addParam(f.val)}`;
          case 'ilike': return `${col} ILIKE ${addParam(f.val)}`;
          case 'is':
            if (f.val === null)  return `${col} IS NULL`;
            if (f.val === true)  return `${col} IS TRUE`;
            if (f.val === false) return `${col} IS FALSE`;
            return `${col} IS ${addParam(f.val)}`;
          case 'in': {
            if (!Array.isArray(f.val) || f.val.length === 0) return 'FALSE';
            const placeholders = f.val.map(v => addParam(v)).join(', ');
            return `${col} IN (${placeholders})`;
          }
          case 'not_in': {
            // NOT IN must also include IS NULL rows (SQL NULL NOT IN (...) = NULL = excluded)
            if (!Array.isArray(f.val) || f.val.length === 0) return 'TRUE';
            const placeholders = f.val.map(v => addParam(v)).join(', ');
            return `(${col} IS NULL OR ${col} NOT IN (${placeholders}))`;
          }
          case 'not_is': {
            if (f.val === null)  return `${col} IS NOT NULL`;
            if (f.val === true)  return `${col} IS NOT TRUE`;
            if (f.val === false) return `${col} IS NOT FALSE`;
            return `${col} IS NOT ${addParam(f.val)}`;
          }
          case 'not_eq': return `${col} <> ${addParam(f.val)}`;
          default:       return `${col} = ${addParam(f.val)}`;
        }
      });
      allClauses.push(...andClauses);
    }

    // ── OR groups (.or('col.op.val,col.op.val')) ──────────────────────────
    // Each .or() call becomes one (A OR B OR C) block ANDed with the rest.
    // Supabase format: "is_late.eq.true,is_early_exit.eq.true"
    // Split on commas that are NOT inside parentheses, so  "a.is.null,b.in.(1,2,3)"  keeps the list intact.
    const splitOrTerms = (str) => {
      const out = []; let depth = 0, cur = '';
      for (const ch of str) {
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur);
      return out;
    };
    for (const orStr of state.orFilters) {
      const orParts = splitOrTerms(orStr).map(part => {
        part = part.trim();
        const firstDot  = part.indexOf('.');
        const colName   = part.substring(0, firstDot);
        const remainder = part.substring(firstDot + 1);
        const secondDot = remainder.indexOf('.');
        const op        = remainder.substring(0, secondDot);
        const valStr    = remainder.substring(secondDot + 1);
        const colRef    = colName.includes('.') ? colName : `${prefix}"${colName}"`;

        // Supabase list operator:  col.in.(1,2,3)  →  col IN ($n, $n, $n)
        if (op === 'in') {
          const items = valStr.replace(/^\(/, '').replace(/\)$/, '').split(',')
            .map(x => x.trim()).filter(x => x !== '')
            .map(x => (!isNaN(x) ? Number(x) : x));
          return items.length ? `${colRef} IN (${items.map(v => addParam(v)).join(', ')})` : 'FALSE';
        }

        // Parse value string to JS primitive
        let val;
        if      (valStr === 'true')                      val = true;
        else if (valStr === 'false')                     val = false;
        else if (valStr === 'null')                      val = null;
        else if (valStr !== '' && !isNaN(valStr))        val = Number(valStr);
        else                                             val = valStr;

        const col = colName.includes('.') ? colName : `${prefix}"${colName}"`;

        switch (op) {
          case 'eq':
            if (val === null)  return `${col} IS NULL`;
            if (val === true)  return `${col} IS TRUE`;
            if (val === false) return `${col} IS FALSE`;
            return `${col} = ${addParam(val)}`;
          case 'neq': return `${col} <> ${addParam(val)}`;
          case 'gt':  return `${col} > ${addParam(val)}`;
          case 'gte': return `${col} >= ${addParam(val)}`;
          case 'lt':  return `${col} < ${addParam(val)}`;
          case 'lte': return `${col} <= ${addParam(val)}`;
          case 'is':  return val === null ? `${col} IS NULL` : (val ? `${col} IS TRUE` : `${col} IS FALSE`);
          default:    return `${col} = ${addParam(val)}`;
        }
      });
      allClauses.push(`(${orParts.join(' OR ')})`);
    }

    return 'WHERE ' + allClauses.join(' AND ');
  }

  // ── FK join parser ────────────────────────────────────────────────────────
  // Handles Supabase FK join syntax: alias:table!fkeyhint(col1, col2)
  function parseJoinSelects(selectStr) {
    if (!selectStr || selectStr === '*') return { baseSelect: `"${state.table}".*`, joins: [] };

    const joins = [];
    // Matches: [alias:]table[!fkeyHint](cols)
    const joinRe = /(?:(\w+):)?(\w+)(?:!(\w+))?\(([^)]+)\)/g;
    let baseSelect = selectStr;
    let match;

    while ((match = joinRe.exec(selectStr)) !== null) {
      const [fullMatch, alias, table, fkeyHint, colsStr] = match;
      const isInner = fkeyHint === 'inner';
      const joinType = isInner ? 'INNER JOIN' : 'LEFT JOIN';
      const resultAlias = alias || table;
      const cols = colsStr.split(',').map(c => c.trim()).filter(Boolean);

      // Determine the FK column on the main table
      let fkCol;
      if (fkeyHint && !isInner) {
        // e.g. "leaves_user_id_fkey" with main table "leaves" → "user_id"
        // e.g. "assets_assigned_to_fkey" with main table "assets" → "assigned_to"
        const withoutFkey = fkeyHint.replace(/_fkey$/, '');
        const prefix = state.table + '_';
        fkCol = withoutFkey.startsWith(prefix)
          ? withoutFkey.slice(prefix.length)
          : withoutFkey.replace(/^\w+_/, ''); // strip first word
      } else {
        // Infer: organizations→organization_id, users→user_id, departments→department_id
        fkCol = table.replace(/s$/, '') + '_id';
      }

      joins.push({ alias: resultAlias, table, fkCol, cols, joinType });
      baseSelect = baseSelect.replace(fullMatch, '').replace(/,\s*,/g, ',').replace(/^[\s,]+/, '').replace(/[\s,]+$/, '').trim();
    }

    // Build final base select: prefix * with table name to avoid ambiguity
    let finalBase;
    if (!baseSelect || baseSelect === '*') {
      finalBase = `"${state.table}".*`;
    } else {
      // Add table prefix to bare column names
      finalBase = baseSelect.split(',').map(c => {
        c = c.trim();
        if (c === '*' || c.includes('.') || c.includes('(')) return c;
        return `"${state.table}"."${c}"`;
      }).join(', ');
    }

    return { baseSelect: finalBase, joins };
  }

  // ── execute ───────────────────────────────────────────────────────────────
  async function execute() {
    // Reset params for this execution (filters accumulate, params built during buildWhere)
    state.params = [];

    let sql = '';
    let rows;

    try {
      if (state.operation === 'select') {
        if (state.countMode) {
          // COUNT query
          const where = buildWhere(null);
          sql = `SELECT COUNT(*) FROM "${state.table}" ${where}`;
          const result = await pool.query(sql, state.params);
          return { count: parseInt(result.rows[0].count, 10), data: null, error: null };
        }

        const { baseSelect, joins } = parseJoinSelects(state.columns);
        // Prefix WHERE columns with main table name when JOINs are present to avoid ambiguity
        const where = buildWhere(joins.length ? state.table : null);
        const order = state.orderClauses.length
          ? 'ORDER BY ' + state.orderClauses.map(o => `"${state.table}"."${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')
          : '';
        const limit  = state.limitVal  !== null ? `LIMIT ${parseInt(state.limitVal)}`   : '';
        const offset = state.offsetVal !== null ? `OFFSET ${parseInt(state.offsetVal)}` : '';

        // Build JOIN clauses and aliased column selects
        // Use the result alias as SQL alias to handle the same table joined multiple times
        const joinSql = joins.map(j =>
          `${j.joinType} "${j.table}" AS "_jt_${j.alias}" ON "_jt_${j.alias}".id = "${state.table}"."${j.fkCol}"`
        ).join(' ');

        const joinCols = joins.flatMap(j =>
          j.cols.map(c => `"_jt_${j.alias}"."${c}" AS "__join__${j.alias}__${c}"`)
        ).join(', ');

        const selectCols = joinCols ? `${baseSelect}, ${joinCols}` : baseSelect;

        sql = `SELECT ${selectCols} FROM "${state.table}" ${joinSql} ${where} ${order} ${limit} ${offset}`
          .trim().replace(/\s+/g, ' ');
        const result = await pool.query(sql, state.params);

        // Reconstruct nested objects from aliased join columns
        rows = result.rows.map(row => {
          if (!joins.length) return row;
          const nested = {};
          const clean = {};
          for (const [key, val] of Object.entries(row)) {
            const m = key.match(/^__join__(\w+)__(.+)$/);
            if (m) {
              if (!nested[m[1]]) nested[m[1]] = {};
              nested[m[1]][m[2]] = val;
            } else {
              clean[key] = val;
            }
          }
          return { ...clean, ...nested };
        });

        if (state.singleRow) {
          if (!rows.length) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
          return { data: rows[0], error: null };
        }
        if (state.maybeSingleRow) {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      }

      if (state.operation === 'insert') {
        const items = Array.isArray(state.insertData) ? state.insertData : [state.insertData];
        if (!items.length) return { data: [], error: null };

        // All unique keys across all rows
        const keys = [...new Set(items.flatMap(r => Object.keys(r)))];
        const colList = keys.map(k => `"${k}"`).join(', ');
        const valueSets = items.map(item => {
          const vals = keys.map(k => (k in item ? addParam(item[k]) : 'DEFAULT'));
          return `(${vals.join(', ')})`;
        });
        sql = `INSERT INTO "${state.table}" (${colList}) VALUES ${valueSets.join(', ')} RETURNING *`;
        const result = await pool.query(sql, state.params);
        rows = result.rows;

        if (state.singleRow || state.maybeSingleRow) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }

      if (state.operation === 'update') {
        const keys = Object.keys(state.updateData);
        if (!keys.length) return { data: null, error: { message: 'No fields to update' } };
        const setClauses = keys.map(k => `"${k}" = ${addParam(state.updateData[k])}`).join(', ');
        const where = buildWhere(null);
        sql = `UPDATE "${state.table}" SET ${setClauses} ${where} RETURNING *`;
        const result = await pool.query(sql, state.params);
        rows = result.rows;

        if (state.singleRow || state.maybeSingleRow) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }

      if (state.operation === 'delete') {
        const where = buildWhere(null);
        sql = `DELETE FROM "${state.table}" ${where} RETURNING *`;
        const result = await pool.query(sql, state.params);
        return { data: result.rows, error: null };
      }

      if (state.operation === 'upsert') {
        const items = Array.isArray(state.upsertData) ? state.upsertData : [state.upsertData];
        if (!items.length) return { data: [], error: null };

        const keys = [...new Set(items.flatMap(r => Object.keys(r)))];
        const colList = keys.map(k => `"${k}"`).join(', ');
        const valueSets = items.map(item => {
          const vals = keys.map(k => (k in item ? addParam(item[k]) : 'DEFAULT'));
          return `(${vals.join(', ')})`;
        });

        let conflictClause = 'DO NOTHING';
        if (state.onConflict) {
          const conflictCols = state.onConflict.split(',').map(c => `"${c.trim()}"`).join(', ');
          const updateKeys = keys.filter(k => !state.onConflict.split(',').map(c => c.trim()).includes(k));
          if (updateKeys.length) {
            const updateSet = updateKeys.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
            conflictClause = `DO UPDATE SET ${updateSet}`;
          }
        }

        sql = `INSERT INTO "${state.table}" (${colList}) VALUES ${valueSets.join(', ')} ON CONFLICT ${state.onConflict ? `("${state.onConflict.split(',').map(c => c.trim()).join('", "')}")` : ''} ${conflictClause} RETURNING *`;
        const result = await pool.query(sql, state.params);
        rows = result.rows;

        if (state.singleRow || state.maybeSingleRow) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }

      return { data: null, error: { message: 'No operation specified' } };
    } catch (err) {
      console.error(`[pg-adapter] ${state.operation?.toUpperCase()} "${state.table}" error:`, err.message);
      // Map common PG error codes to Supabase-like error shapes
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  // ── builder object ────────────────────────────────────────────────────────
  const builder = {
    // ── Operations ──────────────────────────────────────────────────────────
    select(cols, options = {}) {
      // When chained after insert/update/delete, .select() in Supabase just means
      // "return the affected rows" — our adapter already uses RETURNING *, so keep
      // the existing operation and ignore this call.
      if (!state.operation) state.operation = 'select';
      state.columns = cols || '*';
      if (options.count === 'exact') state.countExact = true;
      if (options.head === true)     state.countMode  = true;
      return builder;
    },

    insert(data) {
      state.operation = 'insert';
      state.insertData = data;
      return builder;
    },

    update(data) {
      state.operation = 'update';
      state.updateData = data;
      return builder;
    },

    delete() {
      state.operation = 'delete';
      return builder;
    },

    upsert(data, options = {}) {
      state.operation = 'upsert';
      state.upsertData = data;
      state.onConflict = options.onConflict || null;
      return builder;
    },

    // ── Filters ──────────────────────────────────────────────────────────────
    eq(col, val) {
      state.filters.push({ col, op: state.notNegate ? 'neq' : 'eq', val });
      state.notNegate = false;
      return builder;
    },
    neq(col, val) {
      state.filters.push({ col, op: 'neq', val });
      return builder;
    },
    gt(col, val) {
      state.filters.push({ col, op: 'gt', val });
      return builder;
    },
    gte(col, val) {
      state.filters.push({ col, op: 'gte', val });
      return builder;
    },
    lt(col, val) {
      state.filters.push({ col, op: 'lt', val });
      return builder;
    },
    lte(col, val) {
      state.filters.push({ col, op: 'lte', val });
      return builder;
    },
    like(col, val) {
      state.filters.push({ col, op: 'like', val });
      return builder;
    },
    ilike(col, val) {
      state.filters.push({ col, op: 'ilike', val });
      return builder;
    },
    is(col, val) {
      state.filters.push({ col, op: 'is', val });
      return builder;
    },
    in(col, val) {
      state.filters.push({ col, op: 'in', val });
      return builder;
    },
    not(col, op, val) {
      // supabase: .not('col', 'is', null) or .not('col', 'eq', val)
      if (col && op && val !== undefined) {
        state.filters.push({ col, op: `not_${op}`, val });
      } else {
        // chained form: .not().eq(...) — set negate flag
        state.notNegate = true;
      }
      return builder;
    },

    // Supabase .or('col.op.val,col.op.val') — produces (A OR B) ANDed with rest
    or(filterString) {
      if (filterString) state.orFilters.push(filterString);
      return builder;
    },

    // ── Modifiers ────────────────────────────────────────────────────────────
    order(col, opts = {}) {
      state.orderClauses.push({ col, asc: opts.ascending !== false });
      return builder;
    },
    limit(n) {
      state.limitVal = n;
      return builder;
    },
    range(from, to) {
      state.offsetVal = from;
      state.limitVal  = to - from + 1;
      return builder;
    },
    single() {
      state.singleRow = true;
      state.limitVal  = 1;
      return execute();
    },
    maybeSingle() {
      state.maybeSingleRow = true;
      state.limitVal = 1;
      return execute();
    },

    // ── Thenable (await builder without terminal modifier) ────────────────
    then(resolve, reject) {
      return execute().then(resolve, reject);
    },
  };

  return builder;
}

// PostgreSQL query builder — exported as `db` for use in all routes.
const db = { from };

module.exports = { from, pool, db };
