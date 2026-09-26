# PocketSmart AI v2.0

An AI-powered personal finance tracker with multi-user authentication, receipt OCR, advanced dashboards, and production-grade security.

## ✨ What's New in v2.0

### 🔐 User Authentication & Accounts
- **JWT-based auth** — stateless tokens (7-day expiry) stored in `localStorage` + `HttpOnly` cookies
- **Multi-user isolation** — each user's expenses, goals, and budget are fully separate
- **Secure password hashing** — PBKDF2-HMAC-SHA256 with 260,000 iterations + random salt
- Register / Login / Logout flow with clean auth screen

### 🤖 Enhanced AI Insights
- **Receipt OCR** — scan any receipt image via Gemini Vision API; auto-populates title, amount, category, date, and note
- **Spending habit analysis** — Gemini 2.5 Flash detects patterns, recurring subscriptions, and behavioral tendencies
- **Richer AI prompts** — includes 6-month spending trend for deeper context
- `spending_pattern` field surfaces in the dashboard and advisor chat

### 📊 Advanced Visualizations & Reporting
- **6-Month Monthly Trend Chart** — interactive line chart powered by Chart.js
- **Month filter** — filter transactions by month in the table
- **CSV Export** — download all or month-specific expenses (auth-aware)
- Existing: 7-Day bar chart, Category doughnut, Category runway bars

### 🛡️ Infrastructure & Security
- **PostgreSQL support** — set `DATABASE_URL` env var; falls back to SQLite automatically
- **Rate limiting** — sliding-window in-memory limiter (60 req/min general; 10/min for OCR; 20/min for auth)
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- `PUT /api/expenses/<id>` — edit existing transactions

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt

# Optional: for PostgreSQL support
pip install psycopg2-binary
```

### 2. Configure (optional)
```bash
# Use PostgreSQL instead of SQLite
export DATABASE_URL="postgresql://user:password@localhost/pocketsmart"

# Pre-set a Gemini API key (or enter it in the UI)
export GEMINI_API_KEY="your-key-here"

# Custom JWT secret (recommended for production)
export SECRET_KEY="your-random-secret"
```

### 3. Run
```bash
python app.py
```

### 4. Open browser
[http://localhost:5000](http://localhost:5000)

**First run:** Register an account, then click ⚡ **Preset Demo Data** to load realistic transactions.

---

## 📁 Project Structure

```
app.py                  # Flask backend — auth, expenses, AI, OCR, export
templates/index.html    # Full single-page app template
static/app.js           # Frontend engine — auth flow, charts, OCR, export
static/style.css        # Design system — dark/light theme, all components
requirements.txt
spend_guide.db          # SQLite DB (auto-created; ignored if DATABASE_URL set)
```

---

## 🔗 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account `{username, email, password}` |
| POST | `/api/auth/login` | Login `{username/email, password}` → JWT |
| POST | `/api/auth/logout` | Clear session cookie |
| GET  | `/api/auth/me` | Current user info |

### Expenses (require `Authorization: Bearer <token>`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/expenses` | List expenses (filter: `search`, `category`, `month`, `sort`) |
| POST   | `/api/expenses` | Add expense `{title, amount, category, date, note}` |
| PUT    | `/api/expenses/<id>` | Edit expense |
| DELETE | `/api/expenses/<id>` | Delete expense |

### Analytics & Budget
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/summary` | Full dashboard summary + monthly trend |
| POST | `/api/budget` | Set monthly limit `{monthly_limit}` |

### Goals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/goals` | List goals |
| POST   | `/api/goals` | Create goal `{name, target, saved}` |
| DELETE | `/api/goals/<id>` | Delete goal |
| POST   | `/api/goals/<id>/deposit` | Add funds `{amount}` |

### AI & OCR
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/ai-recommendations` | AI insights (Gemini or rules engine) |
| POST | `/api/ai-advisor` | Chat `{question}` |
| POST | `/api/ocr/receipt` | Scan receipt `{image_b64, mime_type}` — requires Gemini key |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export/csv` | Download CSV (`?month=YYYY-MM` optional) |
| POST | `/api/preset-data` | Load demo transactions & goals |

---

## 🔑 Gemini API Key

Enter your key in the **AI Advisor** drawer (⚙️ section) — it's saved to `localStorage` and sent as `x-gemini-api-key` header. Enables:
- **Gemini 2.5 Flash** AI financial advice
- **Receipt OCR** via Gemini Vision

Without a key, the built-in rules engine handles all AI features.

---

## 🏗️ Production Tips

- Set `SECRET_KEY` environment variable to a random 32+ byte hex string
- Use `DATABASE_URL` with PostgreSQL + connection pooling (e.g., PgBouncer)
- Run behind a reverse proxy (Nginx/Caddy) with HTTPS
- Consider Redis for distributed rate limiting in multi-worker deployments
