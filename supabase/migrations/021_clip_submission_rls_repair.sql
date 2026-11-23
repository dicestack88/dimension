-- Repair Dimension clip submission RLS policies without weakening ownership checks.
-- Apply this migration in the Supabase SQL Editor after deploying this commit.

alter table public.clips enable row level security;
grant select on table public.clips to authenticated;
grant insert (user_id, caption, storage_path, status) on table public.clips to authenticated;
grant update (caption) on table public.clips to authenticated;
grant delete on table public.clips to authenticated;

drop policy if exists "Members can submit their own clips for review" on public.clips;
create policy "Members can submit their own clips for review"
  on public.clips for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and storage_path like (select auth.uid()::text) || '/%'
  );

-- Keep the upload private and enforce both per-file and per-account limits.
update storage.buckets
set public = false,
    file_size_limit = 15728640,
    allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime']
where id = 'darklands-clips';

create or replace function public.can_upload_dimension_clip(
  p_name text,
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_size bigint;
  v_used_size bigint;
begin
  if v_user_id is null
     or (storage.foldername(p_name))[1] is distinct from v_user_id::text then
    return false;
  end if;

  v_new_size := coalesce(
    nullif(p_metadata->>'size', '')::bigint,
    nullif(p_metadata->>'contentLength', '')::bigint,
    0
  );

  if v_new_size <= 0 or v_new_size > 15728640 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select coalesce(sum(coalesce(
    nullif(o.metadata->>'size', '')::bigint,
    nullif(o.metadata->>'contentLength', '')::bigint,
    0
  )), 0)
    into v_used_size
  from storage.objects o
  where o.bucket_id = 'darklands-clips'
    and o.owner_id = v_user_id::text;

  return v_used_size + v_new_size <= 104857600;
end;
$$;

revoke all on function public.can_upload_dimension_clip(text, jsonb) from public, anon;
grant execute on function public.can_upload_dimension_clip(text, jsonb) to authenticated;

drop policy if exists "Members can upload clips into their own folder" on storage.objects;
create policy "Members can upload clips into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'darklands-clips'
    and public.can_upload_dimension_clip(name, metadata)
  );
