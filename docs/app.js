const DATA_URL = "data.json";
const AUTO_REFRESH_MS = 5 * 60 * 1000; // データ更新は15分間隔なので、5分おきに再取得すれば十分
const FILTER_NOTE = "15分間隔で自動確認・時刻は現地(JST)基準";

// サイトごとのアクセントカラー。未知のIDが増えても破綻しないようフォールバックを用意する。
const SITE_COLORS = {
  okegawa: "#2563eb",
  hasuda: "#16a34a",
  ageo: "#ea580c"
};
const FALLBACK_COLORS = ["#7c3aed", "#0891b2", "#db2777", "#65a30d"];

const WEEKDAY_FILTERS = [
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
  { key: "holiday", label: "祝" }
];

const state = {
  data: null,
  activeSites: new Set(), // 空 = すべて表示
  activeWeekdays: new Set(), // 空 = すべて表示
  minDuration: 120 // 120=2時間以上(すべて) / 180=3時間以上
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

// このシステムは土日祝のみを対象にしているため、土日以外は必然的に祝日
function weekdayInfoOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  const dow = d.getDay();
  if (dow === 6) return { date: d, dow, key: "sat", label: "土" };
  if (dow === 0) return { date: d, dow, key: "sun", label: "日" };
  return { date: d, dow, key: "holiday", label: "祝" };
}

function formatDateHeading(dateStr) {
  const { date, key, label } = weekdayInfoOf(dateStr);
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return { md, key, label };
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
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
  renderFilterBar();
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
}

function renderFilterBar() {
  const sites = state.data.sites || [];

  const siteChips = sites
    .map((site, i) => {
      const color = colorFor(site.id, i);
      const isActive = state.activeSites.size === 0 || state.activeSites.has(site.id);
      return `<button class="chip ${isActive ? "is-active" : ""}" style="--dot-color:${color}" data-site="${site.id}">
        <span class="dot"></span>${escapeHtml(site.name)}</button>`;
    })
    .join("");

  const weekdayChips = WEEKDAY_FILTERS.map(w => {
    const isActive = state.activeWeekdays.size === 0 || state.activeWeekdays.has(w.key);
    return `<button class="chip ${isActive ? "is-active" : ""}" data-weekday="${w.key}">${w.label}</button>`;
  }).join("");

  els.filterBar.innerHTML = `
    <div class="filter-row">
      <span class="filter-label">会場</span>
      ${siteChips}
    </div>
    <div class="filter-row">
      <span class="filter-label">枠の長さ</span>
      <div class="segmented">
        <button data-duration="120" class="${state.minDuration === 120 ? "is-active" : ""}">2時間以上</button>
        <button data-duration="180" class="${state.minDuration === 180 ? "is-active" : ""}">3時間以上</button>
      </div>
      <span class="filter-label" style="margin-left:8px">曜日</span>
      ${weekdayChips}
    </div>
    <div class="filter-row">
      <span class="filter-note">${FILTER_NOTE}</span>
    </div>`;

  els.filterBar.querySelectorAll("[data-site]").forEach(btn => {
    btn.addEventListener("click", () => toggleSite(btn.dataset.site));
  });
  els.filterBar.querySelectorAll("[data-weekday]").forEach(btn => {
    btn.addEventListener("click", () => toggleWeekday(btn.dataset.weekday));
  });
  els.filterBar.querySelectorAll("[data-duration]").forEach(btn => {
    btn.addEventListener("click", () => setMinDuration(Number(btn.dataset.duration)));
  });
}

function toggleSite(siteId) {
  const sites = state.data.sites || [];
  if (state.activeSites.size === 0) {
    // 全表示状態からクリック → そのサイトだけに絞り込む
    state.activeSites = new Set([siteId]);
  } else if (state.activeSites.has(siteId)) {
    state.activeSites.delete(siteId);
  } else {
    state.activeSites.add(siteId);
    if (state.activeSites.size === sites.length) state.activeSites.clear();
  }
  renderOverview();
  renderFilterBar();
  renderResults();
}

function toggleWeekday(key) {
  if (state.activeWeekdays.size === 0) {
    state.activeWeekdays = new Set([key]);
  } else if (state.activeWeekdays.has(key)) {
    state.activeWeekdays.delete(key);
  } else {
    state.activeWeekdays.add(key);
    if (state.activeWeekdays.size === WEEKDAY_FILTERS.length) state.activeWeekdays.clear();
  }
  renderFilterBar();
  renderResults();
}

function setMinDuration(minutes) {
  state.minDuration = minutes;
  renderFilterBar();
  renderResults();
}

function renderResults() {
  const sites = state.data.sites || [];
  const activeSites = sites.filter(s => state.activeSites.size === 0 || state.activeSites.has(s.id));

  const byDate = {};
  activeSites.forEach((site, i) => {
    const color = colorFor(site.id, i);
    (site.results || []).forEach(r => {
      if (r.durationMinutes != null && r.durationMinutes < state.minDuration) return;
      const wd = weekdayInfoOf(r.date);
      if (state.activeWeekdays.size > 0 && !state.activeWeekdays.has(wd.key)) return;

      byDate[r.date] = byDate[r.date] || [];
      byDate[r.date].push({ ...r, color });
    });
  });

  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    els.results.innerHTML = `
      <div class="state-block">
        <div class="icon">📭</div>
        <h2>条件に合う空き枠はありません</h2>
        <p>絞り込みを変更するか、新しい空き枠が見つかるまでお待ちください。</p>
      </div>`;
    return;
  }

  els.results.innerHTML = dates
    .map(dateStr => {
      const { md, key, label } = formatDateHeading(dateStr);
      const slots = byDate[dateStr].sort((a, b) => a.timeStart.localeCompare(b.timeStart));
      const cards = slots
        .map(
          s => `
        <a class="slot-card" style="--site-color:${s.color}" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
          <div class="slot-card-top">
            <span class="slot-site-badge" style="--site-color:${s.color}">${escapeHtml(s.siteName)}</span>
            <div class="slot-time-row">
              <span class="slot-time">${s.timeStart}〜${s.timeEnd}</span>
              ${s.durationMinutes != null ? `<span class="slot-duration">(${formatDuration(s.durationMinutes)})</span>` : ""}
            </div>
          </div>
          <div class="slot-facility">${escapeHtml(s.facilityName)}</div>
          <div class="slot-room">${escapeHtml(s.roomName)}</div>
        </a>`
        )
        .join("");

      return `
        <section class="date-group">
          <h2 class="date-heading">
            ${md}
            <span class="weekday ${key === "holiday" ? "is-holiday" : ""}">${label}</span>
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
