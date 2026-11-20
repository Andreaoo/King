-- ============================================================================
-- KING — database Supabase: account, ospiti, partite, statistiche
-- Da eseguire una volta in Supabase → SQL Editor → New query → Run.
--
-- Regole di sicurezza:
--  * i client (chiave "anon" + login) possono solo LEGGERE i propri dati e modificare
--    nickname/immagine del proprio profilo;
--  * partite, risultati e statistiche li scrive SOLO il server di gioco con la chiave
--    service_role (mai nel browser): nessun giocatore può aggiungersi vittorie o punti;
--  * ogni partita ha un id univoco (uuid generato dal server) → registrata una sola volta.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- profili (1 per account) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique check (username ~ '^[A-Za-z0-9_.]{3,24}$'),
  nickname    text not null check (char_length(nickname) between 1 and 14),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- profilo creato automaticamente alla registrazione (nickname e username dai metadati)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, nickname)
  values (new.id,
          nullif(new.raw_user_meta_data->>'username', ''),
          coalesce(nullif(left(new.raw_user_meta_data->>'nickname', 14), ''), 'Giocatore'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- identità ospite ----------
-- L'ospite ha un id e un segreto (solo l'hash è salvato). Serve per statistiche temporanee
-- e per trasferirle all'account quando si registra (claim verificato dal server).
create table if not exists public.guest_identities (
  id           uuid primary key default gen_random_uuid(),
  secret_hash  text not null,
  nickname     text not null,
  created_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  claimed_by   uuid references public.profiles(id) on delete set null,
  claimed_at   timestamptz
);

-- ---------- partite concluse o abbandonate ----------
create table if not exists public.games (
  id           uuid primary key,                 -- generato dal server: chiave anti-duplicato
  game_type    text not null check (game_type in ('classic', 'teams')),
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  duration_s   integer generated always as (greatest(0, extract(epoch from (ended_at - started_at))::int)) stored,
  hands_played integer not null,
  completed    boolean not null,                 -- false = chiusa prima della fine
  created_at   timestamptz not null default now()
);

create table if not exists public.game_players (
  game_id      uuid not null references public.games(id) on delete cascade,
  seat         smallint not null check (seat between 0 and 3),
  user_id      uuid references public.profiles(id) on delete set null,
  guest_id     uuid references public.guest_identities(id) on delete set null,
  nickname     text not null,
  is_bot       boolean not null default false,
  team         smallint,
  final_score  integer not null,
  position     smallint not null check (position between 1 and 4),
  result       text not null check (result in ('win', 'loss', 'abandoned')),
  luck_avg     numeric(5,1),
  primary key (game_id, seat)
);
create index if not exists game_players_user_idx  on public.game_players(user_id);
create index if not exists game_players_guest_idx on public.game_players(guest_id);
-- la stessa persona non può comparire due volte nella stessa partita
create unique index if not exists game_players_once_user  on public.game_players(game_id, user_id)  where user_id is not null;
create unique index if not exists game_players_once_guest on public.game_players(game_id, guest_id) where guest_id is not null;

-- ---------- statistiche (calcolate, mai salvate a mano) ----------
create or replace view public.player_stats with (security_invoker = true) as
select
  gp.user_id,
  count(*)                                               as games_total,
  count(*) filter (where gp.result = 'win')              as wins,
  count(*) filter (where gp.result = 'loss')             as losses,
  count(*) filter (where g.completed)                    as games_completed,
  count(*) filter (where gp.result = 'abandoned')        as games_abandoned,
  round(100.0 * count(*) filter (where gp.result = 'win')
        / nullif(count(*) filter (where g.completed), 0), 1) as win_pct,
  round(avg(gp.position) filter (where g.completed), 2)  as avg_position,
  min(gp.position) filter (where g.completed)            as best_position,
  count(*) filter (where g.completed and gp.position = 1) as pos1,
  count(*) filter (where g.completed and gp.position = 2) as pos2,
  count(*) filter (where g.completed and gp.position = 3) as pos3,
  count(*) filter (where g.completed and gp.position = 4) as pos4
from public.game_players gp
join public.games g on g.id = gp.game_id
where gp.user_id is not null
group by gp.user_id;

-- ---------- sicurezza (RLS) ----------
alter table public.profiles         enable row level security;
alter table public.guest_identities enable row level security;   -- nessuna policy: solo il server
alter table public.games            enable row level security;
alter table public.game_players     enable row level security;

-- profilo: lo vedo e modifico solo io (solo nickname e immagine: le altre colonne sono bloccate)
drop policy if exists "profilo: leggo il mio" on public.profiles;
create policy "profilo: leggo il mio" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profilo: modifico il mio" on public.profiles;
create policy "profilo: modifico il mio" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from anon, authenticated;
grant update (nickname, avatar_url) on public.profiles to authenticated;

-- partite: vedo solo quelle a cui ho partecipato (e quindi anche gli avversari di quelle partite)
create or replace function public.played_in(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_players where game_id = g and user_id = auth.uid())
$$;
drop policy if exists "partite: solo le mie" on public.games;
create policy "partite: solo le mie" on public.games for select using (public.played_in(id));
drop policy if exists "giocatori: solo le mie partite" on public.game_players;
create policy "giocatori: solo le mie partite" on public.game_players for select using (public.played_in(game_id));
-- nessuna policy di insert/update/delete: scrive solo il server (service_role ignora RLS)
revoke insert, update, delete on public.games, public.game_players from anon, authenticated;

-- permessi espliciti: vedi anche grants.sql (stesso contenuto)
grant usage on schema public to anon, authenticated, service_role;

-- utenti loggati: leggono profilo, partite e statistiche (RLS: solo i propri)
grant select on public.profiles, public.games, public.game_players, public.player_stats to authenticated;
grant update (nickname, avatar_url) on public.profiles to authenticated;
grant execute on function public.played_in(uuid) to authenticated;

-- server di gioco (chiave segreta): scrive partite e risultati, gestisce gli ospiti
grant select, insert, update, delete on public.profiles, public.guest_identities, public.games, public.game_players to service_role;
grant select on public.player_stats to service_role;

-- chi non ha fatto l'accesso non legge nulla
revoke all on public.profiles, public.guest_identities, public.games, public.game_players, public.player_stats from anon;
