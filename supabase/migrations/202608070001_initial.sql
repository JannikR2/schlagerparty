create extension if not exists pgcrypto;

create type public.game_phase as enum ('lobby', 'playing', 'revealing', 'finished');

create table public.games (
  id uuid primary key default gen_random_uuid(),
  phase public.game_phase not null default 'lobby',
  version integer not null default 1,
  playlist_id text not null,
  playlist_name text not null,
  clip_seconds integer not null check (clip_seconds > 0),
  reveal_seconds integer not null check (reveal_seconds > 0),
  host_spotify_id text not null,
  spotify_session text not null,
  spotify_device_id text,
  current_seat integer,
  current_track_id uuid,
  selected_gap integer,
  placement_correct boolean,
  reveal_ends_at timestamptz,
  clip_ends_at timestamptz,
  winner_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index only_one_active_game on public.games ((closed_at is null)) where closed_at is null;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  seat integer not null,
  reconnect_token_hash text not null unique,
  is_host boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, seat)
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  spotify_id text not null,
  spotify_uri text not null,
  spotify_url text not null,
  name text not null,
  artist text not null,
  release_year integer not null,
  duration_ms integer not null check (duration_ms > 0),
  cover_url text,
  state text not null default 'pool' check (state in ('pool', 'current', 'card', 'discarded')),
  unique (game_id, spotify_id)
);

alter table public.games add constraint games_current_track_fkey foreign key (current_track_id) references public.tracks(id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  track_id uuid not null unique references public.tracks(id),
  position integer not null,
  created_at timestamptz not null default now(),
  unique (player_id, position)
);

create function public.insert_timeline_card(p_game_id uuid, p_player_id uuid, p_track_id uuid, p_gap integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_gap < 0 or p_gap > (select count(*) from public.cards where player_id = p_player_id) then
    raise exception 'invalid gap';
  end if;
  update public.cards set position = position + 100000 where player_id = p_player_id and position >= p_gap;
  update public.cards set position = position - 99999 where player_id = p_player_id and position >= p_gap + 100000;
  insert into public.cards(game_id, player_id, track_id, position) values (p_game_id, p_player_id, p_track_id, p_gap);
end $$;
revoke all on function public.insert_timeline_card(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.insert_timeline_card(uuid, uuid, uuid, integer) to service_role;

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.tracks enable row level security;
alter table public.cards enable row level security;

-- Realtime only exposes a version signal; game data is served by sanitized Next.js endpoints.
create table public.game_signals (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  version integer not null,
  created_at timestamptz not null default now()
);
alter table public.game_signals enable row level security;
create policy "public can read game signals" on public.game_signals for select using (true);

create function public.emit_game_signal() returns trigger language plpgsql security definer set search_path = public as $$
declare target_game uuid; target_version integer;
begin
  if tg_table_name = 'games' then
    target_game := new.id;
  else
    target_game := new.game_id;
  end if;
  select version into target_version from public.games where id = target_game;
  insert into public.game_signals(game_id, version) values (target_game, coalesce(target_version, 1));
  return new;
end $$;

create trigger signal_game after insert or update on public.games for each row execute function public.emit_game_signal();
create trigger signal_player after insert or update on public.players for each row execute function public.emit_game_signal();
create trigger signal_card after insert or update on public.cards for each row execute function public.emit_game_signal();
alter publication supabase_realtime add table public.game_signals;
