"""
PocketSmart AI - Enhanced Backend
Features:
  - Multi-user auth with JWT (register/login/logout)
  - PostgreSQL support with SQLite fallback
  - Receipt OCR via Gemini Vision API
  - AI spending habit analysis
  - Rate limiting & security middleware
  - Monthly trend data for advanced charts
  - CSV export endpoint
"""

from flask import Flask, request, jsonify, render_template, make_response, g
import sqlite3
import os
import json
import io
import csv
import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta
from functools import wraps

# ─── Optional PostgreSQL (psycopg2) ──────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False

# ─── App Setup ────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "spend_guide.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "")   # PostgreSQL connection string

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)

app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secrets.token_hex(32))
JWT_EXPIRY_HOURS = 24 * 7   # 7-day token validity

# ─── Constants ────────────────────────────────────────────────────────────────
CATEGORIES = ["Food", "Transport", "Shopping", "Bills", "Entertainment", "Health", "Other"]

CATEGORY_BUDGET_BENCHMARKS = {
    "Food":          10000,
    "Transport":      4000,
    "Shopping":       6000,
    "Bills":         12000,
    "Entertainment":  3500,
    "Health":         3500,
    "Other":          3000,
}

# ─── Rate Limiter (simple in-memory, per-IP sliding window) ───────────────────
_rate_store: dict = {}   # ip -> list[timestamp]

def _rate_limit(max_calls: int = 60, window_sec: int = 60):
    """Decorator: allow max_calls per window_sec per remote IP."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            ip = request.remote_addr or "unknown"
            now = time.time()
            calls = [t for t in _rate_store.get(ip, []) if now - t < window_sec]
            if len(calls) >= max_calls:
                return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
            calls.append(now)
            _rate_store[ip] = calls
            return fn(*args, **kwargs)
        return wrapper
    return decorator

# ─── Security Headers Middleware ──────────────────────────────────────────────
@app.after_request
def add_security_headers(resp):
    resp.headers["X-Content-Type-Options"]  = "nosniff"
    resp.headers["X-Frame-Options"]         = "SAMEORIGIN"
    resp.headers["X-XSS-Protection"]        = "1; mode=block"
    resp.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"]      = "geolocation=(), microphone=()"
    return resp

# ─── JWT Helpers ──────────────────────────────────────────────────────────────
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)

def _create_jwt(payload: dict) -> str:
    header  = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body    = _b64url_encode(json.dumps(payload).encode())
    sig_input = f"{header}.{body}".encode()
    sig = hmac.new(app.config["SECRET_KEY"].encode(), sig_input, hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url_encode(sig)}"

def _verify_jwt(token: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, body, sig = parts
        sig_input = f"{header}.{body}".encode()
        expected_sig = hmac.new(app.config["SECRET_KEY"].encode(), sig_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sig), expected_sig):
            return None
        payload = json.loads(_b64url_decode(body))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
    return f"{salt}:{h.hex()}"

def _check_password(password: str, stored: str) -> bool:
    try:
        salt, h_hex = stored.split(":", 1)
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
        return hmac.compare_digest(h.hex(), h_hex)
    except Exception:
        return False

# ─── Auth Decorator ───────────────────────────────────────────────────────────
def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if not token:
            token = request.cookies.get("ps_token")
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        payload = _verify_jwt(token)
        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401
        g.user_id   = payload["sub"]
        g.username  = payload.get("username", "")
        return fn(*args, **kwargs)
    return wrapper

# ─── Database Abstraction ─────────────────────────────────────────────────────
def _use_postgres() -> bool:
    return POSTGRES_AVAILABLE and bool(DATABASE_URL)

def get_db():
    if _use_postgres():
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _exec(conn, sql: str, params=()):
    """Execute helper normalizing ? (SQLite) vs %s (PostgreSQL)."""
    if _use_postgres():
        sql = sql.replace("?", "%s")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur
    return conn.execute(sql, params)

def _fetchall(cur) -> list[dict]:
    rows = cur.fetchall()
    if _use_postgres():
        return [dict(r) for r in rows]
    return [dict(r) for r in rows]

def _fetchone(cur):
    row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


def init_db():
    conn = get_db()
    if _use_postgres():
        serial_pk = "SERIAL PRIMARY KEY"
        text_pk   = "TEXT NOT NULL UNIQUE"
        autoincrement = ""
    else:
        serial_pk = "INTEGER PRIMARY KEY AUTOINCREMENT"
        text_pk   = "TEXT NOT NULL UNIQUE"
        autoincrement = ""

    statements = [
        f"""CREATE TABLE IF NOT EXISTS users (
            id {serial_pk},
            username {text_pk},
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS expenses (
            id {serial_pk},
            user_id INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            note TEXT,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            receipt_text TEXT
        )""",
        f"""CREATE TABLE IF NOT EXISTS budget (
            id INTEGER PRIMARY KEY {"" if _use_postgres() else "CHECK (id = 1)"},
            user_id INTEGER NOT NULL DEFAULT 1,
            monthly_limit REAL NOT NULL DEFAULT 40000,
            UNIQUE(user_id)
        )""",
        f"""CREATE TABLE IF NOT EXISTS goals (
            id {serial_pk},
            user_id INTEGER NOT NULL DEFAULT 1,
            name TEXT NOT NULL,
            saved REAL NOT NULL DEFAULT 0,
            target REAL NOT NULL
        )""",
    ]

    for stmt in statements:
        _exec(conn, stmt)

    # Ensure default budget row for user 1
    _exec(conn, "INSERT OR IGNORE INTO budget (id, user_id, monthly_limit) VALUES (1, 1, 40000)")

    # Seed default goals for user 1 if empty
    cur = _exec(conn, "SELECT COUNT(*) as cnt FROM goals WHERE user_id = 1")
    row = _fetchone(cur)
    count = row["cnt"] if row else 0
    if count == 0:
        default_goals = [
            (1, "Emergency Fund", 35000, 100000),
            (1, "Rainy Day Stash", 15000, 50000),
            (1, "Holiday Getaway", 18500, 45000),
        ]
        for g_row in default_goals:
            _exec(conn, "INSERT OR IGNORE INTO goals (user_id, name, saved, target) VALUES (?, ?, ?, ?)", g_row)

    conn.commit()
    conn.close()


init_db()


# ─── Helper: get current user_id ─────────────────────────────────────────────
def _uid() -> int:
    """Return the authenticated user's ID, or 1 for legacy/guest access."""
    return getattr(g, "user_id", 1)


# ════════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html", categories=CATEGORIES)


@app.route("/api/auth/register", methods=["POST"])
@_rate_limit(max_calls=10, window_sec=60)
def register():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not username or not email or not password:
        return jsonify({"error": "Username, email and password are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if "@" not in email:
        return jsonify({"error": "Invalid email address"}), 400

    pw_hash = _hash_password(password)
    conn = get_db()
    try:
        cur = _exec(
            conn,
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (username, email, pw_hash, datetime.now().isoformat()),
        )
        if _use_postgres():
            cur.execute("SELECT lastval()")
            new_id = cur.fetchone()[0]
        else:
            new_id = cur.lastrowid

        # Create default budget for new user
        _exec(conn, "INSERT OR IGNORE INTO budget (user_id, monthly_limit) VALUES (?, 40000)", (new_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"error": "Username or email already exists"}), 409
    conn.close()

    payload = {"sub": new_id, "username": username, "exp": int(time.time()) + JWT_EXPIRY_HOURS * 3600}
    token = _create_jwt(payload)
    resp = jsonify({"ok": True, "token": token, "username": username, "user_id": new_id})
    resp.set_cookie("ps_token", token, httponly=True, samesite="Lax", max_age=JWT_EXPIRY_HOURS * 3600)
    return resp, 201


@app.route("/api/auth/login", methods=["POST"])
@_rate_limit(max_calls=20, window_sec=60)
def login():
    data = request.get_json(force=True, silent=True) or {}
    identifier = (data.get("username") or data.get("email") or "").strip()
    password   = (data.get("password") or "").strip()

    if not identifier or not password:
        return jsonify({"error": "Credentials required"}), 400

    conn = get_db()
    cur = _exec(conn, "SELECT * FROM users WHERE username = ? OR email = ?", (identifier, identifier))
    user = _fetchone(cur)
    conn.close()

    if not user or not _check_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid credentials"}), 401

    payload = {
        "sub": user["id"],
        "username": user["username"],
        "exp": int(time.time()) + JWT_EXPIRY_HOURS * 3600,
    }
    token = _create_jwt(payload)
    resp = jsonify({"ok": True, "token": token, "username": user["username"], "user_id": user["id"]})
    resp.set_cookie("ps_token", token, httponly=True, samesite="Lax", max_age=JWT_EXPIRY_HOURS * 3600)
    return resp


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    resp = jsonify({"ok": True})
    resp.delete_cookie("ps_token")
    return resp


@app.route("/api/auth/me", methods=["GET"])
@require_auth
def me():
    return jsonify({"user_id": g.user_id, "username": g.username})


# ════════════════════════════════════════════════════════════════════════════
# EXPENSES
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/expenses", methods=["GET"])
@require_auth
@_rate_limit(max_calls=120, window_sec=60)
def get_expenses():
    conn = get_db()
    search   = (request.args.get("search")   or "").strip().lower()
    category = (request.args.get("category") or "").strip()
    sort     = request.args.get("sort", "date_desc")
    month    = request.args.get("month", "")   # YYYY-MM filter

    query  = "SELECT * FROM expenses WHERE user_id = ?"
    params = [_uid()]

    if category:
        query += " AND category = ?"
        params.append(category)
    if month:
        query += " AND date LIKE ?"
        params.append(f"{month}%")
    if search:
        query += " AND (LOWER(title) LIKE ? OR LOWER(note) LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])

    sort_map = {
        "amount_desc": " ORDER BY amount DESC, date DESC",
        "amount_asc":  " ORDER BY amount ASC,  date DESC",
        "date_asc":    " ORDER BY date ASC,  id ASC",
        "date_desc":   " ORDER BY date DESC, id DESC",
    }
    query += sort_map.get(sort, " ORDER BY date DESC, id DESC")

    rows = _fetchall(_exec(conn, query, params))
    conn.close()
    return jsonify(rows)


@app.route("/api/expenses", methods=["POST"])
@require_auth
@_rate_limit(max_calls=60, window_sec=60)
def add_expense():
    data = request.get_json(force=True, silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"error": "Invalid or missing JSON payload"}), 400

    title    = (data.get("title")    or "").strip()
    amount   = data.get("amount")
    category = data.get("category")  or "Other"
    note     = (data.get("note")     or "").strip()
    date     = data.get("date")      or datetime.now().strftime("%Y-%m-%d")

    if not title:
        return jsonify({"error": "Title is required"}), 400
    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Amount must be a positive number"}), 400

    if category not in CATEGORIES:
        category = "Other"

    conn = get_db()
    cur = _exec(
        conn,
        "INSERT INTO expenses (user_id, title, amount, category, note, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (_uid(), title, amount, category, note, date, datetime.now().isoformat()),
    )
    conn.commit()
    if _use_postgres():
        cur.execute("SELECT lastval()")
        new_id = cur.fetchone()[0]
    else:
        new_id = cur.lastrowid
    row = _fetchone(_exec(conn, "SELECT * FROM expenses WHERE id = ?", (new_id,)))
    conn.close()
    return jsonify(row), 201


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
@require_auth
def delete_expense(expense_id):
    conn = get_db()
    _exec(conn, "DELETE FROM expenses WHERE id = ? AND user_id = ?", (expense_id, _uid()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "deleted_id": expense_id})


@app.route("/api/expenses/<int:expense_id>", methods=["PUT"])
@require_auth
def update_expense(expense_id):
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    row = _fetchone(_exec(conn, "SELECT * FROM expenses WHERE id = ? AND user_id = ?", (expense_id, _uid())))
    if not row:
        conn.close()
        return jsonify({"error": "Expense not found"}), 404

    title    = (data.get("title")    or row["title"]).strip()
    category = data.get("category")  or row["category"]
    note     = (data.get("note")     or row.get("note", "")).strip()
    date     = data.get("date")      or row["date"]
    try:
        amount = float(data.get("amount", row["amount"]))
        if amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        conn.close()
        return jsonify({"error": "Amount must be positive"}), 400

    if category not in CATEGORIES:
        category = "Other"

    _exec(
        conn,
        "UPDATE expenses SET title=?, amount=?, category=?, note=?, date=? WHERE id=? AND user_id=?",
        (title, amount, category, note, date, expense_id, _uid()),
    )
    conn.commit()
    updated = _fetchone(_exec(conn, "SELECT * FROM expenses WHERE id = ?", (expense_id,)))
    conn.close()
    return jsonify(updated)


# ════════════════════════════════════════════════════════════════════════════
# OCR — Receipt Scanning via Gemini Vision
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/ocr/receipt", methods=["POST"])
@require_auth
@_rate_limit(max_calls=10, window_sec=60)
def ocr_receipt():
    """
    Accept a base64-encoded receipt image and return structured expense data.
    Body: { "image_b64": "<base64>", "mime_type": "image/jpeg" }
    """
    data     = request.get_json(force=True, silent=True) or {}
    image_b64 = data.get("image_b64", "")
    mime_type  = data.get("mime_type", "image/jpeg")
    user_key   = request.headers.get("x-gemini-api-key") or os.environ.get("GEMINI_API_KEY", "")

    if not image_b64:
        return jsonify({"error": "No image data provided"}), 400

    if not user_key:
        # Return a fallback stub so UI can still pre-fill manually
        return jsonify({
            "title":    "Receipt (Manual Entry)",
            "amount":   0,
            "category": "Other",
            "note":     "OCR requires a Gemini API key. Please fill in details manually.",
            "date":     datetime.now().strftime("%Y-%m-%d"),
        })

    try:
        from google import genai
        from google.genai import types as genai_types

        client = genai.Client(api_key=user_key)
        prompt = """You are a receipt OCR assistant. Extract the following fields from the receipt image and return ONLY a raw JSON object with these exact keys:
- "title": merchant or store name (string)
- "amount": total amount paid as a number (float, no currency symbol)
- "category": one of [Food, Transport, Shopping, Bills, Entertainment, Health, Other]
- "note": brief description of items purchased (string)
- "date": transaction date in YYYY-MM-DD format, or today if not visible
- "receipt_text": full extracted text from the receipt (string)

Return ONLY the JSON object. No markdown, no explanation."""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                genai_types.Part.from_bytes(
                    data=base64.b64decode(image_b64),
                    mime_type=mime_type,
                ),
                prompt,
            ],
        )

        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())

        # Sanitize
        if parsed.get("category") not in CATEGORIES:
            parsed["category"] = "Other"
        try:
            parsed["amount"] = float(parsed.get("amount", 0))
        except (TypeError, ValueError):
            parsed["amount"] = 0.0

        return jsonify(parsed)

    except Exception as e:
        return jsonify({"error": f"OCR failed: {str(e)}"}), 500


# ════════════════════════════════════════════════════════════════════════════
# SUMMARY & ANALYTICS
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/summary", methods=["GET"])
@require_auth
def summary():
    conn  = get_db()
    uid   = _uid()
    rows  = _fetchall(_exec(conn, "SELECT * FROM expenses WHERE user_id = ? ORDER BY date ASC", (uid,)))
    brow  = _fetchone(_exec(conn, "SELECT monthly_limit FROM budget WHERE user_id = ?", (uid,)))
    conn.close()

    total          = sum(r["amount"] for r in rows)
    current_month  = datetime.now().strftime("%Y-%m")
    month_rows     = [r for r in rows if r["date"].startswith(current_month)]
    month_total    = sum(r["amount"] for r in month_rows)
    monthly_limit  = brow["monthly_limit"] if brow else 40000

    by_category = {c: 0.0 for c in CATEGORIES}
    for r in (month_rows if month_rows else rows):
        by_category[r["category"]] = by_category.get(r["category"], 0.0) + r["amount"]

    # 7-day trend
    today     = datetime.now()
    days_data = []
    for i in range(6, -1, -1):
        day_date  = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        day_label = (today - timedelta(days=i)).strftime("%a")
        day_total = sum(r["amount"] for r in rows if r["date"] == day_date)
        days_data.append({"date": day_date, "label": day_label, "amount": round(day_total, 2)})

    # Monthly trend (last 6 months)
    monthly_trend = []
    for i in range(5, -1, -1):
        mo_date  = (today.replace(day=1) - timedelta(days=i * 30))
        mo_key   = mo_date.strftime("%Y-%m")
        mo_label = mo_date.strftime("%b %Y")
        mo_total = sum(r["amount"] for r in rows if r["date"].startswith(mo_key))
        monthly_trend.append({"month": mo_key, "label": mo_label, "amount": round(mo_total, 2)})

    # Calculations
    day_of_month        = max(1, today.day)
    daily_average       = month_total / day_of_month if month_total > 0 else 0
    projected_month_end = daily_average * 30
    remaining           = monthly_limit - month_total
    savings_rate        = max(0, min(100, ((monthly_limit - month_total) / monthly_limit * 100))) if monthly_limit > 0 else 0

    # Health score
    score = 100
    if monthly_limit > 0:
        ratio = month_total / monthly_limit
        if ratio > 1.0:
            score -= min(40, int((ratio - 1.0) * 80))
        elif ratio > 0.8:
            score -= 15
    over_cats = sum(1 for c, spent in by_category.items() if spent > CATEGORY_BUDGET_BENCHMARKS.get(c, 5000))
    score -= over_cats * 8
    score = max(20, min(98, score))
    health_status = "Optimal" if score >= 80 else ("Stable" if score >= 65 else "Watch Closely")

    return jsonify({
        "total":               round(total, 2),
        "month_total":         round(month_total, 2),
        "by_category":         {k: round(v, 2) for k, v in by_category.items()},
        "monthly_limit":       round(monthly_limit, 2),
        "remaining":           round(remaining, 2),
        "savings_rate":        round(savings_rate, 1),
        "daily_average":       round(daily_average, 2),
        "projected_month_end": round(projected_month_end, 2),
        "health_score":        score,
        "health_status":       health_status,
        "seven_day_trend":     days_data,
        "monthly_trend":       monthly_trend,
        "expense_count":       len(rows),
    })


# ════════════════════════════════════════════════════════════════════════════
# BUDGET
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/budget", methods=["POST"])
@require_auth
def set_budget():
    data = request.get_json(force=True, silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"error": "Invalid or missing JSON payload"}), 400
    try:
        limit = float(data.get("monthly_limit", 0))
        if limit <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Monthly limit must be a positive number"}), 400

    conn = get_db()
    _exec(conn, "UPDATE budget SET monthly_limit = ? WHERE user_id = ?", (limit, _uid()))
    conn.commit()
    conn.close()
    return jsonify({"monthly_limit": limit, "message": "Budget limit updated successfully"})


# ════════════════════════════════════════════════════════════════════════════
# GOALS
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/goals", methods=["GET"])
@require_auth
def get_goals():
    conn  = get_db()
    rows  = _fetchall(_exec(conn, "SELECT * FROM goals WHERE user_id = ? ORDER BY id ASC", (_uid(),)))
    conn.close()
    return jsonify(rows)


@app.route("/api/goals", methods=["POST"])
@require_auth
def add_goal():
    data = request.get_json(force=True, silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON body"}), 400

    name   = (data.get("name")   or "").strip()
    target = data.get("target")
    saved  = data.get("saved", 0)

    if not name:
        return jsonify({"error": "Goal name is required"}), 400
    try:
        target = float(target)
        saved  = float(saved)
        if target <= 0 or saved < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Target must be positive and saved must be non-negative"}), 400

    conn = get_db()
    cur  = _exec(conn, "INSERT INTO goals (user_id, name, saved, target) VALUES (?, ?, ?, ?)", (_uid(), name, saved, target))
    conn.commit()
    if _use_postgres():
        cur.execute("SELECT lastval()")
        new_id = cur.fetchone()[0]
    else:
        new_id = cur.lastrowid
    row = _fetchone(_exec(conn, "SELECT * FROM goals WHERE id = ?", (new_id,)))
    conn.close()
    return jsonify(row), 201


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
@require_auth
def delete_goal(goal_id):
    conn = get_db()
    _exec(conn, "DELETE FROM goals WHERE id = ? AND user_id = ?", (goal_id, _uid()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "deleted_id": goal_id})


@app.route("/api/goals/<int:goal_id>/deposit", methods=["POST"])
@require_auth
def deposit_goal(goal_id):
    data = request.get_json(force=True, silent=True) or {}
    try:
        deposit = float(data.get("amount", 0))
        if deposit <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Deposit amount must be positive"}), 400

    conn = get_db()
    row  = _fetchone(_exec(conn, "SELECT * FROM goals WHERE id = ? AND user_id = ?", (goal_id, _uid())))
    if not row:
        conn.close()
        return jsonify({"error": "Goal not found"}), 404

    new_saved = row["saved"] + deposit
    _exec(conn, "UPDATE goals SET saved = ? WHERE id = ?", (new_saved, goal_id))
    conn.commit()
    updated = _fetchone(_exec(conn, "SELECT * FROM goals WHERE id = ?", (goal_id,)))
    conn.close()
    return jsonify(updated)


# ════════════════════════════════════════════════════════════════════════════
# PRESET DATA
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/preset-data", methods=["POST"])
@require_auth
def seed_preset_data():
    conn  = get_db()
    uid   = _uid()
    _exec(conn, "DELETE FROM expenses WHERE user_id = ?", (uid,))

    today = datetime.now()
    demo_expenses = [
        ("Whole Foods Organic Market",    3450.00, "Food",          "Weekly family groceries and fresh veggies", 0),
        ("Coffee Roasters & Bagels",       420.00, "Food",          "Morning latte with colleague",              0),
        ("Metro Transit Smart Card",      1200.00, "Transport",     "Monthly contactless commute pass",          1),
        ("Airtel Fiber Gigabit Internet", 1179.00, "Bills",         "Monthly high-speed broadband plan",         2),
        ("Cinepolis IMAX Movie & Snacks", 1450.00, "Entertainment", "Weekend movie premiere with friends",       2),
        ("Nike Air Zoom Pegasus",         5999.00, "Shopping",      "Marathon training running shoes",           3),
        ("Fuel / Petrol Station",         2800.00, "Transport",     "Full tank refill for weekend trip",         4),
        ("Cult.fit Premium Gym Pass",     2999.00, "Health",        "Quarterly fitness and recovery membership", 5),
        ("Apollo Pharmacy Essentials",     850.00, "Health",        "Multivitamins, omega-3, and first aid",     6),
        ("Electricity Board Utility Bill", 3420.00, "Bills",        "Summer home air conditioning usage",        7),
        ("Amazon Ergonomic Monitor Arm",  2150.00, "Shopping",      "Desk workstation ergonomics upgrade",       8),
        ("Trattoria Italian Dinner",      1880.00, "Food",          "Special evening pasta and gelato",          9),
        ("Netflix & Spotify Duo Bundle",   999.00, "Entertainment", "Streaming entertainment subscriptions",    10),
        ("Uber Premier Ride to Airport",   820.00, "Transport",     "Client meeting transport",                 11),
        ("Anker 65W Fast Charger",        1690.00, "Shopping",      "Travel adapter for laptop and phone",      12),
        ("Dental Cleaning & Checkup",     1500.00, "Health",        "Bi-annual preventative checkup",           13),
    ]

    for title, amount, category, note, days_ago in demo_expenses:
        exp_date   = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        created_at = (today - timedelta(days=days_ago)).isoformat()
        _exec(
            conn,
            "INSERT INTO expenses (user_id, title, amount, category, note, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, title, amount, category, note, exp_date, created_at),
        )

    _exec(conn, "UPDATE budget SET monthly_limit = 45000 WHERE user_id = ?", (uid,))

    _exec(conn, "DELETE FROM goals WHERE user_id = ?", (uid,))
    preset_goals = [
        (uid, "Emergency Fund (6 Mos)",      42000, 120000),
        (uid, "MacBook Pro M3 Max",          55000, 160000),
        (uid, "Japan Cherry Blossom Trip",   38000,  90000),
    ]
    for g_row in preset_goals:
        _exec(conn, "INSERT INTO goals (user_id, name, saved, target) VALUES (?, ?, ?, ?)", g_row)

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "message": "Loaded 16 realistic transactions, goals, and a ₹45,000 budget."})


# ════════════════════════════════════════════════════════════════════════════
# CSV / REPORT EXPORT
# ════════════════════════════════════════════════════════════════════════════

@app.route("/api/export/csv", methods=["GET"])
@require_auth
def export_csv():
    """Export user's expenses as a CSV file download."""
    conn  = get_db()
    uid   = _uid()
    month = request.args.get("month", "")
    query = "SELECT date, title, category, amount, note FROM expenses WHERE user_id = ?"
    params = [uid]
    if month:
        query += " AND date LIKE ?"
        params.append(f"{month}%")
    query += " ORDER BY date DESC"
    rows = _fetchall(_exec(conn, query, params))
    conn.close()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["date", "title", "category", "amount", "note"])
    writer.writeheader()
    for row in rows:
        writer.writerow({
            "date":     row.get("date", ""),
            "title":    row.get("title", ""),
            "category": row.get("category", ""),
            "amount":   row.get("amount", 0),
            "note":     row.get("note", ""),
        })

    resp = make_response(output.getvalue())
    fname = f"pocketsmart_expenses{'_' + month if month else ''}.csv"
    resp.headers["Content-Type"]        = "text/csv"
    resp.headers["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp


# ════════════════════════════════════════════════════════════════════════════
# AI ENGINE
# ════════════════════════════════════════════════════════════════════════════

def build_local_ai_recommendations(summary_data, expenses, custom_query=None):
    """Smart local financial rule-based intelligence."""
    recos        = []
    month_total  = summary_data.get("month_total", 0)
    monthly_limit = summary_data.get("monthly_limit", 40000)
    by_category  = summary_data.get("by_category", {})
    health_score = summary_data.get("health_score", 85)

    sorted_cats = sorted(by_category.items(), key=lambda x: x[1], reverse=True)
    top_cat, top_spent = sorted_cats[0] if sorted_cats else ("Food", 0)

    if top_spent > 0:
        benchmark = CATEGORY_BUDGET_BENCHMARKS.get(top_cat, 5000)
        if top_spent > benchmark:
            diff = top_spent - benchmark
            recos.append({
                "tag": top_cat, "type": "alert",
                "title": f"Tame your {top_cat.lower()} spending",
                "body": f"Your {top_cat.lower()} expenses (₹{top_spent:,.2f}) exceed benchmark by ₹{diff:,.2f}. Shifting just two discretionary purchases can restore balance.",
                "impact": f"Save ~₹{diff * 0.4:,.0f}/mo",
            })
        else:
            recos.append({
                "tag": top_cat, "type": "habit",
                "title": f"{top_cat} is your primary spending driver",
                "body": f"Representing {round(top_spent / month_total * 100) if month_total else 0}% of monthly spend. Auditing recurring expenses here offers the easiest savings leverage.",
                "impact": f"Potential savings: ₹{top_spent * 0.15:,.0f}",
            })

    remaining = monthly_limit - month_total
    if remaining < 5000 and monthly_limit > 0:
        recos.append({
            "tag": "Budget Runway", "type": "alert",
            "title": "Low budget runway alert",
            "body": f"You have ₹{remaining:,.2f} left for the remainder of this month. Aim for a zero-unplanned-spend cadence this week to prevent overdraft.",
            "impact": "Protect emergency cash",
        })
    else:
        recos.append({
            "tag": "Wealth Building", "type": "opportunity",
            "title": "Automate surplus transfer to goals",
            "body": f"With ₹{remaining:,.2f} in remaining runway, route 25% of leftover funds directly to your top savings goal on the 28th.",
            "impact": f"Grow goals by ₹{max(1000, remaining * 0.25):,.0f}",
        })

    shopping_spent = by_category.get("Shopping", 0)
    if shopping_spent > 4000:
        recos.append({
            "tag": "Shopping", "type": "habit",
            "title": "Adopt the 48-Hour Cart Rule",
            "body": "Non-essential purchases over ₹1,500 often drop off when deferred for 48 hours. This reduces impulsive shopping by up to 35%.",
            "impact": "Estimated save: ₹1,800/mo",
        })
    else:
        recos.append({
            "tag": "Subscriptions", "type": "opportunity",
            "title": "Audit streaming & digital memberships",
            "body": "Consolidate overlapping entertainment and cloud subscriptions into family or annual bundles for an instant 20% discount.",
            "impact": "Save ~₹600/mo",
        })

    headline     = "Solid Financial Foundation" if health_score >= 80 else "Actionable Adjustments Recommended"
    summary_text = (
        f"You have used {round((month_total / monthly_limit) * 100) if monthly_limit else 0}% of your monthly allocation. "
        f"Your spending velocity is ₹{summary_data.get('daily_average', 0):,.2f}/day. "
        f"{'You are comfortably on track.' if health_score >= 80 else 'Targeting your largest category will yield immediate relief.'}"
    )

    advisor_reply = None
    if custom_query:
        q = custom_query.lower()
        if any(kw in q for kw in ["food", "grocery", "dine"]):
            advisor_reply = (
                f"You have spent ₹{by_category.get('Food', 0):,.2f} on Food this month. "
                "To reduce this: (1) Meal plan weekday dinners, (2) Limit food delivery to once weekly, "
                "and (3) Brew premium coffee at home instead of takeaway cafes."
            )
        elif any(kw in q for kw in ["goal", "save", "emergency"]):
            advisor_reply = (
                f"Your current savings buffer is {summary_data.get('savings_rate', 0):.1f}%. "
                "Treat savings like a non-negotiable bill. Set an auto-debit on payday."
            )
        elif any(kw in q for kw in ["budget", "limit"]):
            advisor_reply = (
                f"Your monthly limit is ₹{monthly_limit:,.2f} with ₹{remaining:,.2f} remaining. "
                f"Daily allowable burn ≈ ₹{max(0, remaining / 15):,.2f}/day for the next two weeks."
            )
        else:
            advisor_reply = (
                f"Based on your trajectory (Health Score: {health_score}/100), your primary lever is "
                f"managing {top_cat} (₹{top_spent:,.2f}). Keeping daily burn under ₹{summary_data.get('daily_average', 0):,.2f} "
                "ensures a comfortable month-end surplus."
            )

    return {
        "engine":          "PocketSmart Rules Engine",
        "headline":        headline,
        "health_score":    health_score,
        "health_status":   summary_data.get("health_status", "Optimal"),
        "summary_text":    summary_text,
        "recommendations": recos,
        "savings_tips": [
            "Keep an emergency buffer equal to 3 months of essential living expenses.",
            "Use the 50/30/20 budget framework: 50% Needs, 30% Wants, 20% Savings.",
            "Conduct a 5-minute weekly expense review every Sunday evening.",
        ],
        "advisor_reply": advisor_reply,
    }


def call_gemini_advisor(api_key, summary_data, expenses, custom_query=None):
    """Calls Google Gemini using the official google.genai SDK."""
    from google import genai
    client = genai.Client(api_key=api_key)

    # Build a richer spending habits analysis prompt
    monthly_trend = summary_data.get("monthly_trend", [])
    trend_str = ", ".join(f"{t['label']}: ₹{t['amount']:,.0f}" for t in monthly_trend)

    prompt = f"""You are PocketSmart AI, an elite personal wealth advisor with expertise in behavioral finance.
Analyze this user's financial snapshot and return precise advice in strict JSON.

Financial Snapshot:
- Total All-Time Spending: ₹{summary_data.get('total', 0)}
- This Month: ₹{summary_data.get('month_total', 0)}
- Monthly Budget: ₹{summary_data.get('monthly_limit', 0)}
- Remaining: ₹{summary_data.get('remaining', 0)}
- Savings Rate: {summary_data.get('savings_rate', 0)}%
- Daily Average: ₹{summary_data.get('daily_average', 0)}
- Projected Month-End Total: ₹{summary_data.get('projected_month_end', 0)}
- Category Breakdown: {json.dumps(summary_data.get('by_category', {}))}
- 6-Month Trend: {trend_str}
- Recent Expenses (latest 12): {json.dumps([{{'title': e['title'], 'amount': e['amount'], 'category': e['category'], 'date': e['date']}} for e in expenses[:12]])}
User Query: {custom_query if custom_query else "Provide tailored recommendations, spending habit analysis, and savings opportunities."}

Detect spending patterns, recurring subscriptions, and behavioral tendencies. Be specific and actionable.

Output MUST be a single raw JSON object with these exact keys:
- "headline": (string, short punchy title)
- "health_score": (int, 0-100)
- "health_status": ("Optimal" | "Stable" | "Watch Closely")
- "summary_text": (string, 2 insightful sentences about spending habits)
- "recommendations": array of 3 objects with "tag", "type" ("alert"|"opportunity"|"habit"), "title", "body", "impact"
- "savings_tips": array of 3 concise actionable strings tailored to this user's data
- "advisor_reply": (string, direct helpful answer if user asked a query, else null)
- "spending_pattern": (string, one sentence describing the user's overall spending behavior)
No markdown, no explanation, just pure JSON."""

    for model_name in ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"]:
        try:
            resp = client.models.generate_content(model=model_name, contents=prompt)
            raw  = resp.text.strip()
            if raw.startswith("```json"): raw = raw[7:]
            if raw.startswith("```"):     raw = raw[3:]
            if raw.endswith("```"):       raw = raw[:-3]
            parsed = json.loads(raw.strip())
            parsed["engine"] = f"Gemini AI ({model_name})"
            return parsed
        except Exception:
            continue
    raise RuntimeError("All Gemini model attempts failed")


@app.route("/api/ai-recommendations", methods=["GET"])
@require_auth
@_rate_limit(max_calls=20, window_sec=60)
def ai_recommendations():
    conn     = get_db()
    expenses = _fetchall(_exec(conn, "SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC LIMIT 30", (_uid(),)))
    conn.close()

    sum_res  = summary().get_json()
    user_key = request.headers.get("x-gemini-api-key") or os.environ.get("GEMINI_API_KEY", "")

    if user_key:
        try:
            return jsonify(call_gemini_advisor(user_key, sum_res, expenses))
        except Exception:
            pass

    return jsonify(build_local_ai_recommendations(sum_res, expenses))


@app.route("/api/ai-advisor", methods=["POST"])
@require_auth
@_rate_limit(max_calls=20, window_sec=60)
def ai_advisor():
    data     = request.get_json(force=True, silent=True) or {}
    query    = (data.get("question") or "").strip()
    user_key = request.headers.get("x-gemini-api-key") or data.get("api_key") or os.environ.get("GEMINI_API_KEY", "")

    conn     = get_db()
    expenses = _fetchall(_exec(conn, "SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC LIMIT 30", (_uid(),)))
    conn.close()

    sum_res = summary().get_json()

    if user_key:
        try:
            return jsonify(call_gemini_advisor(user_key, sum_res, expenses, custom_query=query))
        except Exception:
            pass

    return jsonify(build_local_ai_recommendations(sum_res, expenses, custom_query=query))


# ════════════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
