alter type public.game_phase add value if not exists 'countdown' after 'lobby';

alter table public.games
  add column if not exists turn_starts_at timestamptz;
