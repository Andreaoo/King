-- KING: il campo "username" diventa NOME E COGNOME (es. "Andrea De Filippis").
-- Spazi, accenti e apostrofi ammessi; non è più unico (più persone possono chiamarsi uguale).
-- Da eseguire UNA volta: Supabase → SQL Editor → New query → Run.
alter table public.profiles drop constraint if exists profiles_username_key;
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (username is null or char_length(btrim(username)) between 2 and 50);
