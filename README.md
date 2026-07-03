# Sari-Sari Utang Tracker

A local-first credit/debt ledger for a small Filipino sari-sari store. It helps one store owner track customers, utang records, partial payments, unpaid balances, printable receipts, backups, reports, and optional Supabase cloud sync.

The app is built to stay simple and free to run:

- Hosting: Vercel free tier
- Local storage: Browser `localStorage`
- Optional cloud sync: Supabase free tier
- Optional auth: Supabase Auth free tier

## Project Type

This is a static browser app. It does not need Flask, Render, SQLite, or a paid database server.

Data is saved locally first using `localStorage`, so the app stays fast even without internet. Supabase sync is optional and can be enabled from the Settings page.

## Features

- Owner passcode protection
- Customer management with name, phone, address, and notes
- Product list with default sari-sari store items
- Add utang records by customer, product, quantity, and price
- Automatic total, paid amount, and unpaid balance calculation
- Mark one utang record as paid
- Mark all customer utang records as paid
- Record partial customer payments
- Printable customer receipt for unpaid balances
- Dashboard summary cards
- Reports with charts
- View all records and recent payments
- Search customers, products, and records
- Export customers and records as CSV
- Export and import JSON backups
- Daily backup reminder
- Optional Supabase cloud sync
- Responsive layout for desktop and mobile

## How To Run Locally

Open the project folder:

```powershell
cd "C:\MYPROJECTS\Sari-Sari Utang Tracker"
```

Open the app:

```powershell
Start-Process .\index.html
```

You can also double-click `index.html` or open it manually in your browser.

## Before Deploying

Test these features locally first:

- Add a customer
- Add an utang record
- Record a partial payment
- Print a customer receipt
- Export a JSON backup
- Open Settings and set an owner passcode

## Deploy To Vercel

Push the project to GitHub:

```powershell
git status
git add index.html static README.md PORTFOLIO.md supabase vercel.json .gitignore
git commit -m "Prepare Sari-Sari Utang Tracker for deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

If your repository already has a remote, skip `git remote add origin ...` and run:

```powershell
git push -u origin main
```

Then deploy:

1. Go to Vercel.
2. Sign in with GitHub.
3. Click `New Project`.
4. Import your GitHub repository.
5. Use these settings:
   - Framework Preset: `Other`
   - Build Command: leave empty
   - Output Directory: leave empty/root
   - Install Command: leave empty
6. Click `Deploy`.

The included `vercel.json` rewrites all routes to `index.html`, which keeps the static single-page app working on Vercel.

## Optional Supabase Cloud Sync

The app works without Supabase. Use Supabase only if you want cloud backup or cross-device recovery.

### Create Supabase Project

1. Create a free Supabase project.
2. Go to `Authentication -> Providers`.
3. Make sure Email/Password sign-in is enabled.
4. Go to `SQL Editor`.
5. Open this project file:

```text
supabase/schema.sql
```

6. Copy the SQL code and run it in Supabase.

This creates one table:

```text
ledger_snapshots
```

The table uses Row Level Security so a signed-in owner can only read and write their own cloud snapshot.

### Connect The App To Supabase

In Supabase, copy:

- Project URL
- Anon/public key

Do not use the `service_role` key in this app.

Then open your deployed app and go to:

```text
Settings -> Supabase Cloud Sync
```

Enter your Supabase Project URL and anon key, then:

1. Click `Save Supabase Config`.
2. Sign up or sign in with the owner email/password.
3. Click `Upload Local`.
4. Turn on `Auto sync after changes` if you want automatic uploads.

### Supabase Auth URL

After Vercel gives you a production URL, add it in Supabase:

```text
Authentication -> URL Configuration -> Site URL
```

Example:

```text
https://your-app-name.vercel.app
```

## Daily Usage

Recommended workflow for the store owner:

1. Open the app on the store phone, tablet, or computer.
2. Add customers when someone buys on credit.
3. Add utang records each time they borrow or buy.
4. Record partial payments when they pay.
5. Print a receipt when needed.
6. Export a JSON backup daily or keep Supabase auto sync enabled.

## Data Safety Notes

This app is local-first. The browser stores the main copy of the ledger.

Before clearing browser data, changing phones, or reinstalling a browser, use:

```text
Settings -> Export JSON Backup
```

To restore later, use:

```text
Settings -> Import JSON Backup
```

The owner passcode is a local convenience lock. For real-world use, also protect the actual device with a strong password, PIN, or fingerprint.

## Code Structure

```text
sari-sari-utang-tracker/
├── index.html              # Static app shell
├── static/
│   ├── app.js              # App logic, localStorage, CRUD, reports, sync
│   └── style.css           # Responsive dashboard styling
├── supabase/
│   └── schema.sql          # Supabase table and RLS policies
├── vercel.json             # Vercel static app rewrite
├── README.md               # Project setup and deployment guide
└── PORTFOLIO.md            # Portfolio case study summary
```

## Portfolio Notes

This project is good for a student portfolio because it solves a realistic local business problem and includes:

- CRUD operations
- Local-first data storage
- Optional cloud sync
- Authentication-aware security rules
- Export/import backups
- Responsive UI
- Reports and charts
- Deployment readiness
