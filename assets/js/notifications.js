(() => {
  const config=window.DARKLANDS_CONFIG;
  const ready=config&&config.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")&&window.supabase?.createClient;
  const client=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("notifications-status"),list=$("notifications-list"),readAll=$("notifications-read-all");
  const page=name=>new URL(name,config.SITE_URL).toString();
  const roleBadge=role=>{const value=["owner","moderator","supporter","member"].includes(role)?role:"member";const badge=document.createElement("span");badge.className="dimension-role-badge role-"+value;badge.textContent=({owner:"OWNER",moderator:"MODERATOR",supporter:"SUPPORTER",member:"MEMBER"})[value];return badge;};
  const copy={
    clip_like:"liked your clip",comment:"commented on your clip",comment_reply:"replied to your comment",
    comment_like:"hearted your comment",clip_repost:"reposted your clip",follow:"started following you",message:"sent you a message",message_request:"sent you a message request"
  };
  let user=null;
  function message(text){status.textContent=text;}
  function empty(text){list.replaceChildren();const p=document.createElement("p");p.className="notifications-empty";p.textContent=text;list.append(p);}
  async function load(){
    message("Loading your notifications…");
    const {data,error}=await client.from("notifications").select("id,actor_id,type,clip_id,comment_id,conversation_id,created_at,read_at").order("created_at",{ascending:false}).limit(80);
    if(error){empty("Notifications couldn't load. Refresh and try again.");message("Your notification centre isn't available right now.");return;}
    const rows=data||[];
    if(!rows.length){empty("You're all caught up. New likes, comments and follows will show up here.");message("No new activity yet.");readAll.disabled=true;return;}
    const ids=[...new Set(rows.map(row=>row.actor_id))];
    const {data:profiles,error:profileError}=await client.from("profiles").select("id,username,display_name,avatar_url").in("id",ids);
    if(profileError){empty("We couldn't load the people behind these notifications.");message("Please refresh and try again.");return;}
    const {data:roles,error:roleError}=await client.from("dimension_member_roles").select("user_id,role").in("user_id",ids);
    if(roleError){empty("We couldn't load member role badges.");message("Please refresh and try again.");return;}
    const roleMap=new Map((roles||[]).map(row=>[row.user_id,row.role]));
    const byId=new Map((profiles||[]).map(profile=>[profile.id,{...profile,role:roleMap.get(profile.id)||"member"}]));
    list.replaceChildren();
    for(const row of rows){
      const actor=byId.get(row.actor_id),item=document.createElement("a");
      item.className="notification-item"+(row.read_at?"":" is-unread");
      item.href=(row.type==="message"||row.type==="message_request")?page("messages.html")+(row.conversation_id?"?c="+encodeURIComponent(row.conversation_id):""):(row.clip_id?page("clips.html")+"#clip-"+row.clip_id:(actor?.username?page("profile.html")+"?u="+encodeURIComponent(actor.username):page("clips.html")));
      const avatar=document.createElement("span");avatar.className="notification-avatar";
      if(actor?.avatar_url&&/^https?:\/\//i.test(actor.avatar_url)){const img=document.createElement("img");img.src=actor.avatar_url;img.alt="";avatar.append(img);}
      else avatar.textContent=(actor?.display_name||"D").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
      const body=document.createElement("span");body.className="notification-copy";
      const line=document.createElement("span"),name=document.createElement("strong");name.textContent=actor?.display_name||"A Dimension member";
      name.append(roleBadge(actor?.role));
      line.append(name,document.createTextNode(" "+(copy[row.type]||"interacted with you")));
      const time=document.createElement("small");time.textContent=new Date(row.created_at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
      body.append(line,time);
      const marker=document.createElement("span");marker.className="notification-dot";marker.setAttribute("aria-hidden","true");
      item.append(avatar,body,marker);
      item.addEventListener("click",async event=>{if(row.read_at)return;event.preventDefault();const destination=item.href;item.classList.remove("is-unread");const {error:markError}=await client.from("notifications").update({read_at:new Date().toISOString()}).eq("id",row.id).eq("recipient_id",user.id);if(markError)message("Could not mark this notification as read. Opening it anyway.");window.location.assign(destination);});
      list.append(item);
    }
    readAll.disabled=!rows.some(row=>!row.read_at);
    message(rows.filter(row=>!row.read_at).length+" unread · "+rows.length+" recent notifications");
  }
  async function start(){
    if(!client){message("Account services aren't available.");return;}
    const {data,error}=await client.auth.getUser();user=data?.user;
    if(error||!user){window.location.replace(page("login.html"));return;}
    await load();
    client.channel("dimension-notification-centre-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq." + user.id }, () => load())
      .subscribe();
  }
  readAll.addEventListener("click",async()=>{
    readAll.disabled=true;readAll.textContent="Updating…";
    const {error}=await client.from("notifications").update({read_at:new Date().toISOString()}).eq("recipient_id",user.id).is("read_at",null);
    readAll.textContent="Mark all as read";
    if(error){message("Couldn't mark notifications as read. Try again.");readAll.disabled=false;return;}
    await load();
  });
  start().catch(()=>message("Something went wrong while loading notifications."));
})();