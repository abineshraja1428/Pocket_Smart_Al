// PocketSmart AI - Enhanced Frontend Engine v2.0
// Features: JWT Auth, OCR Receipt Scanning, Monthly Charts, CSV Export, Enhanced AI

// ─── State Management ──────────────────────────────────────────────────────
let allExpenses        = [];
let allGoals           = [];
let currentSummary     = null;
let trendChartInstance = null;
let categoryChartInstance = null;
let monthlyChartInstance  = null;
let authToken          = null;
let currentUser        = null;

const CATEGORY_COLORS = {
  "Food":          "#f97316",
  "Transport":     "#06b6d4",
  "Shopping":      "#ec4899",
  "Bills":         "#3b82f6",
  "Entertainment": "#8b5cf6",
  "Health":        "#10b981",
  "Other":         "#64748b",
};

const CATEGORY_BENCHMARKS = {
  "Food":          10000,
  "Transport":      4000,
  "Shopping":       6000,
  "Bills":         12000,
  "Entertainment":  3500,
  "Health":         3500,
  "Other":          3000,
};

// ─── Formatters ────────────────────────────────────────────────────────────
function formatMoney(amount) {
  const num  = Number(amount) || 0;
  const sign = num < 0 ? "-" : "";
  return sign + "₹" + Math.abs(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Toast System ──────────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity    = "0";
    toast.style.transform  = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Auth Helpers ──────────────────────────────────────────────────────────
function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const geminiKey = localStorage.getItem("pocketsmart_gemini_key") || "";
  if (geminiKey) headers["x-gemini-api-key"] = geminiKey;
  return headers;
}

function saveAuthState(token, user) {
  authToken   = token;
  currentUser = user;
  if (token) {
    localStorage.setItem("ps_auth_token",   token);
    localStorage.setItem("ps_current_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("ps_auth_token");
    localStorage.removeItem("ps_current_user");
  }
}

function loadAuthState() {
  authToken   = localStorage.getItem("ps_auth_token") || null;
  const saved = localStorage.getItem("ps_current_user");
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch { currentUser = null; }
  }
  return !!(authToken && currentUser);
}

function showAuthScreen() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("appShell").style.display   = "none";
}

function showAppShell() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appShell").style.display   = "block";
  updateUserMenu();
  loadAll();
}

function updateUserMenu() {
  if (!currentUser) return;
  const initial = (currentUser.username || "?")[0].toUpperCase();
  document.getElementById("userAvatarInitial").textContent  = initial;
  document.getElementById("userDropdownName").textContent   = currentUser.username || "User";
}

// ─── Auth Tab Switching ─────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.getElementById("loginForm").style.display    = tab === "login"    ? "flex" : "none";
  document.getElementById("registerForm").style.display = tab === "register" ? "flex" : "none";
  document.getElementById("loginTab").classList.toggle("active",    tab === "login");
  document.getElementById("registerTab").classList.toggle("active", tab === "register");
  document.getElementById("loginError").style.display    = "none";
  document.getElementById("registerError").style.display = "none";
}

// ─── Auth Events ────────────────────────────────────────────────────────────
function setupAuthListeners() {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = document.getElementById("loginIdentifier").value.trim();
    const password   = document.getElementById("loginPassword").value;
    const errEl      = document.getElementById("loginError");
    errEl.style.display = "none";

    try {
      const res  = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username: identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent   = data.error || "Login failed";
        errEl.style.display = "block";
        return;
      }
      saveAuthState(data.token, { username: data.username, user_id: data.user_id });
      showToast(`Welcome back, ${data.username}!`, "success");
      showAppShell();
    } catch {
      errEl.textContent   = "Network error. Please try again.";
      errEl.style.display = "block";
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("regUsername").value.trim();
    const email    = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const errEl    = document.getElementById("registerError");
    errEl.style.display = "none";

    try {
      const res  = await fetch("/api/auth/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent   = data.error || "Registration failed";
        errEl.style.display = "block";
        return;
      }
      saveAuthState(data.token, { username: data.username, user_id: data.user_id });
      showToast(`Account created! Welcome, ${data.username}!`, "success");
      showAppShell();
    } catch {
      errEl.textContent   = "Network error. Please try again.";
      errEl.style.display = "block";
    }
  });
}

// ─── Theme Management ───────────────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem("pocketsmart_theme") || "dark";
  setTheme(savedTheme);
  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const next = (document.documentElement.getAttribute("data-theme") || "dark") === "dark" ? "light" : "dark";
    setTheme(next);
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("pocketsmart_theme", theme);
  document.getElementById("themeIcon").textContent  = theme === "dark" ? "☀️" : "🌙";
  document.getElementById("themeLabel").textContent = theme === "dark" ? "Light" : "Dark";
  if (trendChartInstance || categoryChartInstance || monthlyChartInstance) updateChartsTheme();
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    text: isDark ? "#94a3b8" : "#64748b",
    grid: isDark ? "rgba(255,255,255,0.08)" : "rgba(226,232,240,0.8)",
  };
}

function updateChartsTheme() {
  const c = getChartColors();
  [trendChartInstance, monthlyChartInstance].forEach(chart => {
    if (!chart) return;
    chart.options.scales.x.ticks.color = c.text;
    chart.options.scales.y.ticks.color = c.text;
    chart.options.scales.x.grid.color  = c.grid;
    chart.options.scales.y.grid.color  = c.grid;
    chart.update();
  });
  if (categoryChartInstance) {
    categoryChartInstance.options.plugins.legend.labels.color = c.text;
    categoryChartInstance.update();
  }
}

// ─── Data Loading ───────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [summaryRes, expensesRes, goalsRes, aiRes] = await Promise.all([
      fetch("/api/summary",          { headers: getAuthHeaders() }),
      fetch("/api/expenses",         { headers: getAuthHeaders() }),
      fetch("/api/goals",            { headers: getAuthHeaders() }),
      fetch("/api/ai-recommendations", { headers: getAuthHeaders() }),
    ]);

    if (summaryRes.status === 401 || expensesRes.status === 401) {
      saveAuthState(null, null);
      showAuthScreen();
      return;
    }

    currentSummary = await summaryRes.json();
    allExpenses    = await expensesRes.json();
    allGoals       = await goalsRes.json();
    const aiData   = await aiRes.json();

    populateMonthFilter();
    renderHero(currentSummary);
    renderKPIs(currentSummary);
    renderCharts(currentSummary);
    renderMonthlyTrend(currentSummary);
    renderCategoryRunway(currentSummary.by_category);
    renderGoals(allGoals);
    renderTransactions();
    renderAIRecommendations(aiData);
  } catch (err) {
    console.error("Dashboard load error:", err);
    showToast("Failed to fetch financial data", "danger");
  }
}

function populateMonthFilter() {
  const select = document.getElementById("txMonthFilter");
  const months = new Set(allExpenses.map(e => e.date.slice(0, 7)));
  const current = select.value;
  // Keep "All Months" option, rebuild rest
  while (select.options.length > 1) select.remove(1);
  [...months].sort().reverse().forEach(m => {
    const d    = new Date(m + "-01");
    const label = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    const opt  = document.createElement("option");
    opt.value  = m;
    opt.textContent = label;
    if (m === current) opt.selected = true;
    select.appendChild(opt);
  });
}

// ─── Hero & KPIs ────────────────────────────────────────────────────────────
function renderHero(summary) {
  const now = new Date();
  document.getElementById("heroPeriodPill").textContent =
    now.toLocaleString("en-US", { month: "long", year: "numeric" }) + " Cycle";

  const score       = summary.health_score || 85;
  const scoreCircle = document.getElementById("scoreCircle");
  const scoreVal    = document.getElementById("healthScoreValue");
  const scoreBadge  = document.getElementById("healthScoreBadge");

  scoreVal.textContent   = score;
  scoreBadge.textContent = summary.health_status || "Optimal";

  let statusColor = "var(--success)";
  if (score < 65) statusColor = "var(--danger)";
  else if (score < 80) statusColor = "var(--warning)";

  scoreCircle.style.borderColor = statusColor;
  scoreVal.style.color          = statusColor;
  scoreBadge.style.color        = statusColor;

  document.getElementById("healthScoreSummary").textContent =
    `Using ${summary.savings_rate}% savings buffer. Spending velocity is ${formatMoney(summary.daily_average)}/day.`;

  const remaining = summary.remaining;
  const limit     = summary.monthly_limit || 40000;
  const spent     = summary.month_total || 0;

  document.getElementById("remainingBudgetHero").textContent =
    Math.abs(remaining).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  const noteEl = document.getElementById("remainingBudgetNote");
  if (remaining < 0) {
    noteEl.textContent  = `Over budget by ${formatMoney(Math.abs(remaining))}`;
    noteEl.style.color  = "var(--danger)";
  } else {
    noteEl.textContent  = `Available runway this month (${summary.savings_rate}% buffer)`;
    noteEl.style.color  = "var(--text-muted)";
  }

  const pct  = Math.min(100, Math.max(0, (spent / limit) * 100));
  const fill = document.getElementById("budgetProgressFill");
  fill.style.width      = `${pct}%`;
  fill.style.background = pct > 90 ? "var(--danger)" : pct > 75 ? "var(--warning)" : "linear-gradient(90deg, var(--primary), var(--accent-ai))";

  document.getElementById("budgetSpentLabel").textContent = `Spent: ${formatMoney(spent)}`;
  document.getElementById("budgetLimitLabel").textContent = `Limit: ${formatMoney(limit)}`;

  const daysLeft   = Math.max(1, 30 - now.getDate());
  const dailyRun   = Math.max(0, remaining / daysLeft);
  document.getElementById("dailyRunwayValue").textContent = `${formatMoney(dailyRun)} / day`;
}

function renderKPIs(summary) {
  document.getElementById("kpiTotalSpent").textContent    = formatMoney(summary.total);
  document.getElementById("kpiTxCount").textContent       = `${summary.expense_count || allExpenses.length} transactions recorded`;
  document.getElementById("kpiMonthSpent").textContent    = formatMoney(summary.month_total);
  const spentRatio = summary.monthly_limit > 0 ? (summary.month_total / summary.monthly_limit) * 100 : 0;
  document.getElementById("kpiMonthPercent").textContent  = `${spentRatio.toFixed(1)}% of ₹${(summary.monthly_limit).toLocaleString("en-IN")} cap`;
  document.getElementById("kpiSavingsRate").textContent   = `${summary.savings_rate.toFixed(1)}%`;
  document.getElementById("kpiSavingsStatus").textContent = summary.savings_rate >= 20 ? "Target Met (Healthy)" : "Target: 20%+ (Attention)";
  document.getElementById("kpiDailyAverage").textContent  = formatMoney(summary.daily_average);
  document.getElementById("kpiProjectedMonth").textContent = `Projected: ${formatMoney(summary.projected_month_end)}`;
}

// ─── Charts ─────────────────────────────────────────────────────────────────
function renderCharts(summary) {
  const cc = getChartColors();

  // 1. 7-Day Trend Bar Chart
  const trendCtx  = document.getElementById("trendChart").getContext("2d");
  const trendData = summary.seven_day_trend || [];
  if (trendChartInstance) trendChartInstance.destroy();

  trendChartInstance = new Chart(trendCtx, {
    type: "bar",
    data: {
      labels:   trendData.map(d => d.label),
      datasets: [{
        label:           "Daily Spend",
        data:            trendData.map(d => d.amount),
        backgroundColor: trendData.map((_, i) =>
          i === trendData.length - 1 ? "#3b82f6" : "rgba(59,130,246,0.45)"
        ),
        borderRadius:    8,
        borderSkipped:   false,
        maxBarThickness: 38,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Spent: ${formatMoney(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.text, font: { family: "Inter", size: 11 } } },
        y: { grid: { color: cc.grid }, ticks: { color: cc.text, font: { family: "Inter", size: 11 }, callback: val => "₹" + val } },
      },
    },
  });

  // 2. Category Doughnut
  const catCtx  = document.getElementById("categoryChart").getContext("2d");
  const byCategory   = summary.by_category || {};
  const catLabels    = Object.keys(byCategory).filter(k => byCategory[k] > 0);
  const catValues    = catLabels.map(k => byCategory[k]);
  const catColors    = catLabels.map(k => CATEGORY_COLORS[k] || "#64748b");
  const isDark       = document.documentElement.getAttribute("data-theme") === "dark";

  document.getElementById("activeCategoryCount").textContent = `${catLabels.length} Active Lines`;
  if (categoryChartInstance) categoryChartInstance.destroy();

  categoryChartInstance = new Chart(catCtx, {
    type: catValues.length ? "doughnut" : "doughnut",
    data: {
      labels: catValues.length ? catLabels : ["No expenses"],
      datasets: [{
        data:            catValues.length ? catValues : [1],
        backgroundColor: catValues.length ? catColors : ["rgba(148,163,184,0.2)"],
        borderWidth:     2,
        borderColor:     isDark ? "#131b2e" : "#ffffff",
        hoverOffset:     6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { color: cc.text, font: { family: "Inter", size: 11 }, boxWidth: 10, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatMoney(ctx.raw)}` } },
      },
    },
  });
}

function renderMonthlyTrend(summary) {
  const cc           = getChartColors();
  const monthCtx     = document.getElementById("monthlyTrendChart").getContext("2d");
  const monthlyData  = summary.monthly_trend || [];

  if (monthlyChartInstance) monthlyChartInstance.destroy();

  const amounts = monthlyData.map(m => m.amount);
  const maxAmt  = Math.max(...amounts, 1);

  monthlyChartInstance = new Chart(monthCtx, {
    type: "line",
    data: {
      labels:   monthlyData.map(m => m.label),
      datasets: [{
        label:           "Monthly Spending",
        data:            amounts,
        borderColor:     "#8b5cf6",
        backgroundColor: "rgba(139,92,246,0.12)",
        borderWidth:     2.5,
        pointBackgroundColor: amounts.map((v, i) =>
          i === amounts.length - 1 ? "#8b5cf6" : "rgba(139,92,246,0.6)"
        ),
        pointRadius:     5,
        pointHoverRadius: 7,
        fill:            true,
        tension:         0.4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Monthly: ${formatMoney(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.text, font: { family: "Inter", size: 11 } } },
        y: {
          grid:  { color: cc.grid },
          ticks: { color: cc.text, font: { family: "Inter", size: 11 }, callback: val => "₹" + (val >= 1000 ? (val / 1000).toFixed(0) + "k" : val) },
          suggestedMax: maxAmt * 1.2,
        },
      },
    },
  });
}

// ─── Category Runway ─────────────────────────────────────────────────────────
function renderCategoryRunway(byCategory) {
  const grid = document.getElementById("categoryBarsGrid");
  grid.innerHTML = "";

  Object.keys(CATEGORY_BENCHMARKS).forEach(cat => {
    const spent     = byCategory[cat] || 0;
    const benchmark = CATEGORY_BENCHMARKS[cat];
    const pct       = Math.min(100, Math.round((spent / benchmark) * 100));
    const status    = spent > benchmark ? "over" : spent > benchmark * 0.75 ? "watch" : "safe";
    const statusTxt = status === "over" ? "Exceeded" : status === "watch" ? "Watching" : "On Track";

    const item = document.createElement("div");
    item.className = "cat-bar-item";
    item.innerHTML = `
      <div class="cat-bar-header">
        <span class="cat-name-tag">
          <span style="color:${CATEGORY_COLORS[cat] || '#3b82f6'}">●</span> ${cat}
        </span>
        <span class="cat-status-pill ${status}">${statusTxt} &middot; ${pct}%</span>
      </div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill ${status}" style="width:${pct}%"></div>
      </div>
      <div class="cat-bar-footer">
        <span>${formatMoney(spent)} spent</span>
        <span>Benchmark: ${formatMoney(benchmark)}</span>
      </div>
    `;
    grid.appendChild(item);
  });
}

// ─── AI Recommendations ───────────────────────────────────────────────────────
function renderAIRecommendations(ai) {
  document.getElementById("aiEngineLabel").textContent      = ai.engine || "Financial Engine";
  document.getElementById("drawerEngineStatus").textContent = `Powered by ${ai.engine || "PocketSmart Engine"}`;
  document.getElementById("aiHeadline").textContent         = ai.headline || "Personalized Financial Guidance";
  document.getElementById("aiSummaryText").textContent      = ai.summary_text || "Analysis complete.";

  const patternEl = document.getElementById("aiSpendingPattern");
  if (ai.spending_pattern) {
    patternEl.textContent = "💡 " + ai.spending_pattern;
  } else {
    patternEl.textContent = "";
  }

  const container = document.getElementById("recoContainer");
  container.innerHTML = "";
  const recos = ai.recommendations || [];
  if (!recos.length) {
    container.innerHTML = '<div class="empty-state">No immediate anomalies detected &mdash; spending looks balanced.</div>';
  } else {
    recos.forEach(r => {
      const card = document.createElement("div");
      card.className = "reco-card";
      card.innerHTML = `
        <div class="reco-head">
          <span class="reco-tag ${r.type || 'habit'}">${r.tag || 'Strategy'}</span>
          ${r.impact ? `<span class="reco-impact">${r.impact}</span>` : ""}
        </div>
        <h4 class="reco-card-title">${escapeHtml(r.title)}</h4>
        <p class="reco-card-body">${escapeHtml(r.body)}</p>
      `;
      container.appendChild(card);
    });
  }

  const tipsStrip = document.getElementById("aiTipsStrip");
  tipsStrip.innerHTML = "";
  (ai.savings_tips || []).forEach(tip => {
    const item = document.createElement("div");
    item.className = "ai-tip-item";
    item.innerHTML = `<span class="tip-bullet">✦</span> <span>${escapeHtml(tip)}</span>`;
    tipsStrip.appendChild(item);
  });
}

// ─── Goals ─────────────────────────────────────────────────────────────────
function renderGoals(goals) {
  const grid = document.getElementById("goalGrid");
  grid.innerHTML = "";

  if (!goals.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No goals set yet. Click "+ New Goal" to start tracking milestones!</div>';
    return;
  }

  goals.forEach(g => {
    const pct  = Math.min(100, Math.round((g.saved / g.target) * 100));
    const togo = Math.max(0, g.target - g.saved);
    const card = document.createElement("div");
    card.className = "goal-card";
    card.innerHTML = `
      <div class="goal-card-top">
        <div>
          <div class="goal-icon-badge">🎯</div>
          <h4 class="goal-name">${escapeHtml(g.name)}</h4>
          <span style="font-size:11px;color:var(--text-muted)">${formatMoney(togo)} to reach target</span>
        </div>
        <div class="goal-actions">
          <button class="action-icon-btn delete-goal-btn" data-id="${g.id}" title="Delete goal">&times;</button>
        </div>
      </div>
      <div class="goal-progress-wrap">
        <div class="goal-numbers">
          <span class="goal-saved">${formatMoney(g.saved)}</span>
          <span class="goal-target">of ${formatMoney(g.target)} (${pct}%)</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="goal-btn-row">
        <button class="deposit-btn" data-id="${g.id}" data-name="${escapeHtml(g.name)}">+ Add Deposit</button>
      </div>
    `;
    grid.appendChild(card);
  });

  document.querySelectorAll(".delete-goal-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this savings goal?")) return;
      await fetch(`/api/goals/${btn.dataset.id}`, { method: "DELETE", headers: getAuthHeaders() });
      showToast("Goal removed", "info");
      loadAll();
    });
  });

  document.querySelectorAll(".deposit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("depositGoalId").value           = btn.dataset.id;
      document.getElementById("depositModalTitle").textContent = `Deposit to ${btn.dataset.name}`;
      document.getElementById("depositAmount").value           = "";
      document.getElementById("depositModalBackdrop").classList.add("open");
    });
  });
}

// ─── Transactions ──────────────────────────────────────────────────────────
function renderTransactions() {
  const search    = document.getElementById("txSearch").value.toLowerCase().trim();
  const catFilter = document.getElementById("txCategoryFilter").value;
  const sortOrder = document.getElementById("txSortOrder").value;
  const monthFilt = document.getElementById("txMonthFilter").value;

  let filtered = allExpenses.filter(e => {
    const matchSearch = !search || e.title.toLowerCase().includes(search) || (e.note || "").toLowerCase().includes(search);
    const matchCat    = !catFilter || e.category === catFilter;
    const matchMonth  = !monthFilt || e.date.startsWith(monthFilt);
    return matchSearch && matchCat && matchMonth;
  });

  filtered.sort((a, b) => {
    if (sortOrder === "date_asc")    return a.date.localeCompare(b.date);
    if (sortOrder === "amount_desc") return b.amount - a.amount;
    if (sortOrder === "amount_asc")  return a.amount - b.amount;
    return b.date.localeCompare(a.date);
  });

  const sumTotal = filtered.reduce((acc, e) => acc + e.amount, 0);
  document.getElementById("filteredTxCount").textContent = `${filtered.length} transactions`;
  document.getElementById("filteredTxSum").textContent   = `${formatMoney(sumTotal)} total`;

  const table = document.getElementById("txTable");
  table.innerHTML = "";

  if (!filtered.length) {
    table.innerHTML = '<div class="empty-state">No matching transactions found.</div>';
    return;
  }

  filtered.forEach(e => {
    const d         = new Date(e.date + "T00:00:00");
    const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const row       = document.createElement("div");
    row.className   = "tx-row";
    row.innerHTML = `
      <div class="tx-left">
        <span class="tx-date-badge">${dateLabel}</span>
        <div class="tx-details">
          <span class="tx-title">${escapeHtml(e.title)}</span>
          ${e.note ? `<span class="tx-note">${escapeHtml(e.note)}</span>` : ""}
        </div>
      </div>
      <span class="tx-cat-badge" style="border-color:${CATEGORY_COLORS[e.category] || 'var(--border)'}">
        ${e.category}
      </span>
      <span class="tx-amount">${formatMoney(e.amount)}</span>
      <button class="tx-delete-btn" data-id="${e.id}" title="Delete transaction">&times;</button>
    `;
    table.appendChild(row);
  });

  document.querySelectorAll(".tx-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/expenses/${btn.dataset.id}`, { method: "DELETE", headers: getAuthHeaders() });
      showToast("Transaction deleted", "info");
      loadAll();
    });
  });
}

// ─── OCR Receipt Scanner ─────────────────────────────────────────────────────
function setupOcrScanner() {
  const fileInput    = document.getElementById("receiptFileInput");
  const uploadArea   = document.getElementById("ocrUploadArea");
  const previewArea  = document.getElementById("ocrPreviewArea");
  const resultForm   = document.getElementById("ocrResultForm");
  const previewImg   = document.getElementById("ocrPreviewImg");
  const statusText   = document.getElementById("ocrStatusText");
  const ocrStatusDiv = document.getElementById("ocrStatus");

  function resetOcr() {
    uploadArea.style.display  = "block";
    previewArea.style.display = "none";
    resultForm.style.display  = "none";
    fileInput.value           = "";
  }

  document.getElementById("ocrRescanBtn").addEventListener("click", resetOcr);
  document.getElementById("scanReceiptBtn").addEventListener("click", () => {
    resetOcr();
    document.getElementById("ocrModalBackdrop").classList.add("open");
  });
  document.getElementById("closeOcrModal").addEventListener("click", () => {
    document.getElementById("ocrModalBackdrop").classList.remove("open");
  });
  document.getElementById("ocrModalBackdrop").addEventListener("click", e => {
    if (e.target === document.getElementById("ocrModalBackdrop")) {
      document.getElementById("ocrModalBackdrop").classList.remove("open");
    }
  });

  // Drag & Drop
  uploadArea.addEventListener("dragover", e => { e.preventDefault(); uploadArea.style.borderColor = "var(--accent-ai)"; });
  uploadArea.addEventListener("dragleave", ()  => { uploadArea.style.borderColor = ""; });
  uploadArea.addEventListener("drop", e => {
    e.preventDefault();
    uploadArea.style.borderColor = "";
    const file = e.dataTransfer.files[0];
    if (file) processReceiptFile(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) processReceiptFile(file);
  });

  async function processReceiptFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      showToast("Image too large. Max 10MB.", "danger");
      return;
    }

    uploadArea.style.display  = "none";
    previewArea.style.display = "block";
    resultForm.style.display  = "none";
    ocrStatusDiv.style.display = "block";
    statusText.textContent    = "Extracting data with AI...";

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl   = ev.target.result;
      previewImg.src  = dataUrl;

      const base64   = dataUrl.split(",")[1];
      const mimeType = file.type || "image/jpeg";

      try {
        const res  = await fetch("/api/ocr/receipt", {
          method:  "POST",
          headers: getAuthHeaders(),
          body:    JSON.stringify({ image_b64: base64, mime_type: mimeType }),
        });
        const data = await res.json();

        if (!res.ok) {
          statusText.textContent = data.error || "OCR failed";
          return;
        }

        // Populate result form
        document.getElementById("ocrTitle").value    = data.title    || "";
        document.getElementById("ocrAmount").value   = data.amount   || "";
        document.getElementById("ocrNote").value     = data.note     || "";
        document.getElementById("ocrDate").value     = data.date     || formatLocalDate();

        const catSel = document.getElementById("ocrCategory");
        for (let opt of catSel.options) {
          if (opt.value === data.category) { opt.selected = true; break; }
        }

        ocrStatusDiv.style.display = "none";
        resultForm.style.display   = "block";
      } catch (err) {
        statusText.textContent = "OCR request failed. Check your API key.";
      }
    };
    reader.readAsDataURL(file);
  }

  document.getElementById("ocrSaveBtn").addEventListener("click", async () => {
    const payload = {
      title:    document.getElementById("ocrTitle").value.trim(),
      amount:   document.getElementById("ocrAmount").value,
      category: document.getElementById("ocrCategory").value,
      date:     document.getElementById("ocrDate").value,
      note:     document.getElementById("ocrNote").value.trim(),
    };

    if (!payload.title || !payload.amount) {
      showToast("Please fill in required fields", "danger");
      return;
    }

    const res = await fetch("/api/expenses", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify(payload),
    });

    if (res.ok) {
      document.getElementById("ocrModalBackdrop").classList.remove("open");
      showToast("Receipt expense saved!", "success");
      loadAll();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to save expense", "danger");
    }
  });
}

// ─── CSV Export ────────────────────────────────────────────────────────────
function setupExport() {
  document.getElementById("exportBtn").addEventListener("click", () => {
    const url = "/api/export/csv";
    triggerDownload(url);
  });

  document.getElementById("exportMonthBtn").addEventListener("click", () => {
    const month = document.getElementById("txMonthFilter").value;
    const url   = month ? `/api/export/csv?month=${month}` : "/api/export/csv";
    triggerDownload(url);
    showToast(month ? `Exporting ${month} transactions...` : "Exporting all transactions...", "info");
  });

  function triggerDownload(url) {
    // Use fetch + blob to include auth token
    fetch(url, { headers: getAuthHeaders() })
      .then(res => {
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
      })
      .then(blob => {
        const a    = document.createElement("a");
        a.href     = URL.createObjectURL(blob);
        a.download = url.includes("month=") ? `expenses_${url.split("month=")[1]}.csv` : "pocketsmart_expenses.csv";
        a.click();
        URL.revokeObjectURL(a.href);
        showToast("CSV exported successfully!", "success");
      })
      .catch(() => showToast("Export failed", "danger"));
  }
}

// ─── AI Advisor Chat ───────────────────────────────────────────────────────
async function handleAiQuestion(question) {
  if (!question) return;
  const chatContainer = document.getElementById("aiChatMessages");

  const userMsg = document.createElement("div");
  userMsg.className = "chat-msg user-msg";
  userMsg.innerHTML = `<div class="chat-bubble"><p>${escapeHtml(question)}</p></div>`;
  chatContainer.appendChild(userMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const aiLoading = document.createElement("div");
  aiLoading.className = "chat-msg ai-msg";
  aiLoading.id = "aiLoadingMsg";
  aiLoading.innerHTML = `
    <div class="chat-avatar">✦</div>
    <div class="chat-bubble"><p><em>Analyzing your financial snapshot...</em></p></div>
  `;
  chatContainer.appendChild(aiLoading);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res  = await fetch("/api/ai-advisor", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify({ question }),
    });
    const data = await res.json();
    aiLoading.remove();

    const aiMsg = document.createElement("div");
    aiMsg.className = "chat-msg ai-msg";
    aiMsg.innerHTML = `
      <div class="chat-avatar">✦</div>
      <div class="chat-bubble">
        <p><strong>${escapeHtml(data.headline || "Advisor Response")}</strong></p>
        <p>${escapeHtml(data.advisor_reply || data.summary_text || "Advice generated successfully.")}</p>
        ${data.spending_pattern ? `<p style="font-style:italic;color:var(--text-muted);margin-top:6px;">💡 ${escapeHtml(data.spending_pattern)}</p>` : ""}
        ${data.recommendations?.length
          ? `<div style="margin-top:8px;font-size:12px;border-top:1px dashed var(--border);padding-top:6px;">
               <strong>Key Action:</strong> ${escapeHtml(data.recommendations[0].title)} &mdash; <em>${escapeHtml(data.recommendations[0].impact || "")}</em>
             </div>`
          : ""}
      </div>
    `;
    chatContainer.appendChild(aiMsg);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  } catch {
    aiLoading.remove();
    const errMsg = document.createElement("div");
    errMsg.className = "chat-msg ai-msg";
    errMsg.innerHTML = `
      <div class="chat-avatar">✦</div>
      <div class="chat-bubble"><p style="color:var(--danger)">Unable to process question. Please try again.</p></div>
    `;
    chatContainer.appendChild(errMsg);
  }
}

// ─── Event Listeners Setup ─────────────────────────────────────────────────
function setupEventListeners() {
  // User Menu
  const userMenuBtn  = document.getElementById("userMenuBtn");
  const userDropdown = document.getElementById("userDropdown");
  userMenuBtn.addEventListener("click", e => {
    e.stopPropagation();
    userDropdown.classList.toggle("open");
  });
  document.addEventListener("click", () => userDropdown.classList.remove("open"));

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: getAuthHeaders() });
    saveAuthState(null, null);
    showToast("Signed out", "info");
    showAuthScreen();
  });

  // Preset Data
  document.getElementById("presetDataBtn").addEventListener("click", async () => {
    const btn = document.getElementById("presetDataBtn");
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Loading...';
    try {
      const res  = await fetch("/api/preset-data", { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      showToast(data.message || "Preset demo data loaded!", "success");
      await loadAll();
    } catch { showToast("Failed to load preset data", "danger"); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">⚡</span> Preset Demo';
    }
  });

  // Add Expense Modal
  const expenseModal = document.getElementById("modalBackdrop");
  document.getElementById("addExpenseBtn").addEventListener("click", () => {
    document.getElementById("date").value = formatLocalDate();
    expenseModal.classList.add("open");
  });
  document.getElementById("closeExpenseModal").addEventListener("click", () => expenseModal.classList.remove("open"));
  document.getElementById("cancelExpenseModal").addEventListener("click", () => expenseModal.classList.remove("open"));
  expenseModal.addEventListener("click", e => { if (e.target === expenseModal) expenseModal.classList.remove("open"); });

  document.getElementById("expenseModalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      title:    document.getElementById("title").value.trim(),
      amount:   document.getElementById("amount").value,
      category: document.getElementById("category").value,
      date:     document.getElementById("date").value,
      note:     document.getElementById("note").value.trim(),
    };
    const res = await fetch("/api/expenses", {
      method: "POST", headers: getAuthHeaders(), body: JSON.stringify(payload),
    });
    if (res.ok) {
      e.target.reset();
      expenseModal.classList.remove("open");
      showToast("Expense recorded successfully!", "success");
      loadAll();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to add expense", "danger");
    }
  });

  // Budget Modal
  const budgetModal = document.getElementById("budgetModalBackdrop");
  document.getElementById("editBudgetBtn").addEventListener("click", () => {
    if (currentSummary) document.getElementById("monthlyBudgetInput").value = currentSummary.monthly_limit || 40000;
    budgetModal.classList.add("open");
  });
  document.getElementById("closeBudgetModal").addEventListener("click",   () => budgetModal.classList.remove("open"));
  document.getElementById("cancelBudgetModal").addEventListener("click",  () => budgetModal.classList.remove("open"));
  budgetModal.addEventListener("click", e => { if (e.target === budgetModal) budgetModal.classList.remove("open"); });
  document.getElementById("budgetModalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/budget", {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({ monthly_limit: document.getElementById("monthlyBudgetInput").value }),
    });
    if (res.ok) {
      budgetModal.classList.remove("open");
      showToast("Monthly budget updated!", "success");
      loadAll();
    } else showToast("Invalid budget amount", "danger");
  });

  // Goal Modal
  const goalModal = document.getElementById("goalModalBackdrop");
  document.getElementById("addGoalBtn").addEventListener("click",    () => goalModal.classList.add("open"));
  document.getElementById("closeGoalModal").addEventListener("click",  () => goalModal.classList.remove("open"));
  document.getElementById("cancelGoalModal").addEventListener("click", () => goalModal.classList.remove("open"));
  goalModal.addEventListener("click", e => { if (e.target === goalModal) goalModal.classList.remove("open"); });
  document.getElementById("goalModalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/goals", {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({
        name:   document.getElementById("goalName").value.trim(),
        target: document.getElementById("goalTarget").value,
        saved:  document.getElementById("goalSaved").value || 0,
      }),
    });
    if (res.ok) {
      e.target.reset();
      goalModal.classList.remove("open");
      showToast("New savings goal created!", "success");
      loadAll();
    } else showToast("Failed to create goal", "danger");
  });

  // Deposit Modal
  const depositModal = document.getElementById("depositModalBackdrop");
  document.getElementById("closeDepositModal").addEventListener("click",  () => depositModal.classList.remove("open"));
  document.getElementById("cancelDepositModal").addEventListener("click", () => depositModal.classList.remove("open"));
  depositModal.addEventListener("click", e => { if (e.target === depositModal) depositModal.classList.remove("open"); });
  document.getElementById("depositModalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch(`/api/goals/${document.getElementById("depositGoalId").value}/deposit`, {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({ amount: document.getElementById("depositAmount").value }),
    });
    if (res.ok) {
      depositModal.classList.remove("open");
      showToast("Funds deposited to goal!", "success");
      loadAll();
    } else showToast("Failed to deposit funds", "danger");
  });

  // AI Drawer
  const aiDrawer = document.getElementById("aiDrawerBackdrop");
  const openAi   = () => aiDrawer.classList.add("open");
  const closeAi  = () => aiDrawer.classList.remove("open");
  document.getElementById("aiAdvisorBtn").addEventListener("click",   openAi);
  document.getElementById("openAiDrawerBtn").addEventListener("click", openAi);
  document.getElementById("closeAiDrawer").addEventListener("click",   closeAi);
  aiDrawer.addEventListener("click", e => { if (e.target === aiDrawer) closeAi(); });

  document.getElementById("refreshAiBtn").addEventListener("click", async () => {
    showToast("Re-analyzing with AI...", "info");
    const res    = await fetch("/api/ai-recommendations", { headers: getAuthHeaders() });
    const aiData = await res.json();
    renderAIRecommendations(aiData);
    showToast("AI Recommendations updated!", "success");
  });

  document.getElementById("aiChatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("aiQuestionInput");
    const q     = input.value.trim();
    if (!q) return;
    input.value = "";
    handleAiQuestion(q);
  });

  document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => handleAiQuestion(chip.dataset.prompt));
  });

  // Gemini Key
  const keyInput = document.getElementById("geminiApiKeyInput");
  keyInput.value = localStorage.getItem("pocketsmart_gemini_key") || "";
  document.getElementById("saveApiKeyBtn").addEventListener("click", () => {
    const key = keyInput.value.trim();
    if (key) {
      localStorage.setItem("pocketsmart_gemini_key", key);
      showToast("Gemini API Key saved! AI & OCR enabled.", "success");
    } else {
      localStorage.removeItem("pocketsmart_gemini_key");
      showToast("Reverted to Built-in Financial Rules Engine", "info");
    }
  });

  // Filters
  document.getElementById("txSearch").addEventListener("input",          renderTransactions);
  document.getElementById("txCategoryFilter").addEventListener("change", renderTransactions);
  document.getElementById("txSortOrder").addEventListener("change",      renderTransactions);
  document.getElementById("txMonthFilter").addEventListener("change",    renderTransactions);
}

// ─── Application Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupAuthListeners();
  setupEventListeners();
  setupOcrScanner();
  setupExport();

  // Check if already logged in
  if (loadAuthState()) {
    // Verify token is still valid
    fetch("/api/auth/me", { headers: getAuthHeaders() })
      .then(r => {
        if (r.ok) {
          showAppShell();
        } else {
          saveAuthState(null, null);
          showAuthScreen();
        }
      })
      .catch(() => showAuthScreen());
  } else {
    showAuthScreen();
  }
});
