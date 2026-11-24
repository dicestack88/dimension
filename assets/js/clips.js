(() => {
  const config = window.DARKLANDS_CONFIG;
  const keyReady = config && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_");
  const clientReady = keyReady && window.supabase && window.supabase.createClient;
  const client = clientReady ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const status = $("clips-status");
  const uploadPanel = $("clips-upload-panel");
  const submissions = $("clips-submissions");
  const feedLayout = $("clips-feed-layout");
  const feed = $("clips-feed");
  const form = $("clip-upload-form");
  const fileInput = $("clip-file");
  const captionInput = $("clip-caption");
  const message = $("clip-upload-message");
  const uploadButton = $("clip-upload-button");
  const list = $("clips-list");
  const loadMoreButton = $("clips-load-more");
  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_DURATION_SECONDS = 45;
  const ACCOUNT_QUOTA_BYTES = 100 * 1024 * 1024;
  const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
  const PAGE_SIZE = 10;
  let currentUser = null;
  let feedOffset = 0;
  let feedLoading = false;
  let hasMore = true;
  let observer = null;

  const say = text => { if (status) status.textContent = text; };
  const feedback = (text, error = false) => {
    if (!message) return;
    message.textContent = text;
    message.style.color = error ? "#ffaaa9" : "#bdc9ff";
  };
  const verified = user => Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  const page = name => new URL(name, config.SITE_URL).toString();
  const formatDate = value => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const initials = name => (name || "D").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
  const roleBadge=role=>{const value=["owner","moderator","supporter","member"].includes(role)?role:"member";const badge=document.createElement("span");badge.className="dimension-role-badge role-"+value;badge.textContent=({owner:"OWNER",moderator:"MODERATOR",supporter:"SUPPORTER",member:"MEMBER"})[value];return badge;};
  const formatMB = bytes => (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
  async function getStorageUsage() {
    const { data, error } = await client.storage.from("darklands-clips").list(currentUser.id, { limit: 1000 });
    if (error) throw error;
    return (data || []).reduce((total, file) => total + Number(file.metadata?.size || file.metadata?.contentLength || 0), 0);
  }
  async function refreshStorageUsage() {
    const display = $("clips-storage-usage");
    if (!display) return 0;
    try {
      const used = await getStorageUsage();
      display.textContent = `Account storage: ${formatMB(used)} MB / 100 MB · ${formatMB(Math.max(0, ACCOUNT_QUOTA_BYTES - used))} MB remaining`;
      return used;
    } catch (error) {
      display.textContent = "Account storage usage is temporarily unavailable.";
      throw error;
    }
  }
  function readVideoDuration(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
      };
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const duration = video.duration;
        cleanup();
        if (!Number.isFinite(duration) || duration <= 0) reject(new Error("We couldn't read this video's duration. Please try exporting it again."));
        else resolve(duration);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("We couldn't read this video. Please try a different MP4, WebM or MOV file."));
      };
      video.src = objectUrl;
    });
  }

  function showPanel(name) {
    const isUpload = name === "upload";
    const isSubmissions = name === "submissions";
    uploadPanel.hidden = !isUpload;
    submissions.hidden = !isSubmissions;
    feedLayout.hidden = isSubmissions;
    $("feed-tab").classList.toggle("active", !isUpload && !isSubmissions);
    $("upload-toggle").classList.toggle("active", isUpload);
    $("submissions-toggle").classList.toggle("active", isSubmissions);
    if (!isUpload && !isSubmissions) feed.scrollTop = 0;
  }

  function renderSubmission(clip, url) {
    const article = document.createElement("article");
    article.className = "clip-submission";
    const media = document.createElement("video");
    media.className = "clip-video";
    media.controls = true;
    media.preload = "metadata";
    media.src = url;
    media.setAttribute("aria-label", "Your uploaded clip");
    const details = document.createElement("div");
    details.className = "clip-submission-details";
    const top = document.createElement("div");
    top.className = "clip-submission-top";
    const badge = document.createElement("span");
    badge.className = "clip-status-badge status-" + clip.status;
    badge.textContent = clip.status.toUpperCase();
    const date = document.createElement("time");
    date.textContent = formatDate(clip.created_at);
    top.append(badge, date);
    const caption = document.createElement("p");
    caption.className = "clip-submission-caption";
    caption.textContent = clip.caption || "No caption";
    details.append(top, caption);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "clip-delete-button";
    remove.textContent = "Delete clip";
    remove.addEventListener("click", async () => {
      if (remove.disabled || !window.confirm("Delete this clip permanently?")) return;
      remove.disabled = true;
      remove.textContent = "Deleting…";
      const { error: storageError } = await client.storage.from("darklands-clips").remove([clip.storage_path]);
      if (storageError) {
        remove.disabled = false;
        remove.textContent = "Delete clip";
        feedback("We couldn't delete this video file. Please try again.", true);
        return;
      }
      const { error: rowError } = await client.from("clips").delete().eq("id", clip.id).eq("user_id", currentUser.id);
      if (rowError) {
        feedback("The video file was removed, but its clip record couldn't be deleted. Please contact a moderator.", true);
        await loadClips();
        await refreshStorageUsage().catch(() => {});
        return;
      }
      feedback("Clip deleted. Your account storage has been freed.");
      await loadClips();
      await refreshStorageUsage().catch(() => {});
    });
    details.append(remove);
    article.append(media, details);
    return article;
  }

  async function loadClips() {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "clips-empty";
    loading.textContent = "Loading your clips…";
    list.append(loading);
    const { data, error } = await client.from("clips")
      .select("id, caption, storage_path, status, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (error) {
      list.replaceChildren();
      const failed = document.createElement("p");
      failed.className = "clips-empty";
      failed.textContent = "We couldn't load your submissions. Please refresh and try again.";
      list.append(failed);
      return;
    }
    list.replaceChildren();
    if (!data || data.length === 0) {
      const empty = document.createElement("p");
      empty.className = "clips-empty";
      empty.textContent = "You haven't uploaded any clips yet. Your submissions will appear here.";
      list.append(empty);
      return;
    }
    for (const clip of data) {
      const { data: signed, error: signedError } = await client.storage.from("darklands-clips").createSignedUrl(clip.storage_path, 3600);
      if (!signedError && signed?.signedUrl) list.append(renderSubmission(clip, signed.signedUrl));
    }
    if (!list.children.length) {
      const unavailable = document.createElement("p");
      unavailable.className = "clips-empty";
      unavailable.textContent = "Your clip records loaded, but their video files couldn't be opened.";
      list.append(unavailable);
    }
  }

  function feedState(title, detail) {
    const state = document.createElement("div");
    state.className = "clips-feed-state";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = detail;
    state.append(heading, copy);
    return state;
  }

  function activateVideo(video) {
    if (!video || video.dataset.ready === "1") return;
    video.dataset.ready = "1";
    video.muted = true;
    video.play().catch(() => {
      const hint = video.closest(".clip-card")?.querySelector(".clip-play-hint");
      if (hint) hint.hidden = false;
    });
  }

  function createClipCard(clip, profile, url, likes, commentCount, saveRows = [], repostRows = []) {
    const card = document.createElement("article");
    card.className = "clip-card";
    card.dataset.clipId = clip.id;

    const video = document.createElement("video");
    video.className = "clip-feed-video";
    video.src = url;
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", "Community clip. Tap to pause or play.");
    let viewRecorded = false;
    video.addEventListener("play", () => {
      if (viewRecorded) return;
      viewRecorded = true;
      client.rpc("dimension_record_clip_view", { p_clip_id: clip.id }).then(({ error }) => {
        if (error) console.warn("Clip view could not be recorded.");
      }).catch(() => {});
    });
    video.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    const shade = document.createElement("div");
    shade.className = "clip-card-shade";

    const sound = document.createElement("button");
    sound.className = "clip-sound-toggle";
    sound.type = "button";
    sound.textContent = "Muted";
    sound.setAttribute("aria-label", "Turn sound on");
    sound.addEventListener("click", event => {
      event.stopPropagation();
      video.muted = !video.muted;
      sound.textContent = video.muted ? "Muted" : "Sound on";
      sound.setAttribute("aria-label", video.muted ? "Turn sound on" : "Mute video");
    });

    const creator = document.createElement("div");
    creator.className = "clip-creator";
    const avatar = document.createElement("span");
    avatar.className = "clip-avatar";
    if (profile?.avatar_url && /^https?:\/\//i.test(profile.avatar_url)) {
      const image = document.createElement("img");
      image.src = profile.avatar_url;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      avatar.append(image);
    } else avatar.textContent = initials(profile?.display_name);
    const identity = document.createElement("a");
    identity.className = "clip-identity clip-creator-link";
    identity.href = profile?.username ? page("profile.html") + "?u=" + encodeURIComponent(profile.username) : "#";
    identity.setAttribute("aria-label", "View creator profile");
    const display = document.createElement("strong");
    display.textContent = profile?.display_name || "Darklands member";
    const username = document.createElement("span");
    username.textContent = "@" + (profile?.username || "member");
    display.append(roleBadge(profile?.role));
    identity.append(display, username);
    creator.append(avatar, identity);

    const caption = document.createElement("p");
    caption.className = "clip-feed-caption";
    caption.textContent = clip.caption || "A moment from the community.";
    const date = document.createElement("span");
    date.className = "clip-feed-date";
    date.textContent = formatDate(clip.created_at);

    const actions = document.createElement("div");
    actions.className = "clip-actions";
    const like = document.createElement("button");
    like.type = "button";
    like.className = "clip-action clip-like";
    let likeRows = likes || [];
    let liked = likeRows.some(row => row.user_id === currentUser.id);
    const paintLike = () => {
      like.classList.toggle("liked", liked);
      like.querySelector("span").textContent = liked ? "♥" : "♡";
      like.querySelector("small").textContent = String(likeRows.length);
      like.setAttribute("aria-label", (liked ? "Unlike" : "Like") + " clip, " + likeRows.length + " likes");
    };
    like.innerHTML = '<span aria-hidden="true">♡</span><small>0</small>';
    paintLike();
    like.addEventListener("click", async event => {
      event.stopPropagation();
      if (like.disabled) return;
      const wasLiked = liked;
      const previousRows = likeRows;
      liked = !wasLiked;
      likeRows = wasLiked
        ? likeRows.filter(row => row.user_id !== currentUser.id)
        : [...likeRows, { user_id: currentUser.id }];
      paintLike();
      like.disabled = true;
      const result = wasLiked
        ? await client.from("clip_likes").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_likes").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) {
        liked = wasLiked;
        likeRows = previousRows;
        paintLike();
        say("Couldn't update your like. Please try again.");
      }
      like.disabled = false;
    });

    const save = document.createElement("button");
    save.type = "button";
    save.className = "clip-action clip-save";
    let saved = saveRows.some(row => row.user_id === currentUser.id);
    const paintSave = () => { save.classList.toggle("liked", saved); save.innerHTML = '<span aria-hidden="true">' + (saved ? "▣" : "▢") + '</span><small>' + (saved ? "Saved" : "Save") + '</small>'; };
    paintSave();
    save.addEventListener("click", async event => {
      event.stopPropagation(); if (save.disabled) return;
      const previous = saved; saved = !saved; paintSave(); save.disabled = true;
      const result = previous
        ? await client.from("clip_saves").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_saves").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) { saved = previous; paintSave(); say("Couldn't update your saved clips. Please try again."); }
      save.disabled = false;
    });

    const repost = document.createElement("button");
    repost.type = "button";
    repost.className = "clip-action clip-repost";
    repost.title = "Repost instantly — no separate approval required. The original clip must already be approved.";
    let reposted = repostRows.some(row => row.user_id === currentUser.id);
    const paintRepost = () => { repost.classList.toggle("liked", reposted); repost.innerHTML = '<span aria-hidden="true">⟳</span><small>' + (repostRows.length + (reposted && !repostRows.some(row => row.user_id === currentUser.id) ? 1 : 0)) + ' · ' + (reposted ? "Reposted" : "Repost") + '</small>'; };
    paintRepost();
    repost.addEventListener("click", async event => {
      event.stopPropagation(); if (repost.disabled) return;
      const previous = reposted; reposted = !reposted; paintRepost(); repost.disabled = true;
      const result = previous
        ? await client.from("clip_reposts").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_reposts").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) { reposted = previous; paintRepost(); say("Couldn't update your repost. Please try again."); }
      else { if (previous) repostRows = repostRows.filter(row => row.user_id !== currentUser.id); else repostRows = [...repostRows, { user_id: currentUser.id }]; paintRepost(); }
      repost.disabled = false;
    });

    const comment = document.createElement("button");
    comment.type = "button";
    comment.className = "clip-action";
    comment.innerHTML = '<span aria-hidden="true">▢</span><small>' + (commentCount || 0) + '</small>';
    comment.setAttribute("aria-label", "View comments");
    const commentsPanel = document.createElement("section");
    commentsPanel.className = "clip-comments-panel";
    commentsPanel.hidden = true;
    commentsPanel.setAttribute("aria-label", "Clip comments");
    const commentsHeader = document.createElement("div");
    commentsHeader.className = "clip-comments-header";
    const commentsTitle = document.createElement("strong");
    commentsTitle.textContent = "Comments";
    const closeComments = document.createElement("button");
    closeComments.type = "button";
    closeComments.className = "clip-comments-close";
    closeComments.textContent = "×";
    closeComments.setAttribute("aria-label", "Close comments");
    commentsHeader.append(commentsTitle, closeComments);
    const commentsList = document.createElement("div");
    commentsList.className = "clip-comments-list";
    const commentForm = document.createElement("form");
    commentForm.className = "clip-comment-form";
    // Keep reply state scoped to this clip card; normal comments use null.
    let replyTo = null;
    const gifButton = document.createElement("button");
    gifButton.type = "button";
    gifButton.className = "clip-gif-button";
    gifButton.textContent = "GIF";
    const gifPicker = document.createElement("div");
    gifPicker.className = "clip-gif-picker";
    gifPicker.hidden = true;
    const gifSearch = document.createElement("input");
    gifSearch.type = "search";
    gifSearch.maxLength = 80;
    gifSearch.placeholder = "Search GIPHY…";
    gifSearch.setAttribute("aria-label", "Search GIPHY GIFs");
    const gifResults = document.createElement("div");
    gifResults.className = "clip-gif-results";
    const gifStatus = document.createElement("p");
    gifStatus.className = "clip-gif-status";
    gifStatus.textContent = "Open the GIF picker to browse trending GIFs.";
    gifPicker.append(gifSearch, gifStatus, gifResults);
    const gifPreview = document.createElement("div");
    gifPreview.className = "clip-gif-selected";
    gifPreview.hidden = true;
    let selectedGif = null;
    const commentInput = document.createElement("textarea");
    commentInput.maxLength = 500;
    commentInput.rows = 2;
    commentInput.placeholder = "Add a comment…";
    commentInput.required = false;
    commentInput.setAttribute("aria-label", "Write a comment");
    const commentSubmit = document.createElement("button");
    commentSubmit.type = "submit";
    commentSubmit.textContent = "Post";
    commentForm.append(gifButton, commentInput, commentSubmit);
    commentsPanel.append(commentsHeader, commentsList, gifPicker, gifPreview, commentForm);

    const giphyConfig = window.DIMENSION_GIPHY_CONFIG || {};
    const getGiphyKey = () => String(giphyConfig.API_KEY || "").trim();
    const giphyCustomerId = "dimension-" + (window.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const giphyAttribution = () => {
      const link = document.createElement("a");
      link.className = "clip-gif-attribution";
      link.href = "https://giphy.com/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Powered by GIPHY";
      return link;
    };
    const trackGiphyAction = (analytics, action) => {
      const trackingUrl = analytics?.[action]?.url;
      if (!trackingUrl) return;
      try {
        const url = new URL(trackingUrl);
        url.searchParams.set("customer_id", giphyCustomerId);
        url.searchParams.set("ts", String(Date.now()));
        fetch(url.toString(), { mode: "no-cors", cache: "no-store", keepalive: true }).catch(() => {});
      } catch (_) {}
    };
    const fetchGiphy = async (path, params) => {
      const key = getGiphyKey();
      if (!key) throw new Error("GIPHY isn't configured yet. Add the public GIPHY API key to assets/js/giphy-config.js.");
      const url = new URL("https://api.giphy.com/v1/gifs" + (path ? "/" + path : ""));
      url.search = new URLSearchParams({ api_key: key, rating: "g", ...params }).toString();
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.meta?.status !== 200) throw new Error(payload.meta?.msg || "GIPHY is temporarily unavailable.");
      return payload;
    };
    const renderGiphyResults = async query => {
      const payload = query
        ? await fetchGiphy("search", { q: query.slice(0, 50), limit: "12", bundle: "messaging_non_clips" })
        : await fetchGiphy("trending", { limit: "12", bundle: "messaging_non_clips" });
      const results = payload.data || [];
      gifResults.replaceChildren();
      gifStatus.textContent = results.length ? "Choose a GIF to add to your comment." : "No GIFs found. Try another search.";
      gifPicker.querySelectorAll(".clip-gif-attribution").forEach(node => node.remove());
      gifPicker.append(giphyAttribution());
      for (const item of results) {
        const previewUrl = item.images?.fixed_height_small?.url || item.images?.fixed_width_small?.url || item.images?.original?.url;
        const choice = document.createElement("button"); choice.type = "button"; choice.className = "clip-gif-choice";
        const image = document.createElement("img"); image.src = previewUrl || ""; image.alt = item.title || "GIPHY GIF"; image.loading = "lazy";
        choice.append(image); choice.setAttribute("aria-label", "Use GIF: " + (item.title || "GIF"));
        choice.addEventListener("click", () => {
          trackGiphyAction(item.analytics, "onclick");
          selectedGif = { provider: "giphy", id: String(item.id), title: String(item.title || "GIPHY GIF").slice(0, 100), analytics: item.analytics };
          gifPreview.replaceChildren();
          const preview = document.createElement("img"); preview.src = previewUrl || ""; preview.alt = selectedGif.title;
          preview.addEventListener("load", () => trackGiphyAction(item.analytics, "onload"), { once: true });
          gifPreview.append(preview, giphyAttribution());
          const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove GIF";
          remove.addEventListener("click", () => { selectedGif = null; gifPreview.hidden = true; gifPreview.replaceChildren(); });
          gifPreview.append(remove); gifPreview.hidden = false; gifPicker.hidden = true; gifButton.textContent = "GIF selected";
        });
        gifResults.append(choice);
      }
    };
    const renderGifResults = async query => {
      gifResults.replaceChildren();
      gifStatus.textContent = "Searching GIPHY…";
      try {
        await renderGiphyResults(query);
      } catch (error) {
        gifResults.replaceChildren();
        gifStatus.textContent = error.message || "GIPHY search is unavailable.";
      }
    };
    gifButton.addEventListener("click", () => {
      gifPicker.hidden = !gifPicker.hidden;
      if (!gifPicker.hidden && !gifResults.children.length) renderGifResults(gifSearch.value.trim());
    });
    let gifSearchTimer;
    gifSearch.addEventListener("input", () => {
      clearTimeout(gifSearchTimer);
      gifSearchTimer = setTimeout(() => renderGifResults(gifSearch.value.trim()), 250);
    });

    const loadComments = async () => {
      commentsList.replaceChildren();
      const loading = document.createElement("p"); loading.className = "clip-comments-empty"; loading.textContent = "Loading comments…"; commentsList.append(loading);
      const [{ data, error }, { data: heartRows, error: heartError }, { data: ownRole, error: ownRoleError }] = await Promise.all([
        client.from("clip_comments").select("id, user_id, body, gif_provider, gif_id, gif_alt, created_at, parent_comment_id").eq("clip_id", clip.id).order("created_at", { ascending: true }).limit(150),
        client.from("clip_comment_likes").select("comment_id, user_id").limit(1000),
        client.from("dimension_member_roles").select("role").eq("user_id", currentUser.id).maybeSingle()
      ]);
      commentsList.replaceChildren();
      if (error || heartError || ownRoleError) { const failed=document.createElement("p");failed.className="clip-comments-empty";failed.textContent="Comments couldn't load. Please try again.";commentsList.append(failed);return; }
      if (!data?.length) { const empty=document.createElement("p");empty.className="clip-comments-empty";empty.textContent="No comments yet. Start the conversation.";commentsList.append(empty); }
      else {
        const ids=[...new Set(data.map(item=>item.user_id))];
        const {data:authors}=await client.from("profiles").select("id,username,display_name").in("id",ids);
        const {data:authorRoles,error:authorRolesError}=await client.from("dimension_member_roles").select("user_id,role").in("user_id",ids);
        if(authorRolesError)throw authorRolesError;
        const giphyCommentMap = new Map();
        const giphyIds = [...new Set(data.filter(item => item.gif_provider === "giphy" && item.gif_id).map(item => String(item.gif_id)))];
        if (giphyIds.length && getGiphyKey()) {
          for (let offset = 0; offset < giphyIds.length; offset += 100) {
            try {
              const batch = giphyIds.slice(offset, offset + 100);
              const payload = await fetchGiphy("", { ids: batch.join(",") });
              for (const gifItem of payload.data || []) giphyCommentMap.set(String(gifItem.id), gifItem);
            } catch (error) {
              console.warn("GIPHY comment lookup failed:", error.message);
            }
          }
        }
        const authorRoleMap=new Map((authorRoles||[]).map(row=>[row.user_id,row.role]));
        const authorMap=new Map((authors||[]).map(author=>[author.id,{...author,role:authorRoleMap.get(author.id)||"member"}]));
        const roots=data.filter(item=>!item.parent_comment_id);
        const replies=new Map();
        for(const item of data.filter(item=>item.parent_comment_id)){if(!replies.has(item.parent_comment_id))replies.set(item.parent_comment_id,[]);replies.get(item.parent_comment_id).push(item);}
        const renderComment=(item,isReply=false)=>{
          const row=document.createElement("article");row.className="clip-comment"+(isReply?" clip-comment-reply":"");
          const authorProfile=authorMap.get(item.user_id);
          const author=document.createElement("strong");author.textContent=authorProfile?.display_name||"Darklands member";author.append(roleBadge(authorProfile?.role));
          const handle=document.createElement("span");handle.className="clip-comment-handle";handle.textContent="@"+(authorProfile?.username||"member")+" · "+new Date(item.created_at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
          const body=document.createElement("p");body.textContent=item.body||"";
          const controls=document.createElement("div");controls.className="clip-comment-controls";
          const hearts=heartRows.filter(row=>row.comment_id===item.id);let hearted=hearts.some(row=>row.user_id===currentUser.id);let heartCount=hearts.length;
          const heart=document.createElement("button");heart.type="button";heart.className="clip-comment-control"+(hearted?" liked":"");heart.textContent=(hearted?"♥ ":"♡ ")+heartCount;
          heart.setAttribute("aria-label",(hearted?"Remove heart":"Heart")+" on comment, "+heartCount+" hearts");
          heart.addEventListener("click",async()=>{
            if(heart.disabled)return;const before=hearted;hearted=!before;heartCount=Math.max(0,heartCount+(hearted?1:-1));heart.disabled=true;heart.classList.toggle("liked",hearted);heart.textContent=(hearted?"♥ ":"♡ ")+heartCount;
            heart.setAttribute("aria-label",(hearted?"Remove heart":"Heart")+" on comment, "+heartCount+" hearts");
            const result=before?await client.from("clip_comment_likes").delete().eq("comment_id",item.id).eq("user_id",currentUser.id):await client.from("clip_comment_likes").insert({comment_id:item.id,user_id:currentUser.id});
            if(result.error){hearted=before;heartCount=Math.max(0,heartCount+(before?1:-1));heart.classList.toggle("liked",hearted);heart.textContent=(hearted?"♥ ":"♡ ")+heartCount;heart.setAttribute("aria-label",(hearted?"Remove heart":"Heart")+" on comment, "+heartCount+" hearts");say("Couldn't update that comment heart.");}
            heart.disabled=false;
          });
          controls.append(heart);
          if(["owner","moderator"].includes(ownRole?.role)){
            const remove=document.createElement("button");remove.type="button";remove.className="clip-comment-control";remove.textContent="Delete";
            remove.addEventListener("click",async()=>{
              if(remove.disabled||!window.confirm("Delete this comment and its replies? This cannot be undone."))return;
              const reason=(window.prompt("Reason for moderator deletion (required):","Community guidelines")||"").trim();
              if(reason.length<3){say("Enter a reason of at least 3 characters.");return;}
              remove.disabled=true;remove.textContent="Deleting…";
              const {error}=await client.rpc("dimension_moderator_delete_comment",{p_comment_id:item.id,p_reason:reason.slice(0,500)});
              if(error){remove.disabled=false;remove.textContent="Delete";say(error.message||"Couldn't delete this comment.");return;}
              say("Comment deleted.");await loadComments();
            });
            controls.append(remove);
          }
          if(item.user_id!==currentUser.id){
            const report=document.createElement("button");report.type="button";report.className="clip-comment-control";report.textContent="Report";
            report.addEventListener("click",async()=>{
              const reason=window.prompt("Report reason: spam, harassment, inappropriate, privacy, impersonation, or other","other");
              if(reason===null)return;
              const normalized=reason.trim().toLowerCase().replace(/\s+/g,"_");
              if(!["spam","harassment","inappropriate","privacy","impersonation","other"].includes(normalized)){say("Please enter one of the listed report reasons.");return;}
              const details=window.prompt("Optional details (max 500 characters):","")||"";
              report.disabled=true;
              const {error}=await client.rpc("dimension_submit_content_report",{p_target_type:"comment",p_target_id:item.id,p_reason:normalized,p_details:details.slice(0,500)});
              report.disabled=false;
              say(error?(error.message||"Couldn't submit this report."):"Comment report submitted. Thanks for helping keep Dimension safe.");
            });
            controls.append(report);
          }
          if(!isReply){const reply=document.createElement("button");reply.type="button";reply.className="clip-comment-control";reply.textContent="Reply";reply.addEventListener("click",()=>{replyTo=item.id;commentInput.placeholder="Replying to "+(authorProfile?.display_name||"comment")+"…";commentInput.focus();commentSubmit.textContent="Reply";});controls.append(reply);}
          if (item.gif_provider === "giphy" && item.gif_id) {
            row.append(author, handle);
            if (item.body) row.append(body);
            const gifItem = giphyCommentMap.get(String(item.gif_id));
            if (gifItem?.images?.original?.url) {
              const gif = document.createElement("img");
              gif.className = "clip-comment-gif";
              gif.src = gifItem.images.original.url;
              gif.alt = item.gif_alt || "GIPHY GIF in comment";
              gif.loading = "lazy";
              gif.decoding = "async";
              gif.addEventListener("load", () => trackGiphyAction(gifItem.analytics, "onload"), { once: true });
              gif.addEventListener("click", () => trackGiphyAction(gifItem.analytics, "onclick"));
              const attribution = giphyAttribution();
              if (gifItem.url) attribution.href = gifItem.url;
              row.append(gif, attribution);
              if (gifItem.user?.username) {
                const creator = document.createElement("a");
                creator.className = "clip-gif-attribution";
                creator.href = gifItem.user.profile_url || gifItem.url || "https://giphy.com/";
                creator.target = "_blank";
                creator.rel = "noopener noreferrer";
                creator.textContent = "by " + (gifItem.user.display_name || "@" + gifItem.user.username);
                row.append(creator);
              }
            } else {
              const unavailable = document.createElement("p");
              unavailable.className = "clip-gif-status";
              unavailable.textContent = "GIPHY GIF unavailable";
              row.append(unavailable);
            }
            row.append(controls);
          } else {
            row.append(author, handle, body, controls);
          }
          if(!isReply){for(const child of replies.get(item.id)||[])row.append(renderComment(child,true));}
          return row;
        };
        for(const item of roots)commentsList.append(renderComment(item));
        for(const item of data.filter(item=>item.parent_comment_id&&!roots.some(root=>root.id===item.parent_comment_id)))commentsList.append(renderComment(item,true));
      }
      comment.querySelector("small").textContent=String(data?.length||0);
    };

    comment.addEventListener("click", async event => {
      event.stopPropagation();
      const opening = commentsPanel.hidden;
      commentsPanel.hidden = !opening;
      if (opening) await loadComments();
    });
    closeComments.addEventListener("click", () => { commentsPanel.hidden = true; });
    commentForm.addEventListener("submit", async event => {
      event.preventDefault();
      const body = commentInput.value.trim();
      if ((!body && !selectedGif) || commentSubmit.disabled) return;
      commentSubmit.disabled = true;
      commentSubmit.textContent = "Posting…";
      try {
        const insertController = new AbortController();
        const insertTimeout = window.setTimeout(() => insertController.abort(), 20000);
        let insertResult;
        try {
          insertResult = await client.from("clip_comments").insert({
            clip_id: clip.id,
            user_id: currentUser.id,
            body,
            parent_comment_id: replyTo,
            gif_provider: selectedGif?.provider || null,
            gif_id: selectedGif?.id || null,
            gif_alt: selectedGif?.title || null
          }).abortSignal(insertController.signal);
        } finally {
          window.clearTimeout(insertTimeout);
        }
        const { error } = insertResult;
        if (error) {
          console.error("Dimension comment insert failed:", error);
          say(error.message || "Couldn't post your comment. Please try again.");
          return;
        }

        if (selectedGif?.provider === "giphy") {
          trackGiphyAction(selectedGif.analytics, "onsent");
        }
        commentInput.value = "";
        selectedGif = null;
        gifPreview.hidden = true;
        gifPreview.replaceChildren();
        gifButton.textContent = "GIF";
        replyTo = null;
        commentInput.placeholder = "Add a comment…";
        commentSubmit.textContent = "Post";
        commentSubmit.disabled = false;

        loadComments().catch(error => {
          console.error("Dimension comment refresh failed:", error);
          say("Your comment was posted, but the comments couldn't refresh. Reload the page to see it.");
        });
      } catch (error) {
        console.error("Dimension comment submission failed:", error);
        say(error?.message || "Couldn't post your comment. Please try again.");
      } finally {
        commentSubmit.disabled = false;
        commentSubmit.textContent = "Post";
      }
    });

    const fullscreen = document.createElement("button");
    fullscreen.type = "button";
    fullscreen.className = "clip-action clip-fullscreen";
    fullscreen.innerHTML = '<span aria-hidden="true">⛶</span><small>Fullscreen</small>';
    fullscreen.setAttribute("aria-label", "View clip fullscreen");
    fullscreen.addEventListener("click", async event => {
      event.stopPropagation();
      try {
        if (document.fullscreenElement === card) await document.exitFullscreen();
        else if (card.requestFullscreen) await card.requestFullscreen();
        else say("Fullscreen isn't supported by this browser.");
      } catch (_) { say("Fullscreen couldn't be opened. Try your browser's fullscreen shortcut."); }
    });

    const share = document.createElement("button");
    share.type = "button";
    share.className = "clip-action";
    share.innerHTML = '<span aria-hidden="true">↗</span><small>Share</small>';
    share.addEventListener("click", async event => {
      event.stopPropagation();
      const shareData = { title: "Darklands clip", text: caption.textContent, url: window.location.href.split("#")[0] + "#clip-" + clip.id };
      try {
        if (navigator.share) await navigator.share(shareData);
        else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareData.url);
          share.querySelector("small").textContent = "Copied";
          setTimeout(() => { share.querySelector("small").textContent = "Share"; }, 1800);
        }
      } catch (error) {
        if (error.name !== "AbortError") say("Sharing isn't available in this browser.");
      }
    });
    const reportClip = document.createElement("button");
    reportClip.type = "button";
    reportClip.className = "clip-action";
    reportClip.innerHTML = '<span aria-hidden="true">⚑</span><small>Report</small>';
    reportClip.setAttribute("aria-label", "Report this clip");
    reportClip.hidden = clip.user_id === currentUser.id;
    reportClip.addEventListener("click", async event => {
      event.stopPropagation();
      const reason = window.prompt("Report reason: spam, harassment, inappropriate, privacy, or other", "other");
      if (reason === null) return;
      const normalized = reason.trim().toLowerCase().replace(/\s+/g, "_");
      if (!["spam", "harassment", "inappropriate", "privacy", "other"].includes(normalized)) {
        say("Please enter one of the listed report reasons.");
        return;
      }
      const details = window.prompt("Optional details (max 500 characters):", "") || "";
      reportClip.disabled = true;
      const { error } = await client.from("clip_reports").insert({
        clip_id: clip.id, reporter_id: currentUser.id, reason: normalized, details: details.slice(0, 500)
      });
      reportClip.disabled = false;
      say(error ? (error.message || "Couldn't submit this report.") : "Clip report submitted. Thanks for helping keep Dimension safe.");
    });
    actions.append(like, comment, save, repost, share, reportClip, fullscreen);

    const hint = document.createElement("span");
    hint.className = "clip-play-hint";
    hint.textContent = "Tap video to play";
    hint.hidden = true;
    card.append(video, shade, sound, creator, caption, date, actions, commentsPanel, hint);
    return card;
  }


  async function loadFeed(reset = false) {
    if (feedLoading || (!hasMore && !reset)) return;
    feedLoading = true;
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = "Loading…";
    if (reset) {
      feedOffset = 0;
      hasMore = true;
      feed.replaceChildren(feedState("Finding your next clip…", "Loading approved videos from the community."));
    }
    try {
      const { data: clips, error } = await client.from("clips")
        .select("id, user_id, caption, storage_path, created_at")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .range(feedOffset, feedOffset + PAGE_SIZE - 1);
      if (error) throw error;
      if (reset) feed.replaceChildren();
      if (!clips?.length && feedOffset === 0) {
        feed.append(feedState("It's quiet in here… for now.", "No approved clips yet. Be the first to share a moment."));
        hasMore = false;
        loadMoreButton.hidden = true;
        return;
      }
      if (!clips?.length) {
        hasMore = false;
        loadMoreButton.hidden = true;
        return;
      }
      const userIds = [...new Set(clips.map(clip => clip.user_id))];
      const { data: profiles, error: profileError } = await client.from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", userIds);
      if (profileError) throw profileError;
      const {data:roleRows,error:roleError}=await client.from("dimension_member_roles").select("user_id,role").in("user_id",userIds);
      if(roleError)throw roleError;
      const roleMap=new Map((roleRows||[]).map(row=>[row.user_id,row.role]));
      const profileMap = new Map((profiles || []).map(profile => [profile.id, {...profile,role:roleMap.get(profile.id)||"member"}]));
      const clipIds = clips.map(clip => clip.id);
      const [{ data: likeRows, error: likesError }, { data: commentRows, error: commentsError }, { data: saveRows, error: savesError }, { data: repostRows, error: repostsError }] = await Promise.all([
        client.from("clip_likes").select("clip_id, user_id").in("clip_id", clipIds),
        client.from("clip_comments").select("id, clip_id").in("clip_id", clipIds),
        client.from("clip_saves").select("clip_id, user_id").in("clip_id", clipIds),
        client.from("clip_reposts").select("clip_id, user_id").in("clip_id", clipIds)
      ]);
      if (likesError) throw likesError;
      if (commentsError) throw commentsError;
      if (savesError) throw savesError;
      if (repostsError) throw repostsError;
      const likesByClip = new Map();
      const commentsByClip = new Map();
      const savesByClip = new Map();
      const repostsByClip = new Map();
      for (const row of likeRows || []) {
        if (!likesByClip.has(row.clip_id)) likesByClip.set(row.clip_id, []);
        likesByClip.get(row.clip_id).push(row);
      }
      for (const row of commentRows || []) commentsByClip.set(row.clip_id, (commentsByClip.get(row.clip_id) || 0) + 1);
      for (const row of saveRows || []) { if (!savesByClip.has(row.clip_id)) savesByClip.set(row.clip_id, []); savesByClip.get(row.clip_id).push(row); }
      for (const row of repostRows || []) { if (!repostsByClip.has(row.clip_id)) repostsByClip.set(row.clip_id, []); repostsByClip.get(row.clip_id).push(row); }
      const prepared = await Promise.all(clips.map(async clip => {
        const { data: signed, error: signedError } = await client.storage.from("darklands-clips")
          .createSignedUrl(clip.storage_path, 3600);
        return signedError || !signed?.signedUrl ? null : { clip, profile: profileMap.get(clip.user_id), url: signed.signedUrl };
      }));
      for (const item of prepared) {
        if (!item) continue;
        const card = createClipCard(item.clip, item.profile, item.url, likesByClip.get(item.clip.id) || [], commentsByClip.get(item.clip.id) || 0, savesByClip.get(item.clip.id) || [], repostsByClip.get(item.clip.id) || []);
        feed.append(card);
        if (observer) observer.observe(card);
        if (window.location.hash === "#clip-" + item.clip.id) card.scrollIntoView();
      }
      feedOffset += clips.length;
      hasMore = clips.length === PAGE_SIZE;
      loadMoreButton.hidden = !hasMore;
      if (!feed.children.length) feed.append(feedState("Videos couldn't load.", "Refresh the page and try again."));
    } catch (error) {
      if (reset) feed.replaceChildren();
      feed.append(feedState("We couldn't load the feed.", "Check your connection and refresh to try again."));
      say("The community feed couldn't be loaded.");
      loadMoreButton.hidden = true;
    } finally {
      feedLoading = false;
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = "Load more clips";
    }
  }

  async function start() {
    if (!client) {
      say("Account services aren't configured. Please try again later.");
      return;
    }
    try {
      const { data, error } = await client.auth.getUser();
      currentUser = data && data.user;
      if (error || !verified(currentUser)) {
        await client.auth.signOut();
        window.location.replace(page("login.html"));
        return;
      }
      const {data:ownProfile}=await client.from("profiles").select("username").eq("id",currentUser.id).maybeSingle();
      const ownProfileLink=$("clips-own-profile");
      if(ownProfile?.username&&ownProfileLink)ownProfileLink.href=page("profile.html")+"?u="+encodeURIComponent(ownProfile.username);
      say("You're signed in. Enjoy the feed.");
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const video = entry.target.querySelector("video");
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            feed.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); });
            activateVideo(video);
          } else video.pause();
        });
      }, { root: feed, threshold: [0, 0.25, 0.65, 1] });
      await loadFeed(true);
      await loadClips();
      await refreshStorageUsage().catch(() => {});
    } catch (error) {
      say("We couldn't verify your session. Please log in again.");
      await client.auth.signOut();
      window.location.replace(page("login.html"));
    }
  }
  $("feed-tab").addEventListener("click", () => showPanel("feed"));
  $("upload-toggle").addEventListener("click", () => showPanel("upload"));
  $("upload-close").addEventListener("click", () => showPanel("feed"));
  $("submissions-toggle").addEventListener("click", () => showPanel("submissions"));
  $("clips-refresh").addEventListener("click", loadClips);
  loadMoreButton.addEventListener("click", () => loadFeed(false));
  feed.addEventListener("scroll", () => {
    if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 500 && hasMore) loadFeed(false);
  }, { passive: true });

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
    const cards = [...feed.querySelectorAll(".clip-card")];
    if (!cards.length) return;
    const active = cards.find(card => {
      const rect = card.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.65 && rect.bottom > window.innerHeight * 0.35;
    }) || cards[0];
    const video = active.querySelector("video");
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else active.requestFullscreen?.().catch(() => say("Fullscreen isn't available here."));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = cards.indexOf(active);
      const next = cards[Math.max(0, Math.min(cards.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      next?.scrollIntoView({behavior:"smooth",block:"start"});
    } else if (event.code === "Space" && video) {
      event.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });

  if (captionInput) captionInput.addEventListener("input", () => {
    $("clip-caption-count").textContent = captionInput.value.length + " / 300";
  });

  if (form) form.addEventListener("submit", async event => {
    event.preventDefault();
    feedback("");
    const file = fileInput.files && fileInput.files[0];
    const caption = captionInput.value.trim();
    if (!file) return feedback("Choose a video file first.", true);
    if (!ALLOWED_TYPES.includes(file.type)) return feedback("Please choose an MP4, WebM or MOV video.", true);
    if (file.size > MAX_BYTES) return feedback("That video is larger than the 15 MB limit.", true);
    if (caption.length > 300) return feedback("Your caption must be 300 characters or fewer.", true);
    try {
      const duration = await readVideoDuration(file);
      if (duration > MAX_DURATION_SECONDS) return feedback("Clips must be 45 seconds or shorter.", true);
      const used = await getStorageUsage();
      if (used + file.size > ACCOUNT_QUOTA_BYTES) {
        await refreshStorageUsage().catch(() => {});
        return feedback("You've reached your 100 MB account upload limit. Delete one of your clips to free up space.", true);
      }
    } catch (validationError) {
      return feedback(validationError.message || "We couldn't validate this video.", true);
    }
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading…";
    fileInput.disabled = true;
    captionInput.disabled = true;
    const objectName = crypto.randomUUID() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
    const storagePath = currentUser.id + "/" + objectName;
    let uploaded = false;
    try {
      const { error: uploadError } = await client.storage.from("darklands-clips")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;
      const { error: insertError } = await client.from("clips").insert({
        user_id: currentUser.id,
        caption,
        storage_path: storagePath,
        status: "pending"
      });
      if (insertError) throw insertError;
      form.reset();
      $("clip-caption-count").textContent = "0 / 300";
      feedback("Upload complete. Your clip is now pending review.");
      await loadClips();
      await refreshStorageUsage().catch(() => {});
      showPanel("submissions");
    } catch (error) {
      if (uploaded) await client.storage.from("darklands-clips").remove([storagePath]);
      feedback(error.message || "Upload failed. Please try again.", true);
    } finally {
      uploadButton.disabled = false;
      uploadButton.innerHTML = 'Upload for review <span aria-hidden="true">↗</span>';
      fileInput.disabled = false;
      captionInput.disabled = false;
    }
  });

  $("clips-logout").addEventListener("click", async () => {
    const logout = $("clips-logout");
    logout.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      logout.disabled = false;
      say("Could not sign out. Please try again.");
      return;
    }
    window.location.replace(page("login.html"));
  });

  start();
})();