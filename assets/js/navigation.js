(() => {
  "use strict";

  const config = window.DARKLANDS_CONFIG;
  if (!document.querySelector('script[data-dicestack-glass-mode]')) {
    const glassModeScript = document.createElement("script");
    glassModeScript.src = "https://dicestack88.github.io/glass-mode.js";
    glassModeScript.dataset.dicestackGlassMode = "true";
    document.head.append(glassModeScript);
  }

  for (const href of ["assets/css/navigation.css", "assets/css/ecosystem-glass.css", "assets/css/dimension-effects.css", "assets/css/feature-feedback.css", "assets/css/dimension-design-system.css", "assets/css/all-pages-redesign.css", "assets/css/world-wallpaper-foundation.css", "assets/css/selective-wallpaper-cards.css", "assets/css/rounded-interface-polish.css"]) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.append(link);
    }
  }

  if (!document.querySelector('script[data-dimension-page-effects]')) {
    const effectsScript = document.createElement("script");
    effectsScript.src = "assets/js/dimension-effects.js";
    effectsScript.dataset.dimensionPageEffects = "true";
    document.body.append(effectsScript);
  }

  const header = document.querySelector(".site-header") || (() => {
    const element = document.createElement("header");
    element.className = "site-header";
    document.body.prepend(element);
    return element;
  })();

  const nav = header.querySelector("nav") || document.createElement("nav");
  nav.className = "dimension-unified-nav";
  nav.setAttribute("aria-label", "Main navigation");

  const brand = header.querySelector(".brand") || (() => {
    const element = document.createElement("a");
    element.className = "brand";
    element.href = "index.html";
    element.setAttribute("aria-label", "Dicestack Dimension home");
    element.innerHTML = '<span class="brand-mark">D</span><span>DICESTACK DIMENSION</span>';
    return element;
  })();

  const oldLogout = header.querySelector('button[id*="logout"]');
  const logoutButton = oldLogout || document.createElement("button");
  const notificationCount = header.querySelector(".notification-nav-count");

  nav.replaceChildren();
  nav.append(brand);

  const ecosystem = document.createElement("details");
  ecosystem.className = "dimension-ecosystem-switcher";
  ecosystem.innerHTML = `
    <summary aria-label="Open Dicestack apps"><span class="ecosystem-switcher-mark">✦</span><span>Dicestack apps</span><span class="ecosystem-switcher-chevron" aria-hidden="true">⌄</span></summary>
    <div class="ecosystem-switcher-panel">
      <span class="ecosystem-switcher-label">THE DICESTACK ECOSYSTEM</span>
      <a href="https://dicestack88.github.io/"><span>⌂</span><span><strong>Dicestack hub</strong><small>Main website & projects</small></span><b>↗</b></a>
      <a href="https://dicestack88.github.io/launcher.html"><span>⌘</span><span><strong>Launcher</strong><small>Eaglercraft clients & games</small></span><b>↗</b></a>
      <a href="https://dicestack88.github.io/socials.html"><span>▶</span><span><strong>YouTube</strong><small>Videos & creator updates</small></span><b>↗</b></a>
    </div>`;
  nav.append(ecosystem);

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "dimension-sidebar-toggle";
  menu.setAttribute("aria-label", "Open navigation menu");
  menu.setAttribute("aria-expanded", "false");
  menu.innerHTML = '<span aria-hidden="true">☰</span><span>Menu</span>';
  nav.append(menu);

  const links = [
    ["Home", "index.html", ["index.html", ""]],
    ["Discover", "discover.html", ["discover.html"]],
    ["Clips", "clips.html", ["clips.html"]],
    ["Messages", "messages.html", ["messages.html"]],
    ["My profile", "profile.html", ["profile.html"]],
    ["Notifications", "notifications.html", ["notifications.html"]],
    ["Settings", "settings.html", ["settings.html"]],
    ["Analytics", "analytics.html", ["analytics.html"]],
  ];

  const currentFile = location.pathname.split("/").filter(Boolean).pop() || "index.html";
  const linkElements = [];

  for (const [label, href, matches] of links) {
    const anchor = document.createElement("a");
    anchor.className = "dimension-nav-link";
    anchor.href = href;
    anchor.textContent = label;
    if (matches.includes(currentFile) || (currentFile === "index.html" && matches.includes(""))) {
      anchor.setAttribute("aria-current", "page");
    }
    nav.append(anchor);
    linkElements.push(anchor);
  }

  const notificationLink = linkElements.find(link => link.textContent === "Notifications");
  if (notificationCount) {
    notificationCount.hidden = notificationCount.hidden;
    notificationLink.append(notificationCount);
  }

  const moderatorLink = document.createElement("a");
  moderatorLink.className = "dimension-nav-link dimension-moderation-link";
  moderatorLink.href = "moderation.html";
  moderatorLink.textContent = "Moderation";
  moderatorLink.hidden = true;
  if (currentFile === "moderation.html") moderatorLink.setAttribute("aria-current", "page");
  nav.append(moderatorLink);

  const guestLogin = document.createElement("a");
  guestLogin.className = "dimension-auth-link nav-login";
  guestLogin.href = "login.html";
  guestLogin.textContent = "Log in";
  nav.append(guestLogin);

  const guestRegister = document.createElement("a");
  guestRegister.className = "dimension-auth-link dimension-register-link nav-register";
  guestRegister.href = "register.html";
  guestRegister.textContent = "Create account";
  nav.append(guestRegister);

  if (!oldLogout) {
    logoutButton.type = "button";
    logoutButton.id = "dimension-logout";
    logoutButton.addEventListener("click", async () => {
      const liveConfig = window.DARKLANDS_CONFIG;
      if (!liveConfig?.SUPABASE_URL || !liveConfig?.SUPABASE_ANON_KEY || !window.supabase?.createClient) return;
      const client = window.supabase.createClient(liveConfig.SUPABASE_URL, liveConfig.SUPABASE_ANON_KEY);
      const { error } = await client.auth.signOut();
      if (!error) location.href = "login.html";
    });
  }
  logoutButton.classList.add("dimension-logout");
  logoutButton.textContent = "Log out";
  nav.append(logoutButton);

  header.replaceChildren(nav);

  // Persistent but unobtrusive beta notice and feature-feedback entry point.
  if (!document.querySelector(".dimension-beta-dock")) {
    const dock = document.createElement("div");
    dock.className = "dimension-beta-dock";
    dock.innerHTML = '<span class="dimension-beta-label">Currently in beta</span><button class="dimension-feedback-trigger" type="button">✦ Suggest a feature</button>';
    document.body.append(dock);

    const modal = document.createElement("div");
    modal.className = "dimension-feedback-backdrop";
    modal.innerHTML = `
      <section class="dimension-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="dimension-feedback-title">
        <button class="dimension-feedback-close" type="button" aria-label="Close feedback form">×</button>
        <span class="dimension-feedback-kicker">HELP SHAPE DIMENSION</span>
        <h2 id="dimension-feedback-title">What should we build next?</h2>
        <p>Dimension is currently in beta testing. Share feature ideas, improvements or bugs. Your feedback helps guide what we work on next.</p>
        <form class="dimension-feedback-form">
          <label>Feedback type
            <select name="category" required>
              <option value="feature">New feature idea</option>
              <option value="improvement">Improvement</option>
              <option value="bug">Bug report</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label>Short title
            <input name="title" maxlength="100" minlength="4" placeholder="e.g. Custom profile themes" required>
          </label>
          <label>Tell us more
            <textarea name="description" minlength="10" maxlength="1500" placeholder="Describe what you'd like to see and how it could work…" required></textarea>
          </label>
          <button class="dimension-feedback-submit" type="submit">Send feedback</button>
          <p class="dimension-feedback-status" role="status" aria-live="polite"></p>
        </form>
      </section>`;
    document.body.append(modal);
    const trigger = dock.querySelector("button");
    const close = () => { modal.classList.remove("is-open"); trigger.focus(); };
    trigger.addEventListener("click", () => {
      modal.classList.add("is-open");
      modal.querySelector("input[name=title]").focus();
    });
    modal.querySelector(".dimension-feedback-close").addEventListener("click", close);
    modal.addEventListener("click", event => { if (event.target === modal) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("is-open")) close(); });
    modal.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector("button[type=submit]");
      const status = form.querySelector(".dimension-feedback-status");
      const config = window.DARKLANDS_CONFIG;
      if (!config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY || !window.supabase?.createClient) {
        status.textContent = "Feedback services are temporarily unavailable. Please try again later.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Sending…";
      status.textContent = "";
      try {
        const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
        const { data: authData, error: authError } = await client.auth.getUser();
        if (authError || !authData?.user) {
          status.textContent = "Please log in and verify your email before sending feedback.";
          submit.disabled = false;
          submit.textContent = "Send feedback";
          return;
        }
        const values = new FormData(form);
        const { error } = await client.rpc("dimension_submit_feature_request", {
          p_category: values.get("category"),
          p_title: String(values.get("title") || "").trim(),
          p_description: String(values.get("description") || "").trim()
        });
        if (error) throw error;
        form.reset();
        status.textContent = "Thanks! Your feedback has been sent to the Dimension team.";
      } catch (error) {
        status.textContent = error?.message || "We couldn't send that just now. Please try again.";
      } finally {
        submit.disabled = false;
        submit.textContent = "Send feedback";
      }
    });
  }

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "dimension-nav-backdrop";
  backdrop.setAttribute("aria-label", "Close navigation menu");
  document.body.append(backdrop);

  const closeMenu = () => {
    document.documentElement.classList.remove("dimension-nav-open");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Open navigation menu");
  };

  menu.addEventListener("click", () => {
    const open = document.documentElement.classList.toggle("dimension-nav-open");
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  });
  backdrop.addEventListener("click", closeMenu);
  ecosystem.addEventListener("click", event => {
    if (event.target.closest("a")) ecosystem.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  const syncAuthNavigation = () => {
    const liveConfig = window.DARKLANDS_CONFIG || config;
    if (liveConfig?.SUPABASE_URL && liveConfig?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
      const client = window.supabase.createClient(liveConfig.SUPABASE_URL, liveConfig.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      client.auth.getUser().then(async ({ data }) => {
        const signedIn = Boolean(data?.user);
        guestLogin.hidden = signedIn;
        guestRegister.hidden = signedIn || liveConfig?.REGISTRATION_ENABLED !== true;
        logoutButton.hidden = !signedIn;
        moderatorLink.hidden = !signedIn;
      }).catch(() => {});
    } else {
      logoutButton.hidden = true;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAuthNavigation, { once: true });
  } else {
    syncAuthNavigation();
  }
})();