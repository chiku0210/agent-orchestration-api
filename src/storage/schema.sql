-- Initial schema for durable runs, event log, and artifacts.

create table if not exists runs (
  id text primary key,
  workflow_type text not null,
  status text not null,
  input_prompt text not null,
  market_pulse_run_id text references runs(id) on delete set null,
  created_at timestamptz not null default now()
);

-- For existing databases created before this column existed:
alter table runs add column if not exists market_pulse_run_id text references runs(id) on delete set null;

create table if not exists events (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists artifacts (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  kind text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists events_run_id_created_at_idx on events (run_id, created_at);
create index if not exists artifacts_run_id_created_at_idx on artifacts (run_id, created_at);

