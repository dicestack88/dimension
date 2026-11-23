(() => {
  "use strict";
  const config = window.DARKLANDS_CONFIG;
  const API = "https://dicestack-netlify-api.netlify.app/.netlify/functions";
  if (!config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY || !window.supabase?.createClient) return;

  const db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const settings = document.querySelector(".settings-shell");
  let user = null;
  let registration = null;
  let subscription = null;

  const decodeKey = value => {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  };

  async function prepare() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const scope = new URL(".", config.SITE_URL).pathname;
    registration = await navigator.serviceWorker.register(new URL("sw.js", config.SITE_URL), { scope });
    await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription();
    return registration;
  }

  function statusNode(panel) { return panel.querySelector(".dimension-push-status"); }
  function say(panel, message) { statusNode(panel).textContent = message; }

  function buildSettingsPanel() {
    if (!settings || settings.querySelector("#dimension-push-settings")) return null;
    const panel = document.createElement("section");
    panel.id = "dimension-push-settings";
    panel.className = "settings-panel dimension-push-panel";
    panel.innerHTML = `
      <div class="settings-panel-heading">
        <div><div class="eyebrow">04 / DEVICE ALERTS</div><h2>Push notifications</h2>
        <p>Receive Dimension alerts on this device, even when the site isn't open.</p></div>
      </div>
      <div class="dimension-push-row">
        <div><strong>This device</strong><span class="dimension-push-status" role="status" aria-live="polite">Checking notification support…</span></div>
        <button class="button dimension-push-toggle" type="button" disabled>Checking…</button>
      </div>
      <p class="settings-footnote">Each device is registered separately. You can enable or disable alerts independently on your other devices.</p>`;
    const privacy = settings.querySelector("#privacy");
    if (privacy) privacy.after(panel); else settings.append(panel);
    return panel;
  }

  async function refreshButton(panel, button) {
    subscription = registration ? await registration.pushManager.getSubscription() : null;
    button.disabled = false;
    button.textContent = subscription ? "Disable on this device" : "Enable on this device";
    say(panel, subscription ? "Push alerts are enabled for this device." : "Push alerts are currently disabled on this device.");
  }

  async function enable(panel, button) {
    if (!registration) throw new Error("This browser does not support web push notifications.");
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission wasn't granted. You can change this in your browser settings.");
    }
    const response = await fetch(API + "/push-config", { headers: { Accept: "application/json" } });
    const configData = await response.json();
    if (!response.ok || !configData.enabled || !configData.publicKey) throw new Error(configData.error || "Device notifications haven't been configured on the server yet.");
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(configData.publicKey)
    });
    const json = subscription.toJSON();
    const { error } = await db.from("push_subscriptions").upsert({
      endpoint: json.endpoint,
      user_id: user.id,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 500),
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) {
      await subscription.unsubscribe();
      subscription = null;
      throw error;
    }
    say(panel, "This device is now registered for Dimension push alerts.");
  }

  async function disable(panel) {
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user.id);
    if (error) throw error;
    await subscription.unsubscribe();
    subscription = null;
    say(panel, "Push alerts have been disabled on this device.");
  }

  async function start() {
    let panel = buildSettingsPanel();
    const { data, error } = await db.auth.getUser();
    user = data?.user;
    if (error || !user) {
      if (panel) panel.remove();
      return;
    }
    try {
      await prepare();
    } catch (error) {
      if (panel) say(panel, error.message || "Service worker registration failed.");
      return;
    }
    if (!panel) return;
    const button = panel.querySelector(".dimension-push-toggle");
    if (!registration || !("Notification" in window)) {
      button.disabled = true;
      button.textContent = "Not supported";
      say(panel, "This browser or device doesn't support web push. In-app notifications will still work.");
      return;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia("(display-mode: standalone)").matches) {
      say(panel, "On iPhone or iPad, add Dimension to your Home Screen first, then open it from there to enable push alerts.");
    }
    await refreshButton(panel, button);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Updating…";
      try {
        if (subscription) await disable(panel);
        else await enable(panel, button);
      } catch (error) {
        say(panel, error.message || "Push settings couldn't be updated.");
      } finally {
        await refreshButton(panel, button).catch(() => {
          button.disabled = false;
          button.textContent = "Try again";
        });
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start().catch(() => {}), { once: true });
  else start().catch(() => {});
})();
