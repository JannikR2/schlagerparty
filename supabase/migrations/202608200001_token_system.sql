alter table public.games
  add column betting_ends_at timestamptz,
  add column real_life_correct boolean;

alter table public.players
  add column tokens integer not null default 3 check (tokens between 0 and 5);

alter table public.cards drop constraint cards_track_id_key;
alter table public.cards add constraint cards_player_track_key unique (player_id, track_id);

create table public.token_bets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  gap integer not null check (gap >= 0),
  correct boolean,
  created_at timestamptz not null default now(),
  unique (track_id, player_id),
  unique (track_id, gap)
);

alter table public.token_bets enable row level security;
create trigger signal_token_bet after insert or update on public.token_bets
  for each row execute function public.emit_game_signal();

create function public.place_token_bet(p_game_id uuid, p_player_id uuid, p_gap integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_active_player uuid;
  v_card_count integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.phase <> 'betting' or v_game.betting_ends_at <= now() then
    raise exception 'Das Token-Tippfenster ist geschlossen.';
  end if;

  select id into v_active_player from public.players
    where game_id = p_game_id and seat = v_game.current_seat;
  if p_player_id = v_active_player then
    raise exception 'Der aktive Spieler darf keinen Token-Tipp abgeben.';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and game_id = p_game_id and tokens > 0) then
    raise exception 'Du hast keine Tokens mehr.';
  end if;

  select count(*) into v_card_count from public.cards where player_id = v_active_player;
  if p_gap < 0 or p_gap > v_card_count then
    raise exception 'Diese Position gibt es nicht.';
  end if;
  if p_gap = v_game.selected_gap then
    raise exception 'Diese Position gehört dem Haupttipp.';
  end if;

  begin
    insert into public.token_bets(game_id, track_id, player_id, gap)
      values (p_game_id, v_game.current_track_id, p_player_id, p_gap);
  exception when unique_violation then
    raise exception 'Du oder ein anderer Spieler hat diese Position bereits belegt.';
  end;

  update public.players set tokens = tokens - 1
    where id = p_player_id and game_id = p_game_id and tokens > 0;
  if not found then raise exception 'Du hast keine Tokens mehr.'; end if;
end $$;

revoke all on function public.place_token_bet(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.place_token_bet(uuid, uuid, integer) to service_role;

create function public.resolve_token_round(p_game_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_active_player uuid;
  v_year integer;
  v_bet record;
  v_own_gap integer;
  v_any_winner boolean := false;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.phase <> 'betting' or v_game.version <> p_version then
    return;
  end if;
  if v_game.betting_ends_at > now() then
    raise exception 'Das Token-Tippfenster läuft noch.';
  end if;

  select id into v_active_player from public.players
    where game_id = p_game_id and seat = v_game.current_seat;
  select release_year into v_year from public.tracks where id = v_game.current_track_id;

  update public.token_bets b set correct =
    (not exists (
      select 1 from public.cards c join public.tracks t on t.id = c.track_id
      where c.player_id = v_active_player and c.position = b.gap - 1 and t.release_year > v_year
    )) and (not exists (
      select 1 from public.cards c join public.tracks t on t.id = c.track_id
      where c.player_id = v_active_player and c.position = b.gap and t.release_year < v_year
    ))
  where b.track_id = v_game.current_track_id;

  if v_game.placement_correct then
    perform public.insert_timeline_card(p_game_id, v_active_player, v_game.current_track_id, v_game.selected_gap);
    v_any_winner := true;
  end if;

  for v_bet in select player_id from public.token_bets
    where track_id = v_game.current_track_id and correct = true
  loop
    select count(*) into v_own_gap
      from public.cards c join public.tracks t on t.id = c.track_id
      where c.player_id = v_bet.player_id and t.release_year <= v_year;
    perform public.insert_timeline_card(p_game_id, v_bet.player_id, v_game.current_track_id, v_own_gap);
    v_any_winner := true;
  end loop;

  update public.tracks set state = case when v_any_winner then 'card' else 'discarded' end
    where id = v_game.current_track_id;
  update public.games set phase = 'revealing', betting_ends_at = null,
    reveal_ends_at = now() + make_interval(secs => reveal_seconds), version = version + 1
    where id = p_game_id and version = p_version;
end $$;

revoke all on function public.resolve_token_round(uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_token_round(uuid, integer) to service_role;

create function public.complete_real_life_check(p_game_id uuid, p_version integer, p_correct boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.phase <> 'reviewing' or v_game.version <> p_version or not v_game.placement_correct then
    raise exception 'Dieser Real-Life-Check ist nicht mehr aktuell.';
  end if;
  if p_correct then
    update public.players set tokens = least(5, tokens + 1)
      where game_id = p_game_id and seat = v_game.current_seat;
  end if;
  update public.games set real_life_correct = p_correct, version = version + 1
    where id = p_game_id and version = p_version;
end $$;

revoke all on function public.complete_real_life_check(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.complete_real_life_check(uuid, integer, boolean) to service_role;
