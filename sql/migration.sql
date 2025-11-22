-- SQL migration for Supabase (orders + tracking_events)
-- Run this in the Supabase SQL editor

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tracking_code text unique not null,
  user_id uuid references users(id),
  created_at timestamptz default now()
);

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  status text not null,
  note text,
  occurred_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_orders_tracking_code on orders(tracking_code);
create index if not exists idx_tracking_events_order_id on tracking_events(order_id);
