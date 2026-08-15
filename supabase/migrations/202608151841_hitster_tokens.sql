alter type public.game_phase add value if not exists 'betting' after 'playing';

alter table public.players
  add column if not exists tokens integer not null default 2 check (tokens between 0 and 5);

alter table public.games
  add column if not exists title_artist_awarded boolean not null default false;

create table if not exists public.hitster_bets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  target_player_id uuid not null references public.players(id) on delete cascade,
  gap integer not null check (gap >= 0),
  created_at timestamptz not null default now(),
  constraint hitster_bets_unique_player unique (game_id, track_id, player_id),
  constraint hitster_bets_unique_gap unique (game_id, track_id, gap)
);

create index if not exists hitster_bets_game_track_idx on public.hitster_bets(game_id, track_id);

create or replace function public.is_timeline_gap_correct(p_player_id uuid, p_gap integer, p_year integer)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_count integer;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_count from public.cards where player_id = p_player_id;
  if p_gap < 0 or p_gap > v_count then
    return false;
  end if;

  if p_gap > 0 then
    select t.release_year into v_before
    from public.cards c
    join public.tracks t on t.id = c.track_id
    where c.player_id = p_player_id and c.position = p_gap - 1;
  end if;

  if p_gap < v_count then
    select t.release_year into v_after
    from public.cards c
    join public.tracks t on t.id = c.track_id
    where c.player_id = p_player_id and c.position = p_gap;
  end if;

  return (v_before is null or v_before <= p_year) and (v_after is null or p_year <= v_after);
end $$;

revoke all on function public.is_timeline_gap_correct(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.is_timeline_gap_correct(uuid, integer, integer) to service_role;

create or replace function public.place_hitster_bet(p_game_id uuid, p_player_id uuid, p_gap integer, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_player public.players%rowtype;
  v_active_player_id uuid;
  v_active_cards integer;
  v_constraint text;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Es gibt keine aktive Runde.';
  end if;
  if v_game.phase <> 'betting' or v_game.current_track_id is null or v_game.selected_gap is null then
    raise exception 'HITSTER-Einsätze sind gerade nicht möglich.';
  end if;
  if v_game.version <> p_version then
    raise exception 'Dieser Zug ist nicht mehr aktuell.';
  end if;

  select * into v_player from public.players where id = p_player_id and game_id = p_game_id for update;
  if not found then
    raise exception 'Bitte erst der Runde beitreten.';
  end if;

  select id into v_active_player_id from public.players where game_id = p_game_id and seat = v_game.current_seat;
  if v_active_player_id is null then
    raise exception 'Aktives Team konnte nicht ermittelt werden.';
  end if;
  if v_active_player_id = p_player_id then
    raise exception 'Das aktive Team darf keinen HITSTER-Token setzen.';
  end if;

  if v_player.tokens < 1 then
    raise exception 'Du hast keine HITSTER-Tokens mehr.';
  end if;

  select count(*) into v_active_cards from public.cards where player_id = v_active_player_id;
  if p_gap < 0 or p_gap > v_active_cards then
    raise exception 'Diese Position gibt es nicht.';
  end if;
  if p_gap = v_game.selected_gap then
    raise exception 'Die gewählte Position des aktiven Teams darf nicht genutzt werden.';
  end if;

  begin
    insert into public.hitster_bets(game_id, track_id, player_id, target_player_id, gap)
    values (p_game_id, v_game.current_track_id, p_player_id, v_active_player_id, p_gap);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'hitster_bets_unique_player' then
      raise exception 'Du hast für diesen Song bereits einen Token eingesetzt.';
    end if;
    if v_constraint = 'hitster_bets_unique_gap' then
      raise exception 'Diese Position wurde bereits von einem anderen Team belegt.';
    end if;
    raise;
  end;

  update public.players set tokens = tokens - 1 where id = p_player_id;
  update public.games set version = version + 1 where id = p_game_id;

  return (select version from public.games where id = p_game_id);
end $$;

revoke all on function public.place_hitster_bet(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.place_hitster_bet(uuid, uuid, integer, integer) to service_role;

create or replace function public.resolve_hitster_turn(p_game_id uuid, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_track public.tracks%rowtype;
  v_active_player_id uuid;
  v_winner_player_id uuid;
  v_winner_gap integer;
  v_active_correct boolean;
  v_bet record;
  v_card_count integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Es gibt keine aktive Runde.';
  end if;
  if v_game.phase <> 'betting' or v_game.current_track_id is null or v_game.selected_gap is null then
    raise exception 'Dieser Zug kann gerade nicht aufgedeckt werden.';
  end if;
  if v_game.version <> p_version then
    raise exception 'Dieser Zug ist nicht mehr aktuell.';
  end if;

  select * into v_track from public.tracks where id = v_game.current_track_id and game_id = p_game_id for update;
  if not found then
    raise exception 'Der aktuelle Song ist nicht mehr verfügbar.';
  end if;

  select id into v_active_player_id from public.players where game_id = p_game_id and seat = v_game.current_seat;
  if v_active_player_id is null then
    raise exception 'Aktives Team konnte nicht ermittelt werden.';
  end if;

  v_active_correct := public.is_timeline_gap_correct(v_active_player_id, v_game.selected_gap, v_track.release_year);

  if v_active_correct then
    v_winner_player_id := v_active_player_id;
    v_winner_gap := v_game.selected_gap;
  else
    for v_bet in
      select hb.id, hb.player_id, hb.gap
      from public.hitster_bets hb
      where hb.game_id = p_game_id and hb.track_id = v_game.current_track_id
      order by hb.created_at, hb.id
    loop
      if public.is_timeline_gap_correct(v_active_player_id, v_bet.gap, v_track.release_year) then
        v_winner_player_id := v_bet.player_id;
        exit;
      end if;
    end loop;

    if v_winner_player_id is not null then
      select count(*) into v_card_count from public.cards where player_id = v_winner_player_id;
      for v_winner_gap in 0..v_card_count loop
        exit when public.is_timeline_gap_correct(v_winner_player_id, v_winner_gap, v_track.release_year);
      end loop;
    end if;
  end if;

  if v_winner_player_id is not null then
    perform public.insert_timeline_card(p_game_id, v_winner_player_id, v_track.id, v_winner_gap);
    update public.tracks set state = 'card' where id = v_track.id;
  else
    update public.tracks set state = 'discarded' where id = v_track.id;
  end if;

  update public.games
  set phase = 'revealing',
      placement_correct = v_active_correct,
      reveal_ends_at = now() + make_interval(secs => reveal_seconds),
      clip_ends_at = null,
      title_artist_awarded = false,
      version = version + 1
  where id = p_game_id;

  return (select version from public.games where id = p_game_id);
end $$;

revoke all on function public.resolve_hitster_turn(uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_hitster_turn(uuid, integer) to service_role;

create or replace function public.award_title_artist_token(p_game_id uuid, p_host_player_id uuid, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_active_player_id uuid;
  v_host_is_valid boolean;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Es gibt keine aktive Runde.';
  end if;

  if v_game.phase <> 'revealing' then
    raise exception 'Der Bonus kann nur während der Auflösung vergeben werden.';
  end if;
  if v_game.version <> p_version then
    raise exception 'Dieser Zug ist nicht mehr aktuell.';
  end if;
  if v_game.title_artist_awarded then
    raise exception 'Der Titel-/Künstler-Bonus wurde bereits vergeben.';
  end if;

  select exists(
    select 1 from public.players p
    where p.id = p_host_player_id and p.game_id = p_game_id and p.is_host
  ) into v_host_is_valid;
  if not v_host_is_valid then
    raise exception 'Nur der Host darf den Bonus vergeben.';
  end if;

  select id into v_active_player_id from public.players where game_id = p_game_id and seat = v_game.current_seat for update;
  if v_active_player_id is null then
    raise exception 'Aktives Team konnte nicht ermittelt werden.';
  end if;

  update public.players
  set tokens = least(5, tokens + 1)
  where id = v_active_player_id;

  update public.games
  set title_artist_awarded = true,
      version = version + 1
  where id = p_game_id;

  return (select version from public.games where id = p_game_id);
end $$;

revoke all on function public.award_title_artist_token(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.award_title_artist_token(uuid, uuid, integer) to service_role;
