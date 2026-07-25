const DATA_URL = "data.json";
const AUTO_REFRESH_MS = 5 * 60 * 1000; // データ更新は15分間隔なので、5分おきに再取得すれば十分

// サイトごとのアクセントカラー。未知のIDが増えても破綻しないようフォールバックを用意する。
const SITE_COLORS = {
  okegawa: "#2563eb",
  hasuda: "#16a34a",
  ageo: "#ea580c"
};
const FALLBACK_COLORS = ["#7c3aed", "#0891b2", "#db2777", "#65a30d"];

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const state = {
  data: null,
  activeSites: new Set() // 空 = すべて表示
};

const els = {
  generatedAt: document.getElementById("generated-at"),
  overview: document.getElementById("overview"),
  filterBar: document.getElementById("filter-bar"),
  results: document.getElementById("results"),
  refreshBtn: document.getElementById("refresh-btn"),
  themeToggle: document.getElementById("theme-toggle")
};

function colorFor(siteId, index) {
  return SITE_COLORS[siteId] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function relativeTime(isoString) {
  if (!isoString) return "不明";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  return `${day}日前`;
}

function formatDateHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  const weekday = d.getDay();
  // このシステムは土日祝のみを対象にしているため、土日以外は必然的に祝日
  const isHoliday = weekday !== 0 && weekday !== 6;
  const label = isHoliday ? "祝" : WEEKDAY_LABELS[weekday];
  return { text: `${md}（${label}）`, isHoliday };
}

async function loadData() {
  els.refreshBtn.classList.add("spinning");
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    render();
  } catch (err) {
    els.generatedAt.textContent = "データの取得に失敗しました";
    els.results.innerHTML = `
      <div class="state-block">
        <div class="icon">⚠️</div>
        <h2>データを読み込めませんでした</h2>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  } finally {
    setTimeout(() => els.refreshBtn.classList.remove("spinning"), 400);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  if (!state.data) return;
  renderHeader();
  renderOverview();
  renderResults();
}

function renderHeader() {
  els.generatedAt.innerHTML = `最終更新: <strong>${relativeTime(state.data.generatedAt)}</strong>`;
}

function renderOverview() {
  const sites = state.data.sites || [];
  els.overview.innerHTML = sites
    .map((site, i) => {
      const color = colorFor(site.id, i);
      const count = (site.results || []).length;
      const isOff = state.activeSites.size > 0 && !state.activeSites.has(site.id);
      let statusClass = "";
      let metaText = `最終確認: ${relativeTime(site.checkedAt)}`;
      let metaClass = "";
      if (site.error) {
        statusClass = site.results && site.results.length ? "is-warn" : "is-danger";
        metaText = `確認エラー(${relativeTime(site.lastErrorAt || site.checkedAt)}) - 表示は前回取得分`;
        metaClass = "is-danger";
      }
      return `
        <div class="site-card ${isOff ? "is-off" : ""}" style="--site-color:${color}" data-site="${site.id}">
          <div class="site-card-top">
            <span class="site-card-name">${escapeHtml(site.name)}</span>
            <span class="status-dot ${statusClass}"></span>
          </div>
          <div class="site-card-count">${count}<span>件の空き枠</span></div>
          <div class="site-card-meta ${metaClass}">${metaText}</div>
        </div>`;
    })
    .join("");

  els.overview.querySelectorAll(".site-card").forEach(card => {
    card.addEventListener("click", () => toggleSite(card.dataset.site));
  });

  renderFilterChips();
}

function renderFilterChips() {
  const sites = state.data.sites || [];
  const existingNote = els.filterBar.querySelector(".filter-note");
  els.filterBar.innerHTML = "";

  sites.forEach((site, i) => {
    const color = colorFor(site.id, i);
    const isActive = state.activeSites.size === 0 || state.activeSites.has(site.id);
    const chip = document.createElement("button");
    chip.className = `chip ${isActive ? "is-active" : ""}`;
    chip.style.setProperty("--dot-color", color);
    chip.innerHTML = `<span class="dot"></span>${escapeHtml(site.name)}`;
    chip.addEventListener("click", () => toggleSite(site.id));
    els.filterBar.appendChild(chip);
  });

  els.filterBar.appendChild(existingNote);
}

function toggleSite(siteId) {
  const sites = state.data.sites || [];
  if (state.activeSites.size === 0) {
    // 全表示状態からクリック → そのサイトだけに絞り込む
    state.activeSites = new Set([siteId]);
  } else if (state.activeSites.has(siteId)) {
    state.activeSites.delete(siteId);
    if (state.activeSites.size === 0) {
      // 全解除されたら全表示に戻す
    } else if (state.activeSites.size === sites.length) {
      state.activeSites.clear();
    }
  } else {
    state.activeSites.add(siteId);
    if (state.activeSites.size === sites.length) state.activeSites.clear();
  }
  renderOverview();
  renderResults();
}

function renderResults() {
  const sites = state.data.sites || [];
  const activeSites = sites.filter(s => state.activeSites.size === 0 || state.activeSites.has(s.id));

  const byDate = {};
  activeSites.forEach((site, i) => {
    const color = colorFor(site.id, i);
    (site.results || []).forEach(r => {
      byDate[r.date] = byDate[r.date] || [];
      byDate[r.date].push({ ...r, color });
    });
  });

  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    els.results.innerHTML = `
      <div class="state-block">
        <div class="icon">📭</div>
        <h2>現在、条件に合う空き枠はありません</h2>
        <p>3時間以上連続で空いている枠が見つかり次第、ここに表示されます。</p>
      </div>`;
    return;
  }

  els.results.innerHTML = dates
    .map(dateStr => {
      const { text, isHoliday } = formatDateHeading(dateStr);
      const slots = byDate[dateStr].sort((a, b) => a.timeStart.localeCompare(b.timeStart));
      const cards = slots
        .map(
          s => `
        <a class="slot-card" style="--site-color:${s.color}" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
          <div class="slot-card-top">
            <span class="slot-site-badge" style="--site-color:${s.color}">${escapeHtml(s.siteName)}</span>
            <span class="slot-time">${s.timeStart}〜${s.timeEnd}</span>
          </div>
          <div class="slot-facility">${escapeHtml(s.facilityName)}</div>
          <div class="slot-room">${escapeHtml(s.roomName)}</div>
        </a>`
        )
        .join("");

      return `
        <section class="date-group">
          <h2 class="date-heading">
            ${text.replace(/（.+）/, "")}
            <span class="weekday ${isHoliday ? "is-holiday" : ""}">${text.match(/（(.+)）/)[1]}</span>
          </h2>
          <div class="slot-grid">${cards}</div>
        </section>`;
    })
    .join("");
}

function initTheme() {
  const saved = localStorage.getItem("gym-dashboard-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : current === "light" ? null : "dark";
    if (next) {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("gym-dashboard-theme", next);
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("gym-dashboard-theme");
    }
  });
}

initTheme();
els.refreshBtn.addEventListener("click", loadData);
loadData();
setInterval(loadData, AUTO_REFRESH_MS);
