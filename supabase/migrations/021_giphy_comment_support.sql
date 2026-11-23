-- Dimension migration 021: allow GIPHY GIF references in clip comments.
-- Apply this after migration 020. Existing Tenor rows remain valid.

alter table public.clip_comments
  drop constraint if exists clip_comments_content_check,
  drop constraint if exists clip_comments_gif_alt_length,
  drop constraint if exists clip_comments_gif_reference_check;

alter table public.clip_comments
  add constraint clip_comments_content_check check (
    char_length(trim(body)) between 1 and 500
    or (
      gif_provider in ('tenor', 'giphy')
      and gif_id is not null
      and char_length(gif_id) between 1 and 64
      and char_length(trim(body)) between 0 and 500
    )
  ),
  add constraint clip_comments_gif_alt_length
    check (gif_alt is null or char_length(gif_alt) <= 100),
  add constraint clip_comments_gif_reference_check check (
    (gif_provider is null and gif_id is null and gif_alt is null)
    or (
      gif_provider = 'tenor'
      and gif_id ~ '^[0-9]{5,30}$'
    )
    or (
      gif_provider = 'giphy'
      and gif_id ~ '^[A-Za-z0-9_-]{1,64}$'
    )
  );
