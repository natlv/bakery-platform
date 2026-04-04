(() => {
  let listingModalBuilt = false;

  function ensureListingModal() {
    if (listingModalBuilt) return;
    listingModalBuilt = true;
    const modal = document.createElement("div");
    modal.id = "listing-modal";
    modal.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(20,10,4,.72);backdrop-filter:blur(6px);z-index:450;padding:20px;";
    modal.innerHTML = `
      <div style="width:min(920px,100%);max-height:88vh;overflow:auto;border-radius:24px;background:#fffcf7;border:1px solid rgba(212,147,90,.2);box-shadow:0 30px 80px rgba(20,10,4,.45);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid rgba(212,147,90,.12);">
          <div>
            <div id="listing-modal-title" style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#3e2412;">Listings</div>
            <div id="listing-modal-sub" style="font-family:'DM Sans',sans-serif;font-size:13px;color:#9a7858;margin-top:4px;">Loading...</div>
          </div>
          <button onclick="closeListingModal()" style="background:none;border:none;color:#8a6a4a;font-size:28px;cursor:pointer;line-height:1;">×</button>
        </div>
        <div id="listing-modal-body" style="padding:20px;"></div>
      </div>`;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) window.closeListingModal();
    });
    document.body.appendChild(modal);
  }

  function listingCategory(item) {
    const hay = `${item.category} ${item.name} ${item.description} ${(item.dietary || []).join(" ")}`.toLowerCase();
    const cats = new Set();
    if (/(cake|cakes|cupcake|cupcakes|birthday|wedding|tier)/.test(hay)) cats.add("cakes");
    if (/(bread|sourdough|loaf|focaccia|brioche)/.test(hay)) cats.add("bread");
    if (/(pastry|croissant|danish|tart|puff|entremet)/.test(hay)) cats.add("pastry");
    if (/(cookie|cookies|biscuit|biscuits|shortbread)/.test(hay)) cats.add("cookies");
    if (/(halal|muslim)/.test(hay)) cats.add("halal");
    if (/(vegan|plant-based|plant based|dairy-free|dairy free|egg-free|egg free)/.test(hay)) cats.add("vegan");
    return Array.from(cats);
  }

  function previewTags(item) {
    const tags = [
      item.serves ? `Serves ${item.serves}` : "",
      item.lead_time ? `${item.lead_time} lead time` : "",
      ...(item.dietary || []).slice(0, 3),
    ].filter(Boolean);
    return tags.slice(0, 4);
  }

  function sortBakers(list) {
    return [...list].sort((a, b) => {
      const aiDiff = aiResults ? (b.aiScore || 0) - (a.aiScore || 0) : 0;
      if (aiDiff !== 0) return aiDiff;
      const adDiff = Number(Boolean(b.isAdvertising)) - Number(Boolean(a.isAdvertising));
      if (adDiff !== 0) return adDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  window.closeListingModal = function closeListingModal() {
    const modal = document.getElementById("listing-modal");
    if (modal) modal.style.display = "none";
  };

  window.openBakerListings = async function openBakerListings(bakerId) {
    ensureListingModal();
    const modal = document.getElementById("listing-modal");
    const body = document.getElementById("listing-modal-body");
    const title = document.getElementById("listing-modal-title");
    const sub = document.getElementById("listing-modal-sub");
    const baker = BAKERIES.find((entry) => entry.id === bakerId);
    title.textContent = baker ? `${baker.name} Listings` : "Listings";
    sub.textContent = "Loading live menu items...";
    body.innerHTML = `<div style="padding:24px;font-family:'DM Sans',sans-serif;color:#8d6e63;">Loading listings...</div>`;
    modal.style.display = "flex";
    try {
      const items = await SmartBakers.api.getMenuItems(bakerId, { status: "live" });
      sub.textContent = `${items.length} live item${items.length !== 1 ? "s" : ""}`;
      if (!items.length) {
        body.innerHTML = `<div style="padding:24px;border:1px solid rgba(212,147,90,.14);border-radius:18px;background:rgba(212,147,90,.05);font-family:'DM Sans',sans-serif;color:#8d6e63;">This baker has no live listings yet.</div>`;
        return;
      }
      body.innerHTML = items.map((item) => {
        const tags = previewTags(item);
        const emoji = inferEmoji({
          specialty: item.category || "",
          desc: item.description || "",
          tags,
        });
        const media = item.image_url
          ? `<img src="${SmartBakers.utils.escHtml(item.image_url)}" alt="${SmartBakers.utils.escHtml(item.name)}" style="width:92px;height:92px;border-radius:16px;object-fit:cover;border:1px solid rgba(212,147,90,.14);">`
          : `<div style="width:92px;height:92px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:rgba(212,147,90,.08);font-size:40px;border:1px solid rgba(212,147,90,.14);">${emoji}</div>`;
        return `
          <div style="display:flex;gap:16px;align-items:flex-start;padding:18px;border:1px solid rgba(212,147,90,.14);border-radius:18px;margin-bottom:14px;background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(255,248,240,.92));">
            ${media}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:8px;">
                <div>
                  <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#3e2412;">${SmartBakers.utils.escHtml(item.name)}</div>
                  <div style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#b17842;margin-top:4px;">${SmartBakers.utils.escHtml(SmartBakers.utils.sentenceCase(item.category || "custom-bake"))}</div>
                </div>
                <div style="font-family:'Playfair Display',serif;font-size:28px;font-weight:700;color:#a06030;white-space:nowrap;">${SmartBakers.utils.formatCurrency(item.price)}</div>
              </div>
              <div style="font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.65;color:#6d4f38;margin-bottom:10px;">${SmartBakers.utils.escHtml(item.description || "Freshly made to order.")}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">${tags.map((tag) => `<span style="padding:4px 10px;border-radius:999px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;background:rgba(212,147,90,.08);color:#9a6031;border:1px solid rgba(212,147,90,.18);">${SmartBakers.utils.escHtml(tag)}</span>`).join("")}</div>
            </div>
          </div>`;
      }).join("");
    } catch (error) {
      sub.textContent = "Could not load listings";
      body.innerHTML = `<div style="padding:24px;border:1px solid rgba(229,57,53,.16);border-radius:18px;background:rgba(229,57,53,.05);font-family:'DM Sans',sans-serif;color:#b23c31;">${SmartBakers.utils.escHtml(error.message || "Could not load listings.")}</div>`;
    }
  };

  window.toUiBaker = function toUiBaker(item) {
    const location = item.locations[0] || "Singapore";
    const tags = [
      ...item.specialties,
      item.halal_status === "Yes" ? "Halal" : "",
      item.less_sweet && item.less_sweet !== "No" ? `Less sweet: ${item.less_sweet}` : "",
      item.fulfillment_method || "",
    ].filter(Boolean).slice(0, 6);

    const specialty = item.specialties.length
      ? item.specialties.join(" • ")
      : (item.description || "Custom bakes");

    const baker = {
      id: item.baker_id,
      name: item.name,
      specialty,
      desc: item.description || "Browse this baker's menu items and available specialties.",
      imageUrl: item.image_url || "",
      halalCertificateUrl: item.halal_certificate_url || "",
      emoji: "🧁",
      tags,
      rating: 4.8,
      reviews: item.specialties.length ? item.specialties.length * 12 : 24,
      location,
      locations: item.locations,
      cats: [],
      halalStatus: item.halal_status || "",
      fulfillmentMethod: item.fulfillment_method || "",
      lessSweet: item.less_sweet || "",
      aiScore: 0,
      isAdvertising: Boolean(item.is_advertising),
    };

    baker.cats = inferCategories(baker);
    baker.emoji = inferEmoji(baker);
    return baker;
  };

  window.loadBakeries = async function loadBakeries() {
    const grid = document.getElementById("bakers-grid");
    const countEl = document.getElementById("bakers-count");
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;font-family:'DM Sans',sans-serif;color:rgba(255,248,240,.5);font-size:15px;">Loading bakeries from the database...</div>`;
    countEl.textContent = "";
    try {
      const rows = await SmartBakers.api.getBakers();
      const nextBakers = rows.map(window.toUiBaker);
      BAKERIES.splice(0, BAKERIES.length, ...sortBakers(nextBakers));
      const title = document.querySelector(".sec-title");
      if (title) title.textContent = "All bakeries";
      window.applyAll();
    } catch (error) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;font-family:'DM Sans',sans-serif;color:#f1c6a0;font-size:15px;">Could not load bakeries from the database right now.</div>`;
      SmartBakers.ui.toast("Could not load bakeries from the database.", "error");
      console.error("Failed to load bakers", error);
    }
  };

  window.renderBakeries = function renderBakeries(list) {
    const grid = document.getElementById("bakers-grid");
    const countEl = document.getElementById("bakers-count");
    grid.innerHTML = "";

    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;font-family:'DM Sans',sans-serif;color:rgba(255,248,240,.3);font-size:15px;">No bakeries match this filter.</div>`;
      countEl.textContent = "";
      return;
    }

    countEl.textContent = `${list.length} baker${list.length !== 1 ? "ies" : "y"} found`;

    list.forEach((b, i) => {
      const card = document.createElement("div");
      card.className = "baker-card glass";
      card.style.animationDelay = `${i * 0.055}s`;
      if (aiResults && b.aiScore >= 0.5) card.classList.add("ai-match");

      const rank = aiResults && b.aiScore > 0 ? list.indexOf(b) + 1 : null;
      const isHalal = hasHalalStatus(b.halalStatus);
      const muisUrl = `https://halal.muis.gov.sg/halal/establishments?name=${encodeURIComponent(b.name)}`;
      const mediaHtml = b.imageUrl
        ? `<img src="${b.imageUrl}" alt="${b.name}" style="width:100%;height:100%;object-fit:cover;">`
        : `<span>${b.emoji}</span>`;
      const promoBadge = b.isAdvertising ? `<div class="ai-badge" style="left:auto;right:9px;background:rgba(95,145,80,.9);">Featured</div>` : "";

      card.innerHTML = `
        <div class="card-img">
          ${mediaHtml}
          ${rank ? `<div class="ai-badge">✨ AI Pick #${rank}</div>` : ""}
          ${promoBadge}
        </div>
        <div class="card-body">
          <div class="card-header">
            <div class="baker-name">${b.name}</div>
            <div class="baker-loc">📍 ${b.location}</div>
          </div>
          <div class="baker-specialty">${b.specialty}</div>
          <div class="baker-desc">${b.desc}</div>
          <div class="baker-tags">${b.tags.map((t) => `<span class="btag">${t}</span>`).join("")}</div>
          <div class="card-footer">
            <div class="rating-row">
              <span class="stars">${"★".repeat(Math.round(b.rating))}</span>
              <span class="rating-num">${b.rating.toFixed(1)}</span>
              <span class="review-count">(${b.reviews})</span>
            </div>
            <button class="req-btn" onclick="event.stopPropagation();openBakerListings(${b.id})">Show Listing →</button>
          </div>
          ${isHalal ? `
          <div class="halal-strip">
            <div class="halal-cert-badge">
              <div class="hicon">✓</div>
              MUIS Halal Certified
            </div>
            <div class="halal-actions">
              ${b.halalCertificateUrl ? `<button class="cert-view-btn" data-name="${SmartBakers.utils.escHtml(b.name)}" data-url="${SmartBakers.utils.escHtml(b.halalCertificateUrl)}" onclick="event.stopPropagation();openCertModalFromButton(this)">Show Certificate</button>` : ""}
              <a class="halal-verify-link" href="${muisUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Verify on MUIS ↗</a>
            </div>
          </div>` : ""}
        </div>`;
      grid.appendChild(card);
    });
  };

  window.applyAll = function applyAll() {
    let list = BAKERIES.filter((b) => currentCat === "all" || b.cats.includes(currentCat));
    list = sortBakers(list);
    window.renderBakeries(list);
  };

  document.addEventListener("DOMContentLoaded", () => {
    ensureListingModal();
    const title = document.querySelector(".sec-title");
    if (title) title.textContent = "All bakeries";
  });
})();
