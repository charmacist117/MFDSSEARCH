const DEFAULT_CHANGE_LOG = {
  updatedAt: "",
  snapshotDate: "",
  snapshots: {},
  changes: {
    human: [],
    vet: [],
    aquatic: []
  }
};

let sqlPromise = null;
let schemaPromise = null;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL || "";
}

function isNeonConfigured() {
  return Boolean(databaseUrl());
}

async function sqlClient() {
  if (!isNeonConfigured()) return null;
  if (!sqlPromise) {
    sqlPromise = import("@neondatabase/serverless").then(({ neon }) => neon(databaseUrl()));
  }
  return sqlPromise;
}

async function query(text, params = []) {
  const sql = await sqlClient();
  if (!sql) throw new Error("Neon DATABASE_URL is not configured.");
  return sql.query(text, params);
}

async function ensureSchema() {
  if (!isNeonConfigured()) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        create table if not exists medicine_storage (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        )
      `);
      await query(`
        create table if not exists medicine_snapshots (
          category text primary key,
          snapshot_date date,
          change_date date,
          item_count integer not null default 0,
          payload jsonb not null,
          updated_at timestamptz not null default now()
        )
      `);
      await query(`
        create table if not exists medicine_changes (
          category text not null,
          change_date date not null,
          change_type text not null,
          item_id text not null,
          name text,
          company text,
          status text,
          permit_date date,
          cancel_date date,
          permit_number text,
          product_code text,
          note text,
          payload jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now(),
          primary key (category, change_date, change_type, item_id)
        )
      `);
      await query("create index if not exists medicine_changes_category_date_idx on medicine_changes (category, change_date desc)");
      await query("create index if not exists medicine_changes_type_idx on medicine_changes (change_type)");
    })();
  }
  return schemaPromise;
}

function asIsoDate(value) {
  const match = String(value || "").match(/\d{4}[-.]\d{2}[-.]\d{2}/);
  return match ? match[0].replaceAll(".", "-") : null;
}

function dateValue(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeLog(value = {}) {
  return {
    ...DEFAULT_CHANGE_LOG,
    ...value,
    snapshots: {
      ...DEFAULT_CHANGE_LOG.snapshots,
      ...(value.snapshots || {})
    },
    changes: {
      ...DEFAULT_CHANGE_LOG.changes,
      ...(value.changes || {})
    }
  };
}

async function readChangeLogFromTables() {
  const rows = await query(`
    select category, change_date, change_type, item_id, name, company, status, permit_date,
           cancel_date, permit_number, product_code, note, payload, updated_at
      from medicine_changes
     order by change_date asc, updated_at asc
  `);
  if (!rows.length) return undefined;

  const snapshotRows = await query("select category, payload from medicine_snapshots");
  const snapshots = {};
  for (const row of snapshotRows) {
    snapshots[row.category] = {
      ...(row.payload || {}),
      items: undefined
    };
  }

  const changes = { human: [], vet: [], aquatic: [] };
  let updatedAt = "";
  for (const row of rows) {
    const category = changes[row.category] ? row.category : "human";
    changes[category].push({
      date: dateValue(row.change_date),
      category,
      type: row.change_type,
      id: row.item_id,
      name: row.name || "",
      company: row.company || "",
      status: row.status || "",
      permitDate: dateValue(row.permit_date),
      cancelDate: dateValue(row.cancel_date),
      permitNumber: row.permit_number || "",
      productCode: row.product_code || "",
      note: row.note || "",
      ...(row.payload || {})
    });
    updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : updatedAt;
  }

  return normalizeLog({
    updatedAt,
    snapshots,
    changes
  });
}

async function readJson(key) {
  await ensureSchema();
  const rows = await query("select value from medicine_storage where key = $1", [key]);
  if (rows[0]?.value) return rows[0].value;

  if (key === "change-log") {
    return readChangeLogFromTables();
  }
  if (key.startsWith("snapshot:")) {
    const category = key.slice("snapshot:".length);
    const snapshotRows = await query("select payload from medicine_snapshots where category = $1", [category]);
    return snapshotRows[0]?.payload;
  }
  return undefined;
}

async function syncSnapshot(key, payload) {
  if (!key.startsWith("snapshot:")) return;
  const category = key.slice("snapshot:".length);
  await query(
    `
      insert into medicine_snapshots (category, snapshot_date, change_date, item_count, payload, updated_at)
      values ($1, $2, $3, $4, $5::jsonb, now())
      on conflict (category) do update set
        snapshot_date = excluded.snapshot_date,
        change_date = excluded.change_date,
        item_count = excluded.item_count,
        payload = excluded.payload,
        updated_at = now()
    `,
    [
      category,
      asIsoDate(payload?.date),
      asIsoDate(payload?.changeDate),
      Number(payload?.count || payload?.items?.length || 0),
      JSON.stringify(payload || {})
    ]
  );
}

async function syncChangeLog(log) {
  const normalized = normalizeLog(log);
  for (const [category, entries] of Object.entries(normalized.changes || {})) {
    for (const item of entries || []) {
      const itemId = String(item.id || "").trim();
      const changeDate = asIsoDate(item.date);
      const changeType = String(item.type || "").trim();
      if (!itemId || !changeDate || !changeType) continue;
      await query(
        `
          insert into medicine_changes (
            category, change_date, change_type, item_id, name, company, status,
            permit_date, cancel_date, permit_number, product_code, note, payload, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now())
          on conflict (category, change_date, change_type, item_id) do update set
            name = excluded.name,
            company = excluded.company,
            status = excluded.status,
            permit_date = excluded.permit_date,
            cancel_date = excluded.cancel_date,
            permit_number = excluded.permit_number,
            product_code = excluded.product_code,
            note = excluded.note,
            payload = excluded.payload,
            updated_at = now()
        `,
        [
          category,
          changeDate,
          changeType,
          itemId,
          item.name || "",
          item.company || "",
          item.status || "",
          asIsoDate(item.permitDate),
          asIsoDate(item.cancelDate),
          item.permitNumber || "",
          item.productCode || "",
          item.note || "",
          JSON.stringify(item || {})
        ]
      );
    }
  }
}

async function writeJson(key, value) {
  await ensureSchema();
  await query(
    `
      insert into medicine_storage (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [key, JSON.stringify(value)]
  );
  await syncSnapshot(key, value);
  if (key === "change-log") {
    await syncChangeLog(value);
  }
}

module.exports = {
  isNeonConfigured,
  ensureSchema,
  readJson,
  writeJson
};
