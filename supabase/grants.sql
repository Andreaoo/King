-- ============================================================================
-- KING — permessi espliciti (da eseguire DOPO schema.sql, una volta sola)
-- I progetti Supabase recenti non danno più permessi automatici sulle tabelle nuove:
-- qui si concede SOLO ciò che serve. Le policy RLS di schema.sql restano il filtro
-- su quali righe ognuno può vedere.
-- ============================================================================
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
