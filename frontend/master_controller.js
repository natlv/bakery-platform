/**
 * Smart Bakers — Master Application Controller v2
 * Handles: Session, Routing, Notifications, AI Chatbox, Global UI
 */

const SmartBakers = {

  // ─── 1. SESSION ────────────────────────────────────────────────────────────
  session: {
    save(userId, role, name = 'Guest', email = '') {
      localStorage.setItem('sb_user_id', userId);
      localStorage.setItem('sb_role', role);      // 'Baker' | 'Customer'
      localStorage.setItem('sb_username', name);
      localStorage.setItem('sb_email', email);
      localStorage.setItem('sb_login_time', Date.now());
      console.log(`[SmartBakers] Session saved: ${name} as ${role}`);
    },
    get() {
      return {
        id:    localStorage.getItem('sb_user_id'),
        role:  localStorage.getItem('sb_role'),
        name:  localStorage.getItem('sb_username'),
        email: localStorage.getItem('sb_email'),
      };
    },
    clear() {
      localStorage.clear();
      window.location.href = 'login.html';
    },
    isLoggedIn() { return !!localStorage.getItem('sb_user_id'); }
  },

  // ─── 2. AUTH & ROUTING ─────────────────────────────────────────────────────
  auth: {
    publicPages: ['login.html', 'forgot_password.html', 'reset_password.html', ''],

    check() {
      const user = SmartBakers.session.get();
      const page = window.location.pathname.split('/').pop();

      if (!user.id && !SmartBakers.auth.publicPages.includes(page)) {
        window.location.href = 'login.html';
        return false;
      }
      // Role guards
      if (user.role === 'Baker' && page === 'posting_baking_request.html') {
        SmartBakers.ui.toast('Only Customers can post requests.', 'warning');
        setTimeout(() => window.location.href = 'bakery_marketplace_dashboard_search.html', 1500);
        return false;
      }
      if (user.role === 'Customer' && page === 'bakers_splitscreen_bidpage.html') {
        SmartBakers.ui.toast('Only Bakers can submit bids.', 'warning');
        setTimeout(() => window.location.href = 'main_page_portfolio.html', 1500);
        return false;
      }
      return true;
    },

    goHome() {
const user = SmartBakers.session.get();
        if (user.role === 'Baker') {
            window.location.href = 'bakery_marketplace_dashboard_search.html';
        } else {
            window.location.href = 'main_page_portfolio.html';
        }
		},

  // ─── 3. NOTIFICATIONS ──────────────────────────────────────────────────────
  notifications: {
    _data: [
      { id: 1, type: 'bid',     text: 'Sarah's Creations placed a bid on your Wedding Cake',   time: '2 min ago',  read: false },
      { id: 2, type: 'accept',  text: 'Your bid on Chocolate Birthday Cake was accepted! 🎉',   time: '1 hr ago',   read: false },
      { id: 3, type: 'message', text: 'Artisan Bakery Co sent you a message',                   time: '3 hr ago',   read: true  },
      { id: 4, type: 'system',  text: 'Your request "Sourdough Loaves" got 3 new bids',         time: 'Yesterday',  read: true  },
    ],

    unreadCount() { return this._data.filter(n => !n.read).length; },

    markAllRead() {
      this._data.forEach(n => n.read = true);
      SmartBakers.notifications._updateBadge();
    },

    _updateBadge() {
      const badge = document.getElementById('notif-badge');
      if (!badge) return;
      const count = SmartBakers.notifications.unreadCount();
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    },

    inject() {
      // Only inject if a nav exists
      const nav = document.querySelector('[data-sb-nav]');
      if (!nav) return;

      const user = SmartBakers.session.get();
      nav.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;">
          <span style="font-family:'Playfair Display',serif;color:#3e2723;font-size:18px;font-weight:600;">🍞 Smart Bakers</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <button id="notif-btn" onclick="SmartBakers.notifications.togglePanel()" style="position:relative;background:none;border:none;cursor:pointer;padding:8px;border-radius:10px;transition:background 0.2s;" onmouseover="this.style.background='rgba(200,149,108,0.1)'" onmouseout="this.style.background='none'">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3e2723" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span id="notif-badge" style="position:absolute;top:4px;right:4px;background:#e53935;color:white;font-size:10px;font-weight:700;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;">${SmartBakers.notifications.unreadCount()}</span>
          </button>
          <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(200,149,108,0.1);border-radius:12px;border:1px solid rgba(200,149,108,0.2);">
            <div style="width:28px;height:28px;background:linear-gradient(135deg,#c8956c,#a67c52);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;">${(user.name||'G')[0].toUpperCase()}</div>
            <span style="font-family:'DM Sans',sans-serif;color:#3e2723;font-size:13px;font-weight:600;">${user.name||'Guest'}</span>
            <span style="font-family:'DM Sans',sans-serif;color:#a1887f;font-size:11px;">${user.role||''}</span>
          </div>
          <button onclick="SmartBakers.session.clear()" style="background:none;border:1px solid rgba(200,149,108,0.3);color:#8d6e63;padding:6px 14px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(200,149,108,0.1)'" onmouseout="this.style.background='none'">Sign Out</button>
        </div>
        <!-- Notification Panel -->
        <div id="notif-panel" style="display:none;position:absolute;top:100%;right:16px;width:360px;background:#fffcf7;border:1px solid rgba(200,149,108,0.2);border-radius:16px;box-shadow:0 16px 40px rgba(62,39,35,0.15);z-index:100;overflow:hidden;">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(200,149,108,0.1);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-family:'Playfair Display',serif;color:#3e2723;font-size:16px;font-weight:600;">Notifications</span>
            <button onclick="SmartBakers.notifications.markAllRead();SmartBakers.notifications._renderPanel()" style="background:none;border:none;font-family:'DM Sans',sans-serif;color:#c8956c;font-size:12px;cursor:pointer;font-weight:600;">Mark all read</button>
          </div>
          <div id="notif-list" style="max-height:320px;overflow-y:auto;"></div>
        </div>
      `;
      SmartBakers.notifications._updateBadge();

      // Close panel on outside click
      document.addEventListener('click', (e) => {
        const panel = document.getElementById('notif-panel');
        const btn   = document.getElementById('notif-btn');
        if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
          panel.style.display = 'none';
        }
      });
    },

    togglePanel() {
      const panel = document.getElementById('notif-panel');
      if (!panel) return;
      const isHidden = panel.style.display === 'none';
      panel.style.display = isHidden ? 'block' : 'none';
      if (isHidden) SmartBakers.notifications._renderPanel();
    },

    _renderPanel() {
      const list = document.getElementById('notif-list');
      if (!list) return;
      const icons = { bid:'💰', accept:'✅', message:'💬', system:'🔔' };
      list.innerHTML = SmartBakers.notifications._data.map(n => `
        <div style="padding:14px 20px;border-bottom:1px solid rgba(200,149,108,0.08);background:${n.read ? 'transparent' : 'rgba(200,149,108,0.05)'};display:flex;gap:12px;align-items:flex-start;">
          <span style="font-size:20px;flex-shrink:0;">${icons[n.type]||'🔔'}</span>
          <div style="flex:1;min-width:0;">
            <p style="font-family:'DM Sans',sans-serif;color:#3e2723;font-size:13px;margin:0 0 4px;line-height:1.4;">${n.text}</p>
            <p style="font-family:'DM Sans',sans-serif;color:#a1887f;font-size:11px;margin:0;">${n.time}</p>
          </div>
          ${n.read ? '' : '<div style="width:8px;height:8px;background:#c8956c;border-radius:50%;flex-shrink:0;margin-top:4px;"></div>'}
        </div>
      `).join('');
    }
  },

  // ─── 4. AI CHATBOX ─────────────────────────────────────────────────────────
  chat: {
    _open: false,
    _history: [],

    inject() {
      const wrap = document.createElement('div');
      wrap.id = 'sb-chat-widget';
      wrap.innerHTML = `
        <style>
          #sb-chat-widget { position:fixed; bottom:24px; right:24px; z-index:9999; font-family:'DM Sans',sans-serif; }
          #chat-bubble { width:56px;height:56px;background:linear-gradient(135deg,#c8956c,#a67c52);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(200,149,108,0.4);transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);border:none; }
          #chat-bubble:hover { transform:scale(1.1); }
          #chat-window { display:none;position:absolute;bottom:70px;right:0;width:360px;background:#fffcf7;border:1px solid rgba(200,149,108,0.2);border-radius:20px;box-shadow:0 20px 60px rgba(62,39,35,0.2);overflow:hidden;flex-direction:column;max-height:500px; }
          #chat-window.open { display:flex; }
          #chat-header { padding:16px 20px;background:linear-gradient(135deg,#3e2723,#5d4037);display:flex;align-items:center;gap:12px;justify-content:space-between; }
          #chat-messages { flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;min-height:200px;max-height:300px; }
          #chat-input-row { padding:12px;border-top:1px solid rgba(200,149,108,0.1);display:flex;gap:8px; }
          #chat-input { flex:1;padding:10px 14px;border:1px solid rgba(200,149,108,0.3);border-radius:12px;font-size:13px;color:#3e2723;background:rgba(255,255,255,0.8);outline:none;font-family:'DM Sans',sans-serif; }
          #chat-send { padding:10px 16px;background:linear-gradient(135deg,#c8956c,#a67c52);color:white;border:none;border-radius:12px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s; }
          #chat-send:hover { transform:translateY(-1px); }
          .msg-user { align-self:flex-end;background:linear-gradient(135deg,#c8956c,#a67c52);color:#fffaf5;padding:10px 14px;border-radius:14px 14px 4px 14px;font-size:13px;max-width:80%;line-height:1.4; }
          .msg-ai { align-self:flex-start;background:rgba(200,149,108,0.1);color:#3e2723;padding:10px 14px;border-radius:14px 14px 14px 4px;font-size:13px;max-width:80%;line-height:1.4;border:1px solid rgba(200,149,108,0.15); }
          .msg-typing { align-self:flex-start;background:rgba(200,149,108,0.1);color:#a1887f;padding:10px 14px;border-radius:14px;font-size:13px;font-style:italic; }
        </style>
        <div id="chat-window">
          <div id="chat-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:22px;">🤖</span>
              <div>
                <p style="font-family:'Playfair Display',serif;color:#fffaf5;font-size:15px;font-weight:600;margin:0;">Baking Assistant</p>
                <p style="font-family:'DM Sans',sans-serif;color:rgba(255,250,245,0.6);font-size:11px;margin:0;">Powered by Claude AI</p>
              </div>
            </div>
            <button onclick="SmartBakers.chat.toggle()" style="background:none;border:none;color:rgba(255,250,245,0.7);cursor:pointer;font-size:20px;padding:4px;">×</button>
          </div>
          <div id="chat-messages">
            <div class="msg-ai">👋 Hi! I'm your Smart Bakers assistant. Ask me anything about placing bids, posting requests, pricing tips, or finding the perfect baker!</div>
          </div>
          <div id="chat-input-row">
            <input id="chat-input" type="text" placeholder="Ask about baking, bids, pricing…" onkeydown="if(event.key==='Enter')SmartBakers.chat.send()">
            <button id="chat-send" onclick="SmartBakers.chat.send()">Send</button>
          </div>
        </div>
        <button id="chat-bubble" onclick="SmartBakers.chat.toggle()" title="AI Baking Assistant">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
      `;
      document.body.appendChild(wrap);
    },

    toggle() {
      const win = document.getElementById('chat-window');
      if (!win) return;
      SmartBakers.chat._open = !SmartBakers.chat._open;
      win.classList.toggle('open', SmartBakers.chat._open);
      if (SmartBakers.chat._open) document.getElementById('chat-input')?.focus();
    },

    async send() {
      const input = document.getElementById('chat-input');
      const messages = document.getElementById('chat-messages');
      const text = input?.value?.trim();
      if (!text || !messages) return;

      input.value = '';
      // User bubble
      messages.innerHTML += `<div class="msg-user">${SmartBakers.chat._escHtml(text)}</div>`;
      // Typing indicator
      const typingId = 'typing-' + Date.now();
      messages.innerHTML += `<div class="msg-typing" id="${typingId}">Thinking…</div>`;
      messages.scrollTop = messages.scrollHeight;

      SmartBakers.chat._history.push({ role: 'user', content: text });

      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: `You are a friendly, knowledgeable assistant for Smart Bakers — an online marketplace connecting customers who want custom baked goods with skilled home and professional bakers. 
Help users with: placing bids, posting baking requests, understanding pricing, choosing the right baker, dietary requirements, cake types, timelines, and general advice about ordering custom baked goods.
Keep replies concise, warm, and practical. Use occasional baking-related emojis. Max 3 sentences unless more detail is truly needed.`,
            messages: SmartBakers.chat._history.slice(-10)
          })
        });
        const data = await resp.json();
        const reply = data.content?.map(b => b.text||'').join('') || 'Sorry, I could not get a response right now.';
        SmartBakers.chat._history.push({ role: 'assistant', content: reply });

        document.getElementById(typingId)?.remove();
        messages.innerHTML += `<div class="msg-ai">${SmartBakers.chat._escHtml(reply)}</div>`;
      } catch(e) {
        document.getElementById(typingId)?.remove();
        messages.innerHTML += `<div class="msg-ai">Sorry, I'm having trouble connecting right now. Please try again!</div>`;
      }
      messages.scrollTop = messages.scrollHeight;
    },

    _escHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    }
  },

  // ─── 5. TOAST ──────────────────────────────────────────────────────────────
  ui: {
    toast(msg, type = 'info') {
      const colors = { info:'#c8956c', success:'#6b8f5e', warning:'#e08a2e', error:'#e53935' };
      const el = document.createElement('div');
      el.style.cssText = `position:fixed;top:24px;right:24px;z-index:99999;background:${colors[type]||colors.info};color:white;padding:12px 20px;border-radius:12px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.15);transition:all 0.3s;opacity:0;transform:translateY(-10px);`;
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity='1'; el.style.transform='translateY(0)'; }, 10);
      setTimeout(() => { el.style.opacity='0'; setTimeout(() => el.remove(), 300); }, 3000);
    }
  },

  // ─── 6. GLOBAL INIT ────────────────────────────────────────────────────────
  init() {
    const ok = SmartBakers.auth.check();
    if (!ok) return;

    const user = SmartBakers.session.get();

    // Inject nav if placeholder exists
    SmartBakers.notifications.inject();

    // Inject AI chat on all authenticated pages
    if (user.id) SmartBakers.chat.inject();

    // Bind data-action elements
    document.querySelectorAll('[data-action]').forEach(el => {
      el.onclick = () => {
        const action = el.getAttribute('data-action');
        if (action === 'logout')        SmartBakers.session.clear();
        if (action === 'home')          SmartBakers.auth.goHome();
        if (action === 'post-request')  window.location.href = 'posting_baking_request.html';
        if (action === 'marketplace')   window.location.href = 'bakery_marketplace_dashboard_search.html';
        if (action === 'portfolio')     window.location.href = 'main_page_portfolio.html';
        if (action === 'view-bids')     window.location.href = 'customer_bid_accept.html';
      };
    });

    // Update name displays
    document.querySelectorAll('[data-sb-username]').forEach(el => {
      el.textContent = user.name || 'Guest';
    });
  }
};

document.addEventListener('DOMContentLoaded', SmartBakers.init);
