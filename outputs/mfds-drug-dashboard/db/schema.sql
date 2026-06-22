create extension if not exists pg_trgm;

create table if not exists mfds_drugs (
  item_seq text primary key,
  item_name text not null,
  entp_name text,
  etc_otc text,
  permit_date date,
  item_category text,
  cancel_status text,
  make_material text,
  main_ingredient text,
  atc_code text,
  standard_code text,
  efficacy text,
  dosage text,
  precautions text,
  basic jsonb not null default '{}'::jsonb,
  ingredients jsonb not null default '[]'::jsonb,
  additives text[] not null default '{}',
  dur jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  performance jsonb,
  source_url text,
  fetched_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(item_name, '') || ' ' ||
      coalesce(entp_name, '') || ' ' ||
      coalesce(main_ingredient, '') || ' ' ||
      coalesce(atc_code, '') || ' ' ||
      coalesce(efficacy, '') || ' ' ||
      coalesce(dosage, '') || ' ' ||
      coalesce(precautions, '')
    )
  ) stored
);

create index if not exists mfds_drugs_item_name_idx on mfds_drugs using gin (item_name gin_trgm_ops);
create index if not exists mfds_drugs_entp_name_idx on mfds_drugs using gin (entp_name gin_trgm_ops);
create index if not exists mfds_drugs_search_vector_idx on mfds_drugs using gin (search_vector);
create index if not exists mfds_drugs_atc_code_idx on mfds_drugs (atc_code);
create index if not exists mfds_drugs_permit_date_idx on mfds_drugs (permit_date);

create table if not exists medicine_storage (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists medicine_snapshots (
  category text primary key,
  snapshot_date date,
  change_date date,
  item_count integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

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
);

create index if not exists medicine_changes_category_date_idx on medicine_changes (category, change_date desc);
create index if not exists medicine_changes_type_idx on medicine_changes (change_type);
