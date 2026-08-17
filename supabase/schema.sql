create extension if not exists pgcrypto;

create table public.data_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  data_room_id uuid not null references public.data_rooms(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (data_room_id, parent_id, name)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  data_room_id uuid not null references public.data_rooms(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (data_room_id, folder_id, name)
);

create type public.share_target_type as enum ('room', 'folder', 'file');
create type public.share_access as enum ('link', 'user');
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  data_room_id uuid not null references public.data_rooms(id) on delete cascade,
  target_type public.share_target_type not null,
  target_id uuid not null,
  access_type public.share_access not null,
  recipient_email text,
  token uuid unique default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((access_type = 'link' and recipient_email is null) or (access_type = 'user' and recipient_email is not null))
);

create index folders_room_parent_name_idx on public.folders(data_room_id, parent_id, name);
create index files_room_folder_name_idx on public.files(data_room_id, folder_id, name);
create index shares_lookup_idx on public.shares(token) where revoked_at is null;
create index shares_recipient_idx on public.shares(lower(recipient_email)) where revoked_at is null;

alter table public.data_rooms enable row level security;
alter table public.folders enable row level security;
alter table public.files enable row level security;
alter table public.shares enable row level security;
insert into storage.buckets (id, name, public) values ('data-room-files', 'data-room-files', false)
on conflict (id) do nothing;

create or replace function public.folder_totals(folder_uuid uuid)
returns table(item_count bigint, total_size bigint) language sql stable as $$
  with recursive subtree as (
    select id from folders where id = folder_uuid
    union all
    select f.id from folders f join subtree s on f.parent_id = s.id
  )
  select (select count(*) from subtree) + count(files.id), coalesce(sum(files.size_bytes), 0)
  from files where folder_id in (select id from subtree);
$$;
