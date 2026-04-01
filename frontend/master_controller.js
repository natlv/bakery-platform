/**
 * Smart Bakers shared controller.
 * Handles session state, page routing, backend access, and common UI helpers.
 */

const SmartBakers = {
  config: {
    defaultApiBase: "https://smart-bakers.com",
    storage: {
      apiBase: "sb_api_base",
      userId: "sb_user_id",
      userNumericId: "sb_user_numeric_id",
      role: "sb_role",
      username: "sb_username",
      email: "sb_email",
      loginTime: "sb_login_time",
      activeRequestId: "sb_active_request_id",
      requestMeta: "sb_request_meta",
      requestIds: "sb_customer_request_ids",
    },
  },

  storage: {
    get(key, fallback = null) {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    },

    getJson(key, fallback) {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`[SmartBakers] Could not parse ${key}`, error);
        return fallback;
      }
    },

    setJson(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  },

  utils: {
    pageName() {
      const page = window.location.pathname.split("/").pop();
      return page || "";
    },

    escHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    formatCurrency(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "N/A";
      return `$${numeric.toLocaleString("en-SG", { maximumFractionDigits: 0 })}`;
    },

    formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
      if (!value) return "N/A";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString("en-SG", options);
    },

    timeAgo(value) {
      if (!value) return "Unknown";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Unknown";
      const diffMs = Date.now() - date.getTime();
      const diffHours = Math.max(1, Math.floor(diffMs / 3600000));
      if (diffHours < 24) return `${diffHours} hr ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    },

    daysUntil(value) {
      if (!value) return null;
      const target = new Date(value);
      if (Number.isNaN(target.getTime())) return null;
      return Math.ceil((target.getTime() - Date.now()) / 86400000);
    },

    sentenceCase(value) {
      if (!value) return "";
      return value
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    },

    extractDescriptionParts(description = "") {
      const meta = {};
      const sections = String(description).split("\n");
      sections.forEach((line) => {
        const [label, ...rest] = line.split(":");
        if (!rest.length) return;
        const key = label.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "variety") meta.variety = value.toLowerCase().replace(/\s+/g, "-");
        if (key === "servings") meta.servings = value;
        if (key === "dietary") {
          meta.dietary = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }
      });
      return meta;
    },
  },

  session: {
    demoNumericIdForRole(role) {
      return role === "Customer" ? 1 : 1;
    },

    save(userId, role, name = "Guest", email = "") {
      const numericId = SmartBakers.session.demoNumericIdForRole(role);
      localStorage.setItem(SmartBakers.config.storage.userId, String(userId));
      localStorage.setItem(SmartBakers.config.storage.userNumericId, String(numericId));
      localStorage.setItem(SmartBakers.config.storage.role, role);
      localStorage.setItem(SmartBakers.config.storage.username, name);
      localStorage.setItem(SmartBakers.config.storage.email, email);
      localStorage.setItem(SmartBakers.config.storage.loginTime, String(Date.now()));
    },

    get() {
      return {
        id: SmartBakers.storage.get(SmartBakers.config.storage.userId, ""),
        numericId: Number(
          SmartBakers.storage.get(
            SmartBakers.config.storage.userNumericId,
            String(SmartBakers.session.demoNumericIdForRole("Customer"))
          )
        ),
        role: SmartBakers.storage.get(SmartBakers.config.storage.role, ""),
        name: SmartBakers.storage.get(SmartBakers.config.storage.username, ""),
        email: SmartBakers.storage.get(SmartBakers.config.storage.email, ""),
      };
    },

    clear() {
      [
        SmartBakers.config.storage.userId,
        SmartBakers.config.storage.userNumericId,
        SmartBakers.config.storage.role,
        SmartBakers.config.storage.username,
        SmartBakers.config.storage.email,
        SmartBakers.config.storage.loginTime,
        SmartBakers.config.storage.activeRequestId,
      ].forEach((key) => localStorage.removeItem(key));
      window.location.href = "login.html";
    },

    isLoggedIn() {
      return !!SmartBakers.storage.get(SmartBakers.config.storage.userId, "");
    },
  },

  auth: {
    publicPages: ["", "index.html", "login.html", "forgot_password.html", "reset_password.html", "guest_register.html"],

    check() {
      const page = SmartBakers.utils.pageName();
      const user = SmartBakers.session.get();

      if (!user.id && !SmartBakers.auth.publicPages.includes(page)) {
        window.location.href = "login.html";
        return false;
      }

      if (user.role === "Baker" && page === "posting_baking_request.html") {
        SmartBakers.ui.toast("Only customers can post new requests.", "warning");
        setTimeout(() => {
          window.location.href = "bakery_marketplace_dashboard_search.html";
        }, 1200);
        return false;
      }

      if (user.role === "Customer" && page === "baker_upload_items.html") {
        SmartBakers.ui.toast("Only bakers can manage menu items.", "warning");
        setTimeout(() => {
          window.location.href = "main_page_portfolio.html";
        }, 1200);
        return false;
      }

      if (user.role === "Baker" && page === "ai_match_suggestions.html") {
        SmartBakers.ui.toast("AI suggestions are for customers only.", "warning");
        setTimeout(() => {
          window.location.href = "bakery_marketplace_dashboard_search.html";
        }, 1200);
        return false;
      }

      if (user.role === "Customer" && page === "bakers_splitscreen_bidpage.html") {
        SmartBakers.ui.toast("Only bakers can place bids.", "warning");
        setTimeout(() => {
          window.location.href = "main_page_portfolio.html";
        }, 1200);
        return false;
      }

      return true;
    },

    goHome() {
      const user = SmartBakers.session.get();
      window.location.href =
        user.role === "Baker"
          ? "bakery_marketplace_dashboard_search.html"
          : "main_page_portfolio.html";
    },
  },

  routing: {
    requestUrl(page, requestId) {
      const url = new URL(page, window.location.href);
      if (requestId) url.searchParams.set("request_id", String(requestId));
      return `${url.pathname.split("/").pop()}${url.search}`;
    },

    aiMatchUrl(requestId) {
      return SmartBakers.routing.requestUrl("ai_match_suggestions.html", requestId);
    },

    goToAiMatch(requestId) {
      const id = requestId || SmartBakers.routing.currentRequestId();
      if (id) SmartBakers.routing.setActiveRequest(id);
      window.location.href = SmartBakers.routing.aiMatchUrl(id);
    },

    setActiveRequest(requestId) {
      if (!requestId) return;
      localStorage.setItem(SmartBakers.config.storage.activeRequestId, String(requestId));
    },

    currentRequestId() {
      const search = new URLSearchParams(window.location.search);
      const fromQuery = Number(search.get("request_id"));
      if (Number.isFinite(fromQuery) && fromQuery > 0) {
        SmartBakers.routing.setActiveRequest(fromQuery);
        return fromQuery;
      }

      const stored = Number(
        SmartBakers.storage.get(SmartBakers.config.storage.activeRequestId, "0")
      );
      return Number.isFinite(stored) && stored > 0 ? stored : null;
    },
  },

  requests: {
    emojiMap: {
      bread: "🍞",
      "birthday-cake": "🎂",
      "wedding-cake": "💒",
      "anniversary-cake": "🎉",
      "occasion-cake": "🍰",
      cookies: "🍪",
      biscuit: "🫓",
      pastry: "🥐",
      cupcakes: "🧁",
    },

    ownedIds() {
      return SmartBakers.storage.getJson(SmartBakers.config.storage.requestIds, []);
    },

    rememberOwnedId(requestId) {
      const ids = new Set(SmartBakers.requests.ownedIds().map((value) => Number(value)));
      ids.add(Number(requestId));
      SmartBakers.storage.setJson(
        SmartBakers.config.storage.requestIds,
        Array.from(ids).filter((value) => Number.isFinite(value) && value > 0)
      );
    },

    rememberMeta(requestId, meta) {
      const allMeta = SmartBakers.storage.getJson(SmartBakers.config.storage.requestMeta, {});
      allMeta[String(requestId)] = {
        ...(allMeta[String(requestId)] || {}),
        ...meta,
      };
      SmartBakers.storage.setJson(SmartBakers.config.storage.requestMeta, allMeta);
    },

    metaFor(requestId) {
      const allMeta = SmartBakers.storage.getJson(SmartBakers.config.storage.requestMeta, {});
      return allMeta[String(requestId)] || {};
    },

    inferVariety(request) {
      const meta = SmartBakers.requests.metaFor(request.request_id);
      if (meta.variety) return meta.variety;

      const described = SmartBakers.utils.extractDescriptionParts(request.description);
      if (described.variety) return described.variety;

      const haystack = `${request.title} ${request.description}`.toLowerCase();
      return (
        Object.keys(SmartBakers.requests.emojiMap).find((key) =>
          haystack.includes(key.replace(/-/g, " "))
        ) || "occasion-cake"
      );
    },

    enrich(request) {
      const raw = SmartBakers.api.normalizeRequest(request);
      const storedMeta = SmartBakers.requests.metaFor(raw.request_id);
      const extracted = SmartBakers.utils.extractDescriptionParts(raw.description);
      const variety = storedMeta.variety || extracted.variety || SmartBakers.requests.inferVariety(raw);
      const dietary = storedMeta.dietary || extracted.dietary || [];
      const servings = storedMeta.servings || extracted.servings || "";
      const notes = raw.description
        .split("\n")
        .filter((line) => !/^(Variety|Servings|Dietary):/i.test(line))
        .join("\n")
        .trim();

      return {
        ...raw,
        variety,
        dietary,
        servings,
        details: notes || raw.description || "No extra notes provided.",
        emoji: storedMeta.emoji || SmartBakers.requests.emojiMap[variety] || "🍰",
      };
    },
  },

  api: {
    base() {
      const fromWindow = window.SMART_BAKERS_API_BASE;
      const fromStorage = SmartBakers.storage.get(SmartBakers.config.storage.apiBase, "");
      return (fromWindow || fromStorage || SmartBakers.config.defaultApiBase).replace(/\/+$/, "");
    },

    endpoint(path) {
      if (/^https?:\/\//i.test(path)) return path;
      return `${SmartBakers.api.base()}${path.startsWith("/") ? path : `/${path}`}`;
    },

    async request(path, options = {}) {
      const response = await fetch(SmartBakers.api.endpoint(path), options);
      const text = await response.text();

      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (error) {
          payload = text;
        }
      }

      if (!response.ok) {
        const detail =
          payload && typeof payload === "object"
            ? payload.detail || payload.error || JSON.stringify(payload)
            : payload || `${response.status} ${response.statusText}`;
        throw new Error(detail);
      }

      return payload;
    },

    normalizeRequest(item) {
      if (Array.isArray(item)) {
        return {
          request_id: Number(item[0]),
          title: item[1] || "",
          description: item[2] || "",
          budget: item[3] == null ? null : Number(item[3]),
          deadline: item[4] || "",
          status: item[5] || "open",
          image_url: item[6] || "",
          customer_id: item[7] == null ? null : Number(item[7]),
          accepted_bid_id: item[8] == null ? null : Number(item[8]),
          bid_count: item[9] == null ? null : Number(item[9]),
          lowest_bid: item[10] == null ? null : Number(item[10]),
          created_at: item[11] || "",
        };
      }

      return {
        request_id: Number(item?.request_id),
        title: item?.title || "",
        description: item?.description || "",
        budget: item?.budget == null ? null : Number(item.budget),
        deadline: item?.deadline || "",
        status: item?.status || "open",
        image_url: item?.image_url || "",
        customer_id: item?.customer_id == null ? null : Number(item.customer_id),
        accepted_bid_id:
          item?.accepted_bid_id == null ? null : Number(item.accepted_bid_id),
        bid_count: item?.bid_count == null ? null : Number(item.bid_count),
        lowest_bid: item?.lowest_bid == null ? null : Number(item.lowest_bid),
        created_at: item?.created_at || "",
      };
    },

    normalizeBid(item) {
      if (Array.isArray(item)) {
        return {
          bid_id: Number(item[0]),
          request_id: null,
          baker_id: Number(item[1]),
          price: item[2] == null ? null : Number(item[2]),
          timeline: item[3] || "",
          notes: item[4] || "",
          created_at: item[5] || "",
        };
      }

      return {
        bid_id: Number(item?.bid_id),
        request_id: item?.request_id == null ? null : Number(item.request_id),
        baker_id: item?.baker_id == null ? null : Number(item.baker_id),
        price: item?.price == null ? null : Number(item.price),
        timeline: item?.timeline || "",
        notes: item?.notes || "",
        created_at: item?.created_at || "",
      };
    },

    async getRequests(params = {}) {
      const search = new URLSearchParams();
      if (params.customerId) search.set("customer_id", String(params.customerId));
      if (params.status) search.set("status", params.status);
      if (params.includeAllStatuses) search.set("include_all_statuses", "true");
      const suffix = search.toString() ? `?${search.toString()}` : "";
      const payload = await SmartBakers.api.request(`/requests${suffix}`);
      return Array.isArray(payload) ? payload.map(SmartBakers.requests.enrich) : [];
    },

    async getRequest(requestId) {
      const payload = await SmartBakers.api.request(`/requests/${requestId}`);
      return SmartBakers.requests.enrich(payload);
    },

    async createRequest(formData) {
      return SmartBakers.api.request("/requests", {
        method: "POST",
        body: formData,
      });
    },

    async getBids(requestId) {
      const payload = await SmartBakers.api.request(`/bids/${requestId}`);
      return Array.isArray(payload) ? payload.map(SmartBakers.api.normalizeBid) : [];
    },

    async submitBid(formData) {
      return SmartBakers.api.request("/bids", {
        method: "POST",
        body: formData,
      });
    },

    async acceptBid(requestId, bidId) {
      const formData = new FormData();
      formData.append("request_id", String(requestId));
      formData.append("bid_id", String(bidId));
      return SmartBakers.api.request("/accept-bid", {
        method: "POST",
        body: formData,
      });
    },

    async matchBakers(query) {
      return SmartBakers.api.request("baker-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    },
      
    async forgotPassword(email) {
        return await SmartBakers.api.request("/forgot-password", {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    },
    async resetPassword(userId, newPassword) {
        return await SmartBakers.api.request('/reset-password', {
            method: 'POST',
            body: JSON.stringify({ 
                user_id: userId, 
                new_password: newPassword 
            })
        });
    },
    async login(email, password, role) {
        return await SmartBakers.api.request('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, role })
        });
    }
  },

  notifications: {
    // Storage key scoped per user so baker and customer never share notifications
    _storageKey() {
      const userId = SmartBakers.storage.get(SmartBakers.config.storage.userId, "guest");
      return `sb_notifs_${userId}`;
    },

    // Role-appropriate seed notifications shown on first login
    _seedForRole(role) {
      if (role === "Baker") {
        return [
          {
            id: 1,
            type: "market",
            text: "New baking requests are waiting — browse the marketplace and place your best bid.",
            time: "Now",
            read: false,
          },
          {
            id: 2,
            type: "tip",
            text: "Tip: bids that include a clear timeline and a personal note win more often.",
            time: "Today",
            read: false,
          },
        ];
      }
      // Customer seeds
      return [
        {
          id: 1,
          type: "tip",
          text: "Tip: adding a clear deadline and dietary notes helps bakers quote faster.",
          time: "Now",
          read: false,
        },
        {
          id: 2,
          type: "tip",
          text: "Your request is live! Sit tight — bakers will start placing bids shortly.",
          time: "Today",
          read: false,
        },
      ];
    },

    // Lazily load from localStorage, seeding if empty
    _load() {
      const key = SmartBakers.notifications._storageKey();
      const saved = SmartBakers.storage.getJson(key, null);
      if (saved) return saved;
      const role = SmartBakers.session.get().role || "Customer";
      const seed = SmartBakers.notifications._seedForRole(role);
      SmartBakers.storage.setJson(key, seed);
      return seed;
    },

    _save(data) {
      SmartBakers.storage.setJson(SmartBakers.notifications._storageKey(), data);
    },

    /**
     * Push a new notification at runtime.
     *
     * @param {object} notif
     * @param {string} notif.type  - "bid" | "accept" | "reject" | "market" | "tip"
     * @param {string} notif.text  - Human-readable message
     * @param {string} [notif.time] - Display time label (defaults to "Just now")
     */
    push(notif) {
      const data = SmartBakers.notifications._load();
      const newItem = {
        id: Date.now(),
        type: notif.type || "tip",
        text: notif.text,
        time: notif.time || "Just now",
        read: false,
      };
      data.unshift(newItem); // newest first
      SmartBakers.notifications._save(data);
      SmartBakers.notifications._updateBadge();
      SmartBakers.notifications._renderPanel();
    },

    /**
     * Called by the bid-submission page after a baker places a bid.
     * Adds a customer-facing notification: "Sarah B. placed a bid on your Wedding Cake."
     *
     * @param {string} bakerName   - Display name of the baker
     * @param {string} requestTitle - Title of the customer's request
     * @param {number} price        - Bid amount
     */
    onBidPlaced(bakerName, requestTitle, price) {
      SmartBakers.notifications.push({
        type: "bid",
        text: `🍰 ${bakerName} placed a bid of ${SmartBakers.utils.formatCurrency(price)} on your "${requestTitle}" request.`,
        time: "Just now",
      });
    },

    /**
     * Called by the accept-bid page after a customer accepts a bid.
     * Adds a baker-facing notification: "Congratulations! Your bid was accepted."
     *
     * @param {string} customerName  - Display name of the customer
     * @param {string} requestTitle  - Title of the request
     * @param {number} price         - The accepted bid price
     */
    onBidAccepted(customerName, requestTitle, price) {
      SmartBakers.notifications.push({
        type: "accept",
        text: `🎉 Congratulations! ${customerName} accepted your bid of ${SmartBakers.utils.formatCurrency(price)} for "${requestTitle}". Time to bake!`,
        time: "Just now",
      });
    },

    /**
     * Called by the accept-bid page after a customer rejects / passes on a bid.
     *
     * @param {string} requestTitle - Title of the request
     */
    onBidRejected(requestTitle) {
      SmartBakers.notifications.push({
        type: "reject",
        text: `Your bid on "${requestTitle}" was not selected this time. Keep bidding — the right customer is out there!`,
        time: "Just now",
      });
    },

    unreadCount() {
      return SmartBakers.notifications._load().filter((item) => !item.read).length;
    },

    markAllRead() {
      const data = SmartBakers.notifications._load();
      data.forEach((item) => { item.read = true; });
      SmartBakers.notifications._save(data);
      SmartBakers.notifications._updateBadge();
      SmartBakers.notifications._renderPanel();
    },

    _updateBadge() {
      const badge = document.getElementById("notif-badge");
      if (!badge) return;
      const count = SmartBakers.notifications.unreadCount();
      badge.textContent = String(count);
      badge.style.display = count > 0 ? "flex" : "none";
    },

    _renderPanel() {
      const list = document.getElementById("notif-list");
      if (!list) return;

      const icons = {
        market: "🥖",
        tip:    "💡",
        accept: "🎉",
        reject: "😔",
        bid:    "💰",
      };

      const data = SmartBakers.notifications._load();

      if (!data.length) {
        list.innerHTML = `<div style="padding:24px 18px;text-align:center;font-family:'DM Sans',sans-serif;color:#a1887f;font-size:13px;">You're all caught up! 🎉</div>`;
        return;
      }

      list.innerHTML = data
        .map(
          (item) => `
            <div style="padding:14px 18px;border-bottom:1px solid rgba(200,149,108,0.08);display:flex;gap:12px;background:${
              item.read ? "transparent" : "rgba(200,149,108,0.05)"
            };">
              <span style="font-size:18px;flex-shrink:0;">${icons[item.type] || "🔔"}</span>
              <div style="flex:1;">
                <p style="margin:0 0 4px;font-family:'DM Sans',sans-serif;color:#3e2723;font-size:13px;line-height:1.4;">${SmartBakers.utils.escHtml(
                  item.text
                )}</p>
                <p style="margin:0;font-family:'DM Sans',sans-serif;color:#a1887f;font-size:11px;">${SmartBakers.utils.escHtml(
                  item.time
                )}</p>
              </div>
              ${!item.read ? `<span style="width:7px;height:7px;border-radius:999px;background:#c8956c;flex-shrink:0;margin-top:4px;"></span>` : ""}
            </div>
          `
        )
        .join("");
    },

    togglePanel() {
      const panel = document.getElementById("notif-panel");
      if (!panel) return;
      const shouldOpen = panel.style.display === "none";
      panel.style.display = shouldOpen ? "block" : "none";
      if (shouldOpen) SmartBakers.notifications._renderPanel();
    },

    inject() {
      const nav = document.querySelector("[data-sb-nav]");
      if (!nav) return;

      const user = SmartBakers.session.get();
      const page = SmartBakers.utils.pageName();
      const links =
        user.role === "Baker"
          ? [
              {
                href: "bakery_marketplace_dashboard_search.html",
                label: "Marketplace",
                active: page === "bakery_marketplace_dashboard_search.html",
              },
              {
                href: "baker_upload_items.html",
                label: "My Menu",
                active: page === "baker_upload_items.html",
              },
            ]
          : [
              {
                href: "main_page_portfolio.html",
                label: "My Requests",
                active: page === "main_page_portfolio.html",
              },
              {
                href: "posting_baking_request.html",
                label: "Post Request",
                active: page === "posting_baking_request.html",
              },
            ];

      nav.innerHTML = `
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
          <button onclick="SmartBakers.auth.goHome()" style="background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:10px;">
            <span style="width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#c8956c,#a67c52);font-size:18px;">🍞</span>
            <span style="font-family:'Playfair Display',serif;color:#3e2723;font-size:20px;font-weight:700;">Smart Bakers</span>
          </button>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${links
              .map(
                (link) => `
                  <a href="${link.href}" style="text-decoration:none;">
                    <span style="display:inline-flex;align-items:center;padding:8px 14px;border-radius:999px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;${
                      link.active
                        ? "background:linear-gradient(135deg,#c8956c,#a67c52);color:#fffaf5;"
                        : "background:rgba(200,149,108,0.08);color:#8d6e63;border:1px solid rgba(200,149,108,0.16);"
                    }">${link.label}</span>
                  </a>
                `
              )
              .join("")}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <button id="notif-btn" onclick="SmartBakers.notifications.togglePanel()" style="position:relative;background:none;border:none;cursor:pointer;padding:8px;border-radius:10px;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3e2723" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span id="notif-badge" style="position:absolute;top:4px;right:2px;background:#e53935;color:#fff;font-size:10px;font-weight:700;width:16px;height:16px;border-radius:999px;display:flex;align-items:center;justify-content:center;">${SmartBakers.notifications.unreadCount()}</span>
          </button>
          <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(200,149,108,0.1);border-radius:12px;border:1px solid rgba(200,149,108,0.2);">
            <div style="width:30px;height:30px;border-radius:999px;background:linear-gradient(135deg,#c8956c,#a67c52);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;">${SmartBakers.utils.escHtml(
              (user.name || "G").charAt(0).toUpperCase()
            )}</div>
            <div style="display:flex;flex-direction:column;gap:2px;">
              <span style="font-family:'DM Sans',sans-serif;color:#3e2723;font-size:12px;font-weight:700;">${SmartBakers.utils.escHtml(
                user.name || "Guest"
              )}</span>
              <span style="font-family:'DM Sans',sans-serif;color:#a1887f;font-size:11px;">${SmartBakers.utils.escHtml(
                user.role || ""
              )}</span>
            </div>
          </div>
          <button onclick="SmartBakers.session.clear()" style="background:none;border:1px solid rgba(200,149,108,0.3);color:#8d6e63;padding:8px 14px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Sign Out</button>
          <div id="notif-panel" style="display:none;position:absolute;top:100%;right:16px;width:320px;background:#fffcf7;border:1px solid rgba(200,149,108,0.2);border-radius:16px;box-shadow:0 16px 40px rgba(62,39,35,0.15);z-index:50;overflow:hidden;">
            <div style="padding:14px 18px;border-bottom:1px solid rgba(200,149,108,0.1);display:flex;align-items:center;justify-content:space-between;">
              <span style="font-family:'Playfair Display',serif;color:#3e2723;font-size:16px;font-weight:700;">Notifications</span>
              <button onclick="SmartBakers.notifications.markAllRead()" style="background:none;border:none;color:#c8956c;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Mark all read</button>
            </div>
            <div id="notif-list"></div>
          </div>
        </div>
      `;

      SmartBakers.notifications._updateBadge();

      document.addEventListener("click", (event) => {
        const panel = document.getElementById("notif-panel");
        const button = document.getElementById("notif-btn");
        if (!panel || !button) return;
        if (!panel.contains(event.target) && !button.contains(event.target)) {
          panel.style.display = "none";
        }
      });
    },
  },

  chat: {
    _open: false,

    inject() {
      if (document.getElementById("sb-chat-widget")) return;

      const container = document.createElement("div");
      container.id = "sb-chat-widget";
      container.innerHTML = `
        <style>
          #sb-chat-widget { position:fixed; right:24px; bottom:24px; z-index:9999; font-family:'DM Sans',sans-serif; }
          #sb-chat-bubble { width:56px; height:56px; border:none; border-radius:999px; cursor:pointer; background:linear-gradient(135deg,#c8956c,#a67c52); color:#fff; box-shadow:0 10px 24px rgba(200,149,108,0.35); }
          #sb-chat-window { display:none; position:absolute; right:0; bottom:70px; width:340px; max-height:480px; background:#fffcf7; border:1px solid rgba(200,149,108,0.2); border-radius:20px; overflow:hidden; box-shadow:0 20px 48px rgba(62,39,35,0.18); }
          #sb-chat-window.open { display:flex; flex-direction:column; }
          #sb-chat-messages { padding:16px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:300px; }
          .sb-chat-user { align-self:flex-end; max-width:78%; padding:10px 14px; border-radius:14px 14px 4px 14px; background:linear-gradient(135deg,#c8956c,#a67c52); color:#fffaf5; font-size:13px; line-height:1.4; }
          .sb-chat-ai { align-self:flex-start; max-width:78%; padding:10px 14px; border-radius:14px 14px 14px 4px; background:rgba(200,149,108,0.08); color:#3e2723; font-size:13px; line-height:1.4; border:1px solid rgba(200,149,108,0.14); }
        </style>
        <div id="sb-chat-window">
          <div style="padding:16px 18px;background:linear-gradient(135deg,#3e2723,#5d4037);display:flex;align-items:center;justify-content:space-between;">
            <div>
              <p style="margin:0;font-family:'Playfair Display',serif;color:#fffaf5;font-size:15px;font-weight:700;">Baking Assistant</p>
              <p style="margin:2px 0 0;color:rgba(255,250,245,0.7);font-size:11px;">Quick marketplace tips</p>
            </div>
            <button onclick="SmartBakers.chat.toggle()" style="background:none;border:none;color:#fffaf5;cursor:pointer;font-size:18px;">x</button>
          </div>
          <div id="sb-chat-messages">
            <div class="sb-chat-ai">Ask about pricing, deadlines, or how to write a stronger request or bid.</div>
          </div>
          <div style="display:flex;gap:8px;padding:12px;border-top:1px solid rgba(200,149,108,0.12);">
            <input id="sb-chat-input" type="text" placeholder="How should I price this?" style="flex:1;padding:10px 12px;border:1px solid rgba(200,149,108,0.24);border-radius:12px;font-family:'DM Sans',sans-serif;font-size:13px;">
            <button onclick="SmartBakers.chat.send()" style="border:none;border-radius:12px;background:linear-gradient(135deg,#c8956c,#a67c52);color:#fffaf5;padding:0 16px;cursor:pointer;font-weight:700;">Send</button>
          </div>
        </div>
        <button id="sb-chat-bubble" onclick="SmartBakers.chat.toggle()" title="Open baking assistant">?</button>
      `;
      document.body.appendChild(container);

      const input = document.getElementById("sb-chat-input");
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") SmartBakers.chat.send();
      });
    },

    toggle() {
      const win = document.getElementById("sb-chat-window");
      if (!win) return;
      SmartBakers.chat._open = !SmartBakers.chat._open;
      win.classList.toggle("open", SmartBakers.chat._open);
    },

    replyFor(prompt) {
      const text = prompt.toLowerCase();
      if (text.includes("price") || text.includes("budget")) {
        return "Start near the customer's budget, then explain what quality or speed your quote includes. Clear value usually beats being the absolute cheapest.";
      }
      if (text.includes("deadline") || text.includes("timeline")) {
        return "Give a realistic production timeline and leave room for design changes, sourcing, and delivery. Customers trust bids that feel specific and achievable.";
      }
      if (text.includes("request")) {
        return "Strong requests include the bake type, servings, dietary needs, target date, and inspiration details. That helps bakers quote faster and more accurately.";
      }
      if (text.includes("bid")) {
        return "A strong bid should mention relevant experience, a clear timeline, and one or two details that show you understood the request.";
      }
      return "Keep the details specific and practical. The clearer the request or bid is, the easier it is for the other side to say yes.";
    },

    send() {
      const input = document.getElementById("sb-chat-input");
      const messages = document.getElementById("sb-chat-messages");
      const text = input?.value?.trim();
      if (!text || !messages) return;

      messages.innerHTML += `<div class="sb-chat-user">${SmartBakers.utils.escHtml(text)}</div>`;
      messages.innerHTML += `<div class="sb-chat-ai">${SmartBakers.utils.escHtml(
        SmartBakers.chat.replyFor(text)
      )}</div>`;
      messages.scrollTop = messages.scrollHeight;
      input.value = "";
    },
  },

  ui: {
    toast(message, type = "info") {
      const colors = {
        info: "#c8956c",
        success: "#6b8f5e",
        warning: "#e08a2e",
        error: "#e53935",
      };

      const toast = document.createElement("div");
      toast.style.cssText = `position:fixed;top:24px;right:24px;z-index:100000;background:${
        colors[type] || colors.info
      };color:#fff;padding:12px 18px;border-radius:12px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;box-shadow:0 10px 24px rgba(0,0,0,0.16);opacity:0;transform:translateY(-8px);transition:all 0.25s ease;`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
      }, 10);

      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-8px)";
        setTimeout(() => toast.remove(), 250);
      }, 2500);
    },
  },

  init() {
    const ok = SmartBakers.auth.check();
    if (!ok) return;

    SmartBakers.notifications.inject();

    if (SmartBakers.session.isLoggedIn()) {
      SmartBakers.chat.inject();
    }

    document.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", () => {
        const action = element.getAttribute("data-action");
        if (action === "logout") SmartBakers.session.clear();
        if (action === "home") SmartBakers.auth.goHome();
        if (action === "portfolio") window.location.href = "main_page_portfolio.html";
        if (action === "marketplace") {
          window.location.href = "bakery_marketplace_dashboard_search.html";
        }
        if (action === "post-request") {
          window.location.href = "posting_baking_request.html";
        }
        if (action === "baker-menu") {
          window.location.href = "baker_upload_items.html";
        }
        if (action === "register") {
          window.location.href = "guest_register.html";
        }
        if (action === "ai-match") {
          window.location.href = "ai_match_suggestions.html";
        }
      });
    });

    document.querySelectorAll("[data-sb-username]").forEach((element) => {
      element.textContent = SmartBakers.session.get().name || "Guest";
    });
  },
};

window.SmartBakers = SmartBakers;
document.addEventListener("DOMContentLoaded", () => SmartBakers.init());
