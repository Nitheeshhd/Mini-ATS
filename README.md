# Mini ATS

A small Applicant Tracking System: manage candidates, move them through hiring stages, search/filter, and view dashboard metrics.

**Live demo:** https://mini-ats-cam8.onrender.com · **Demo video:** https://drive.google.com/file/d/1H8EEqINz0rDzbU5VuOJf185nPyzbrgwn/view?usp=sharing

## Stack
Node.js + Express, SQLite (better-sqlite3), vanilla JS frontend served by the same server (one deployable unit).

## Features
- Candidate CRUD with validation (required fields, email format, unique email)
- Stages: Applied → Screening → Interview → Offer → Hired / Rejected, changeable inline; every change is logged in `stage_history`
- Search (name, email, skills, role), filter by stage and role, sortable columns, pagination
- Dashboard: total, active, hired, hire rate, new in 7 days, avg days to hire, pipeline and role breakdowns

## Run locally
```
npm install
npm start   # http://localhost:3000
```
Env: `PORT`, `DB_PATH` (default `ats.db`), `SEED=0` to skip demo data.

## API
| Method | Path | Notes |
|---|---|---|
| GET | /api/candidates | `q, stage, role, sort, order, page, limit` |
| GET | /api/candidates/:id | includes stage history |
| POST | /api/candidates | create |
| PUT | /api/candidates/:id | update |
| PATCH | /api/candidates/:id/stage | `{stage}` |
| DELETE | /api/candidates/:id | |
| GET | /api/metrics | dashboard numbers |

## Deploy (Render)
New Web Service from the GitHub repo, Build `npm install`, Start `npm start`. Free tier disk is ephemeral, so data resets on redeploy (demo data reseeds); attach a disk and set `DB_PATH=/var/data/ats.db` for persistence.

## Decisions
SQLite keeps setup zero-config; stage history gives an audit trail and powers time-to-hire; frontend is dependency-free to keep the repo easy to review.
