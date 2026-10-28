# Sub-Tracker

A personal finance web app for tracking subscriptions and everyday expenses in one place. It forecasts your month-end spend and warns you before you go over budget.

**Live demo:** https://sub-tracker-rose.vercel.app/

## Features

- **Google sign-in** with Firebase Authentication, so each user gets a private account
- **Per-user data**: everything is stored under `users/{uid}` in Firebase Realtime Database, protected by security rules (`database.rules.json`), and syncs live across devices
- **At-a-glance dashboard**: spent this month, projected month-end spend, budget left and yearly subscription cost
- **Budget forecasting**: projects month-end spend (fixed subscriptions plus the current daily expense rate) and warns you early if you're heading over budget
- **Subscriptions with monthly or yearly billing**: renewal dates roll forward automatically each cycle, a 7-day "renewing soon" list shows what's about to charge you, and expired free trials are flagged so you can cancel in time
- **Full CRUD**: add, edit and delete subscriptions and expenses, with input validation
- **Category budgets**: set a monthly limit per category and track it with colour-coded progress bars and over-limit alerts
- **Search and filters**: find expenses by name, category, or this month / all time, with a running total
- **Analytics**: a category donut chart and a 6-month spending trend chart, built with Recharts
- **CSV export** of all expenses and subscriptions
- Responsive layout that works on mobile; all amounts in Indian Rupees (INR)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, JavaScript (JSX) |
| Auth | Firebase Authentication (Google provider) |
| Database | Firebase Realtime Database |
| Charts | Recharts |
| Hosting | Vercel |
| Tooling | ESLint |

## Running locally

```bash
git clone https://github.com/Shrishailgb24/sub-tracker.git
cd sub-tracker
npm install
```

Create a `.env` file in the project root with your Firebase project's config:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Then start the dev server:

```bash
npm run dev
```

## How data is structured

```
users/
  {uid}/
    subscriptions/{id}: { name, cost, cycle, nextRenewalDate, isFreeTrial }
    expenses/{id}:      { name, amount, category, date }
    settings:           { monthlyBudget, categoryBudgets: { Food, Rent, ... } }
```

Each user can only read and write their own `users/{uid}` path. The rules are in `database.rules.json`; paste them into Firebase Console → Realtime Database → Rules.

## Roadmap

- Email or push reminders before a subscription renews
- Recurring expenses and yearly subscriptions
- Shared budgets for flatmates
