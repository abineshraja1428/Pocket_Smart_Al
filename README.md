# PocketSmart AI — AI/ML/Gen-AI Track Project

## Project Overview

PocketSmart AI is a web-based smart budget and recommendation assistant that helps users track expenses, manage monthly budgets, set savings goals, visualize spending, scan receipts, export transaction data, and receive AI-assisted financial recommendations.

## Repository Structure

```text
1. Brainstorming & Ideation/
2. Requirement Analysis/
3. Project Design Phase/
4. Project Planning Phase/
5. Project Development Phase/
6.Project Testing/
7.Project Documentation/
8.Project Demonstration/
app.py
templates/
static/
requirements.txt
spend_guide.db
README.md
```

The eight phase folders follow the structure of the supplied
`AI-ML-and-GEN-AI-Track-Project-Template-main` project template.

## Main Features

- Expense tracking
- Spending analytics
- Budget management
- Savings goals
- AI recommendations
- AI receipt scanning
- CSV export
- Dark/light mode
- User authentication
- Security headers and rate limiting

## Technology Stack

Python, Flask, HTML, CSS, JavaScript, SQLite, optional PostgreSQL,
Chart.js and Google Gemini.

## Running the Project

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`.

Configure environment values such as `SECRET_KEY` and, when AI features
are required, the Gemini API key according to the project documentation.

## Notes

- Team ID and team-member names were not present in the supplied project, so they are marked `TBD` in the submission documents.
- Performance figures are not fabricated; the testing document specifies what should be measured in the final environment.
- The original application source files are retained.
