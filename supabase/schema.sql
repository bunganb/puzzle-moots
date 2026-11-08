-- Run once in Supabase SQL Editor. Enable Authentication > Providers > Anonymous first.
-- Realtime Settings: disable "Allow public access" for private room channels.

create table if not exists public.puzzle_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check (char_length(title) between 1 and 60),
  preset text check (preset in ('coast', 'garden', 'city')),
  image_path text,
  image_width integer not null check (image_width between 200 and 5000),
  image_height integer not null check (image_height between 200 and 5000),
  cols integer not null check (cols between 3 and 20),
  rows integer not null check (rows between 3 and 20),
  board_width integer not null check (board_width between 100 and 760),
  board_height integer not null check (board_height between 100 and 560),
  created_at timestamptz not null default now(),
  constraint puzzle_image_choice check ((preset is null) <> (image_path is null)),
  constraint puzzle_max_pieces check (cols * rows <= 150)
);

create table if not exists public.room_members (
  room_id uuid not null references public.puzzle_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.piece_state (
  room_id uuid not null references public.puzzle_rooms(id) on delete cascade,
  piece_index integer not null check (piece_index >= 0),
  x numeric(8,2) not null,
  y numeric(8,2) not null,
  placed boolean not null default false,
  lock_owner uuid references auth.users(id),
  lock_until timestamptz,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, piece_index)
);

create index if not exists piece_state_room_idx on public.piece_state(room_id);
create index if not exists room_members_user_idx on public.room_members(user_id);

alter table public.puzzle_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.piece_state enable row level security;

grant select on public.puzzle_rooms, public.room_members, public.piece_state to authenticated;
revoke all on public.puzzle_rooms, public.room_members, public.piece_state from anon;

drop policy if exists "members see rooms" on public.puzzle_rooms;
create policy "members see rooms" on public.puzzle_rooms for select to authenticated
using (exists (select 1 from public.room_members m where m.room_id = id and m.user_id = (select auth.uid())));

drop policy if exists "members see own membership" on public.room_members;
create policy "members see own membership" on public.room_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "members see pieces" on public.piece_state;
create policy "members see pieces" on public.piece_state for select to authenticated
using (exists (select 1 from public.room_members m where m.room_id = piece_state.room_id and m.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('puzzle-images', 'puzzle-images', false, 3000000, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3000000, allowed_mime_types = array['image/webp'];

drop policy if exists "owner uploads puzzle photo" on storage.objects;
create policy "owner uploads puzzle photo" on storage.objects for insert to authenticated
with check (bucket_id = 'puzzle-images' and split_part(name, '/', 1) = (select auth.uid())::text);

drop policy if exists "room members view puzzle photo" on storage.objects;
create policy "room members view puzzle photo" on storage.objects for select to authenticated
using (bucket_id = 'puzzle-images' and (
  split_part(name, '/', 1) = (select auth.uid())::text
  or exists (select 1 from public.puzzle_rooms r join public.room_members m on m.room_id = r.id
             where r.image_path = storage.objects.name and m.user_id = (select auth.uid()))
));

create or replace function public.create_puzzle_room(
  p_title text, p_name text, p_preset text, p_image_path text,
  p_width integer, p_height integer, p_cols integer, p_rows integer,
  p_board_width integer, p_board_height integer
) returns public.puzzle_rooms
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room public.puzzle_rooms;
  v_index integer;
begin
  if auth.uid() is null then raise exception 'Login diperlukan'; end if;
  if char_length(trim(p_name)) not between 1 and 24 then raise exception 'Nama harus 1–24 karakter'; end if;
  if p_cols * p_rows > 150 then raise exception 'Maksimal 150 keping'; end if;
  if p_image_path is not null then
    if split_part(p_image_path, '/', 1) <> auth.uid()::text or
       not exists (select 1 from storage.objects where bucket_id = 'puzzle-images' and name = p_image_path)
    then raise exception 'Foto tidak tersedia'; end if;
  end if;
  insert into public.puzzle_rooms(owner_id, title, preset, image_path, image_width, image_height, cols, rows, board_width, board_height)
  values(auth.uid(), trim(p_title), p_preset, p_image_path, p_width, p_height, p_cols, p_rows, p_board_width, p_board_height)
  returning * into v_room;
  insert into public.room_members(room_id, user_id, display_name) values(v_room.id, auth.uid(), trim(p_name));
  for v_index in 0..(p_cols * p_rows - 1) loop
    insert into public.piece_state(room_id, piece_index, x, y)
    values(v_room.id, v_index, 70 + ((v_index * 137 + 19) % 1390), 55 + ((v_index * 97 + 43) % 920));
  end loop;
  return v_room;
end $$;

create or replace function public.join_puzzle_room(p_room uuid, p_name text)
returns public.puzzle_rooms
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.puzzle_rooms;
begin
  if auth.uid() is null then raise exception 'Login diperlukan'; end if;
  if char_length(trim(p_name)) not between 1 and 24 then raise exception 'Nama harus 1–24 karakter'; end if;
  select * into v_room from public.puzzle_rooms where id = p_room;
  if not found then raise exception 'Link puzzle tidak ditemukan'; end if;
  insert into public.room_members(room_id, user_id, display_name)
  values(p_room, auth.uid(), trim(p_name))
  on conflict (room_id, user_id) do update set display_name = excluded.display_name;
  return v_room;
end $$;

create or replace function public.claim_puzzle_piece(p_room uuid, p_piece integer)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claimed boolean;
begin
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = auth.uid()) then
    raise exception 'Bukan anggota ruang';
  end if;
  update public.piece_state set lock_owner = auth.uid(), lock_until = now() + interval '20 seconds'
  where room_id = p_room and piece_index = p_piece and not placed
    and (lock_owner is null or lock_owner = auth.uid() or lock_until < now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

create or replace function public.release_puzzle_piece(
  p_room uuid, p_piece integer, p_x numeric, p_y numeric, p_placed boolean
) returns public.piece_state
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room public.puzzle_rooms;
  v_piece public.piece_state;
  v_home_x numeric;
  v_home_y numeric;
  v_threshold numeric;
begin
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = auth.uid()) then
    raise exception 'Bukan anggota ruang';
  end if;
  if p_x is null or p_y is null or p_x < 0 or p_x > 1540 or p_y < 0 or p_y > 1040 then
    raise exception 'Posisi tidak valid';
  end if;
  select * into v_room from public.puzzle_rooms where id = p_room;
  v_home_x := 420 + (p_piece % v_room.cols) * v_room.board_width::numeric / v_room.cols;
  v_home_y := 210 + floor(p_piece::numeric / v_room.cols) * v_room.board_height::numeric / v_room.rows;
  v_threshold := greatest(24, least(42, v_room.board_width::numeric / v_room.cols * .38));
  if p_placed and sqrt(power(p_x - v_home_x, 2) + power(p_y - v_home_y, 2)) >= v_threshold then
    raise exception 'Keping belum tepat pada tempatnya';
  end if;
  update public.piece_state
  set x = case when p_placed then v_home_x else p_x end,
      y = case when p_placed then v_home_y else p_y end,
      placed = p_placed,
      lock_owner = null, lock_until = null,
      version = version + 1, updated_at = now()
  where room_id = p_room and piece_index = p_piece and not placed
    and lock_owner = auth.uid() and lock_until >= now()
  returning * into v_piece;
  if not found then raise exception 'Keping sudah diubah pemain lain. Coba lagi.'; end if;
  return v_piece;
end $$;

revoke all on function public.create_puzzle_room(text,text,text,text,integer,integer,integer,integer,integer,integer) from public, anon;
revoke all on function public.join_puzzle_room(uuid,text) from public, anon;
revoke all on function public.claim_puzzle_piece(uuid,integer) from public, anon;
revoke all on function public.release_puzzle_piece(uuid,integer,numeric,numeric,boolean) from public, anon;
grant execute on function public.create_puzzle_room(text,text,text,text,integer,integer,integer,integer,integer,integer) to authenticated;
grant execute on function public.join_puzzle_room(uuid,text) to authenticated;
grant execute on function public.claim_puzzle_piece(uuid,integer) to authenticated;
grant execute on function public.release_puzzle_piece(uuid,integer,numeric,numeric,boolean) to authenticated;

drop policy if exists "members receive room realtime" on realtime.messages;
create policy "members receive room realtime" on realtime.messages for select to authenticated
using (realtime.messages.extension in ('broadcast', 'presence') and exists (
  select 1 from public.room_members m
  where m.user_id = (select auth.uid()) and m.room_id::text = split_part((select realtime.topic()), ':', 2)
));

drop policy if exists "members send room realtime" on realtime.messages;
create policy "members send room realtime" on realtime.messages for insert to authenticated
with check (realtime.messages.extension in ('broadcast', 'presence') and exists (
  select 1 from public.room_members m
  where m.user_id = (select auth.uid()) and m.room_id::text = split_part((select realtime.topic()), ':', 2)
));

do $$ begin
  alter publication supabase_realtime add table public.piece_state;
exception when duplicate_object then null;
end $$;
