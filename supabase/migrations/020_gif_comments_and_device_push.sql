-- Dicestack Dimension migration 020: GIF comments and device push subscriptions.
-- Run this migration in the Supabase SQL editor after reviewing it.

alter table public.clip_comments
  add column if not exists gif_provider text,
  add column if not exists gif_id text,
  add column if not exists gif_alt text;

alter table public.clip_comments
  drop constraint if exists clip_comments_body_length;

alter table public.clip_comments
  add constraint clip_comments_content_check check (
    (char_length(trim(body)) between 1 and 500)
    or (
      gif_provider = 'tenor'
      and gif_id is not null
      and char_length(gif_id) between 1 and 40
      and char_length(trim(body)) between 0 and 500
    )
  );

alter table public.clip_comments
  add constraint clip_comments_gif_alt_length
  check (gif_alt is null or char_length(gif_alt) <= 100);

create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 1 and 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth text not null check (char_length(auth) between 1 and 256),
  user_agent text not null default '' check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "Members can view their own push subscriptions" on public.push_subscriptions;
create policy "Members can view their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Members can register their own push subscriptions" on public.push_subscriptions;
create policy "Members can register their own push subscriptions"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Members can update their own push subscriptions" on public.push_subscriptions;
create policy "Members can update their own push subscriptions"
  on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Members can remove their own push subscriptions" on public.push_subscriptions;
create policy "Members can remove their own push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Supabase Realtime powers immediate in-app badge and notification-centre updates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Device push is sent by Netlify after trusted notification rows are inserted.
-- Store these two values as Supabase Vault secrets:
--   dimension_push_webhook_url = https://dicestack-netlify-api.netlify.app/.netlify/functions/push-deliver
--   dimension_push_webhook_secret = same random secret as Netlify PUSH_WEBHOOK_SECRET
create or replace function public.dimension_dispatch_device_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return new;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets
    where name = 'dimension_push_webhook_url'
    limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'dimension_push_webhook_secret'
    limit 1;

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using v_url,
      jsonb_build_object('notification_id', new.id),
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dimension-webhook-secret', v_secret
      );

  return new;
end;
$$;

revoke all on function public.dimension_dispatch_device_push() from public, anon, authenticated;
drop trigger if exists dimension_dispatch_device_push on public.notifications;
create trigger dimension_dispatch_device_push
  after insert on public.notifications
  for each row execute function public.dimension_dispatch_device_push();
