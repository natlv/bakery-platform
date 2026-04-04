(() => {
  let apiItems = [];
  let editId = null;
  let customOn = false;
  let itemStatus = "live";
  let csvRows = [];
  let currentImageUrl = "";
  const emojiMap = SmartBakers.requests.emojiMap;

  function bakerId() {
    return Number(SmartBakers.session.get().numericId || 0);
  }

  function syncCustomToggle() {
    document.getElementById("custom-toggle").style.background = customOn ? "#6b8f5e" : "rgba(200,149,108,.25)";
    document.getElementById("custom-thumb").style.transform = customOn ? "translateX(22px)" : "translateX(0)";
  }

  function renderStoredImage(url) {
    const strip = document.getElementById("photo-preview-strip");
    strip.innerHTML = "";
    document.getElementById("photo-drop").style.borderColor = url ? "#c8956c" : "";
    if (!url) return;
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid rgba(200,149,108,.25);";
    strip.appendChild(img);
  }

  async function uploadListingImageIfNeeded() {
    const input = document.getElementById("photo-input");
    if (!input.files.length) return currentImageUrl;
    const formData = new FormData();
    formData.append("file", input.files[0]);
    const result = await SmartBakers.api.request("/upload-image", {
      method: "POST",
      body: formData,
    });
    return result?.filename || currentImageUrl;
  }

  function collectPayload(imageUrl) {
    const name = document.getElementById("item-name").value.trim();
    const price = parseFloat(document.getElementById("item-price").value);
    let ok = true;
    if (!name) {
      document.getElementById("item-name-err").style.display = "block";
      ok = false;
    } else {
      document.getElementById("item-name-err").style.display = "none";
    }
    if (!price || price <= 0) {
      document.getElementById("item-price-err").style.display = "block";
      ok = false;
    } else {
      document.getElementById("item-price-err").style.display = "none";
    }
    if (!ok) return null;

    return {
      baker_id: bakerId(),
      name,
      category: document.getElementById("item-cat").value || "occasion-cake",
      description: document.getElementById("item-desc").value.trim(),
      price,
      lead_time: document.getElementById("item-lead").value,
      serves: document.getElementById("item-serves").value.trim(),
      dietary: Array.from(document.querySelectorAll(".diet-chip.on")).map((b) => b.textContent.trim()),
      custom_orders: customOn,
      status: itemStatus,
      image_url: imageUrl || "",
    };
  }

  async function loadItems() {
    const id = bakerId();
    if (!id) {
      SmartBakers.ui.toast("Could not determine baker account.", "error");
      return;
    }
    const container = document.getElementById("listings-container");
    container.innerHTML = `<div class="glass" style="padding:20px;border-radius:16px;font-family:'DM Sans',sans-serif;color:#8d6e63;">Loading your listings...</div>`;
    try {
      apiItems = await SmartBakers.api.getMenuItems(id);
      window.renderListings();
    } catch (error) {
      container.innerHTML = `<div class="glass" style="padding:20px;border-radius:16px;font-family:'DM Sans',sans-serif;color:#c62828;">Could not load your listings.</div>`;
      SmartBakers.ui.toast(error.message || "Could not load your listings.", "error");
    }
  }

  window.switchTab = function switchTab(tab) {
    ["listing", "add", "bulk"].forEach((t) => {
      document.getElementById("panel-" + t).style.display = t === tab ? "block" : "none";
      document.getElementById("tab-" + t).className = "tab-pill " + (t === tab ? "act" : "inact");
    });
    if (tab === "listing") window.renderListings();
  };

  window.toggleCustom = function toggleCustom() {
    customOn = !customOn;
    syncCustomToggle();
  };

  window.setStatus = function setStatus(s) {
    itemStatus = s;
    document.getElementById("status-live").className = "tab-pill " + (s === "live" ? "act" : "inact");
    document.getElementById("status-draft").className = "tab-pill " + (s === "draft" ? "act" : "inact");
  };

  window.previewPhoto = function previewPhoto(input) {
    const strip = document.getElementById("photo-preview-strip");
    const files = Array.from(input.files).slice(0, 5);
    strip.innerHTML = "";
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement("img");
        img.src = e.target.result;
        img.style.cssText = "width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid rgba(200,149,108,.25);";
        strip.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
    document.getElementById("photo-drop").style.borderColor = files.length ? "#c8956c" : "";
  };

  window.dragOver = function dragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
  };

  window.dragLeave = function dragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  };

  window.dropFile = function dropFile(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    if (!e.dataTransfer.files.length) return;
    const fi = document.getElementById("photo-input");
    fi.files = e.dataTransfer.files;
    window.previewPhoto(fi);
  };

  window.dropCsv = function dropCsv(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) window.parseCsvFile(file);
  };

  window.saveItem = async function saveItem() {
    const button = document.getElementById("save-item-btn");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = editId ? "Updating..." : "Saving...";
    try {
      const imageUrl = await uploadListingImageIfNeeded();
      const payload = collectPayload(imageUrl);
      if (!payload) return;
      const saved = editId
        ? await SmartBakers.api.updateMenuItem(editId, payload)
        : await SmartBakers.api.createMenuItem(payload);
      const idx = apiItems.findIndex((item) => item.item_id === saved.item_id);
      if (idx > -1) apiItems[idx] = saved;
      else apiItems.unshift(saved);
      apiItems.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      SmartBakers.ui.toast(itemStatus === "live" ? "✅ Item published!" : "📝 Saved as draft", "success");
      window.resetForm();
      window.switchTab("listing");
      window.renderListings();
    } catch (error) {
      SmartBakers.ui.toast(error.message || "Could not save item.", "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };

  window.resetForm = function resetForm() {
    ["item-name", "item-desc", "item-serves", "item-price"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("item-cat").value = "";
    document.getElementById("item-lead").value = "";
    document.querySelectorAll(".diet-chip.on").forEach((b) => b.classList.remove("on"));
    document.getElementById("photo-preview-strip").innerHTML = "";
    document.getElementById("photo-input").value = "";
    document.getElementById("photo-drop").style.borderColor = "";
    customOn = false;
    currentImageUrl = "";
    syncCustomToggle();
    window.setStatus("live");
    editId = null;
    document.getElementById("form-title").textContent = "Add Menu Item";
    document.getElementById("form-sub").textContent = "Fill in the details for your new baked good";
    document.getElementById("save-item-btn").textContent = "Save Item";
  };

  window.editItem = function editItem(id) {
    const item = apiItems.find((entry) => entry.item_id === id);
    if (!item) return;
    editId = id;
    window.switchTab("add");
    document.getElementById("item-name").value = item.name || "";
    document.getElementById("item-cat").value = item.category || "";
    document.getElementById("item-desc").value = item.description || "";
    document.getElementById("item-price").value = item.price || "";
    document.getElementById("item-lead").value = item.lead_time || "";
    document.getElementById("item-serves").value = item.serves || "";
    document.querySelectorAll(".diet-chip").forEach((btn) => {
      btn.classList.toggle("on", (item.dietary || []).includes(btn.textContent.trim()));
    });
    customOn = Boolean(item.custom_orders);
    currentImageUrl = item.image_url || "";
    syncCustomToggle();
    renderStoredImage(currentImageUrl);
    window.setStatus(item.status || "live");
    document.getElementById("form-title").textContent = "Edit Item";
    document.getElementById("form-sub").textContent = "Update the details below";
    document.getElementById("save-item-btn").textContent = "Update Item";
  };

  window.deleteItem = async function deleteItem(id) {
    if (!confirm("Delete this item?")) return;
    try {
      await SmartBakers.api.deleteMenuItem(id, bakerId());
      apiItems = apiItems.filter((item) => item.item_id !== id);
      window.renderListings();
      SmartBakers.ui.toast("Item removed.", "info");
    } catch (error) {
      SmartBakers.ui.toast(error.message || "Could not remove item.", "error");
    }
  };

  window.toggleStatus = async function toggleStatus(id) {
    const item = apiItems.find((entry) => entry.item_id === id);
    if (!item) return;
    try {
      const saved = await SmartBakers.api.updateMenuItem(id, {
        baker_id: item.baker_id,
        name: item.name,
        category: item.category,
        description: item.description,
        price: item.price,
        lead_time: item.lead_time,
        serves: item.serves,
        dietary: item.dietary || [],
        custom_orders: item.custom_orders,
        status: item.status === "live" ? "draft" : "live",
        image_url: item.image_url || "",
      });
      const idx = apiItems.findIndex((entry) => entry.item_id === id);
      if (idx > -1) apiItems[idx] = saved;
      window.renderListings();
      SmartBakers.ui.toast(saved.status === "live" ? "🟢 Item is now live" : "📝 Moved to draft", "info");
    } catch (error) {
      SmartBakers.ui.toast(error.message || "Could not update item status.", "error");
    }
  };

  window.renderListings = function renderListings() {
    const q = (document.getElementById("listing-search")?.value || "").toLowerCase();
    const filter = document.getElementById("listing-filter")?.value || "";
    const filtered = apiItems.filter((item) => {
      const matchQ = !q || item.name.toLowerCase().includes(q);
      const matchF = !filter || item.status === filter;
      return matchQ && matchF;
    });

    const container = document.getElementById("listings-container");
    const empty = document.getElementById("empty-state");

    document.getElementById("stat-total").textContent = apiItems.length;
    document.getElementById("stat-live").textContent = apiItems.filter((i) => i.status === "live").length;
    document.getElementById("stat-draft").textContent = apiItems.filter((i) => i.status === "draft").length;
    const prices = apiItems.map((i) => i.price).filter(Boolean);
    document.getElementById("stat-avg").textContent = prices.length
      ? "$" + Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : "—";

    if (!filtered.length) {
      container.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    container.innerHTML = filtered.map((item) => {
      const emoji = emojiMap[item.category] || "🍰";
      const badgeCls = item.status === "live" ? "badge-open" : "badge-draft";
      const badgeTxt = item.status === "live" ? "🟢 Live" : "📝 Draft";
      const dietary = (item.dietary || []).slice(0, 3).map((d) => `<span style="font-size:11px;padding:2px 7px;border-radius:6px;background:rgba(107,143,94,.08);color:#4a7c3f;border:1px solid rgba(107,143,94,.15);font-family:'DM Sans',sans-serif;">${SmartBakers.utils.escHtml(d)}</span>`).join("");
      const media = item.image_url
        ? `<img src="${SmartBakers.utils.escHtml(item.image_url)}" alt="${SmartBakers.utils.escHtml(item.name)}" style="width:64px;height:64px;border-radius:12px;object-fit:cover;">`
        : emoji;
      return `
        <div class="item-card pop" style="animation-delay:0s;">
          <div class="item-thumb">${media}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
              <p style="font-family:'Playfair Display',serif;color:#3e2723;font-size:16px;font-weight:700;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${SmartBakers.utils.escHtml(item.name)}</p>
              <span class="badge ${badgeCls}">${badgeTxt}</span>
            </div>
            <p style="font-family:'DM Sans',sans-serif;color:#8d6e63;font-size:12px;margin:0 0 6px;">${item.serves ? "Serves " + SmartBakers.utils.escHtml(item.serves) + " · " : ""}${item.lead_time ? SmartBakers.utils.escHtml(item.lead_time) + " lead time" : ""}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${dietary}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <p style="font-family:'Playfair Display',serif;color:#c8956c;font-size:20px;font-weight:700;margin:0 0 10px;">$${Number(item.price).toFixed(2)}</p>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button onclick="toggleStatus(${item.item_id})" style="padding:6px 10px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;background:rgba(200,149,108,.1);color:#8d6e63;border:1px solid rgba(200,149,108,.2);">${item.status === "live" ? "Unpublish" : "Publish"}</button>
              <button onclick="editItem(${item.item_id})" style="padding:6px 10px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;background:rgba(200,149,108,.1);color:#8d6e63;border:1px solid rgba(200,149,108,.2);">Edit</button>
              <button onclick="deleteItem(${item.item_id})" style="padding:6px 10px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;background:rgba(229,57,53,.06);color:#c62828;border:1px solid rgba(229,57,53,.15);">Delete</button>
            </div>
          </div>
        </div>`;
    }).join("");
  };

  window.downloadTemplate = function downloadTemplate() {
    const header = "name,category,description,price,lead_time,serves,dietary,custom_orders,status";
    const example = `"Matcha Opera Cake","birthday-cake","Light matcha sponge with mascarpone",68,"48h","8-10","Vegan,Gluten-free",true,"live"`;
    const blob = new Blob([header + "\n" + example], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "smart_bakers_menu_template.csv";
    a.click();
    SmartBakers.ui.toast("Template downloaded!", "success");
  };

  window.parseCsv = function parseCsv(input) {
    if (!input.files.length) return;
    window.parseCsvFile(input.files[0]);
  };

  window.parseCsvFile = function parseCsvFile(file) {
    document.getElementById("csv-label").textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result.split("\n").map((l) => l.trim()).filter(Boolean);
      const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
      csvRows = lines.slice(1).map((line) => {
        const vals = line.match(/(".*?"|[^,]+)/g) || [];
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] || "").replace(/"/g, "").trim(); });
        return obj;
      });
      document.getElementById("csv-count-label").textContent = `Previewing ${csvRows.length} item${csvRows.length !== 1 ? "s" : ""}`;
      window.renderCsvTable(headers, csvRows);
      document.getElementById("csv-preview").style.display = "block";
      document.getElementById("bulk-save-btn").disabled = csvRows.length === 0;
    };
    reader.readAsText(file);
  };

  window.renderCsvTable = function renderCsvTable(headers, rows) {
    const table = document.getElementById("csv-table");
    const head = `<thead><tr>${headers.map((h) => `<th style="padding:8px 12px;text-align:left;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:#8d6e63;border-bottom:1px solid rgba(200,149,108,.18);white-space:nowrap;">${SmartBakers.utils.escHtml(h)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${rows.slice(0, 10).map((row, ri) => `<tr style="background:${ri % 2 ? "transparent" : "rgba(200,149,108,.03)"};">${headers.map((h) => `<td style="padding:7px 12px;font-family:'DM Sans',sans-serif;font-size:12px;color:#5c3d2e;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;">${SmartBakers.utils.escHtml(row[h] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
    table.innerHTML = head + body;
  };

  window.clearCsv = function clearCsv() {
    csvRows = [];
    document.getElementById("csv-preview").style.display = "none";
    document.getElementById("csv-input").value = "";
    document.getElementById("csv-label").textContent = "Drop your CSV here or click to upload";
    document.getElementById("bulk-save-btn").disabled = true;
  };

  window.bulkSave = async function bulkSave() {
    if (!csvRows.length) return;
    const button = document.getElementById("bulk-save-btn");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Importing...";
    try {
      const createdItems = [];
      for (const row of csvRows) {
        const created = await SmartBakers.api.createMenuItem({
          baker_id: bakerId(),
          name: row.name || "Unnamed",
          category: row.category || "occasion-cake",
          description: row.description || "",
          price: parseFloat(row.price) || 1,
          lead_time: row.lead_time || "",
          serves: row.serves || "",
          dietary: row.dietary ? row.dietary.split(",").map((d) => d.trim()).filter(Boolean) : [],
          custom_orders: String(row.custom_orders).toLowerCase() === "true",
          status: row.status === "draft" ? "draft" : "live",
          image_url: "",
        });
        createdItems.push(created);
      }
      apiItems = [...createdItems, ...apiItems];
      apiItems.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      SmartBakers.ui.toast(`✅ ${createdItems.length} items imported!`, "success");
      window.clearCsv();
      window.switchTab("listing");
      window.renderListings();
    } catch (error) {
      SmartBakers.ui.toast(error.message || "Could not import items.", "error");
    } finally {
      button.disabled = csvRows.length === 0;
      button.textContent = original;
    }
  };

  document.addEventListener("DOMContentLoaded", async () => {
    syncCustomToggle();
    await loadItems();
  });
})();
