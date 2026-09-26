# 💰 Pocket_Smart AI

### Your Smart Budget & Recommendation Assistant

PocketSmart AI is a simple web-based finance app to **track expenses, manage budgets, set savings goals, and get AI-powered recommendations.**

## ✨ Features

* 💸 Expense tracking
* 📊 Spending analytics
* 💰 Budget management
* 🎯 Savings goals
* 🤖 AI recommendations
* 📷 AI receipt scanning
* 📄 CSV export
* 🌙 Dark/Light mode

## 📁 Structure

```text
pocket-smart-ai/
├── app.py
├── requirements.txt
├── spend_guide.db
├── templates/
│   └── index.html
└── static/
    ├── app.js
    └── style.css
```
## 🛠️ Tech Stack

**Python • Flask • HTML • CSS • JavaScript • SQLite • Chart.js • Google Gemini**

## 🚀 Installation

```bash
git clone <repository-url>
cd pocket-smart-ai
```

### Create Virtual Environment

**Windows**

```bash
python -m venv venv
venv\Scripts\activate
```

**Linux / macOS**

```bash
python3 -m venv venv
source venv/bin/activate
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Configure `.env`

```env
GEMINI_API_KEY=your_api_key
SECRET_KEY=your_secret_key
```

### Run

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

## 🤖 Gemini AI Setup

Gemini is optional. Set your API key as:

```bash
GEMINI_API_KEY=your_api_key
```
> AI recommendations are for general financial guidance only.
The application can use its built-in recommendation system when Gemini is unavailable.

## 📖 Usage

1. Register or log in.
2. Add expenses and set a budget.
3. Create savings goals.
4. View your spending analytics.
5. Get AI recommendations.
6. Scan receipts and export your data.

