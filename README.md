# Sari-Sari Utang Tracker

A static, browser-only utang tracker for a small sari-sari store. It helps a store owner record customers, products, utang entries, payments, and unpaid balances without needing a server or database.

## Project Type

This is the localStorage version of the app.

All data is saved in the browser using `localStorage`.

## Features

- Customer management with name, phone, address, and notes
- Product list with default sari-sari store items
- Add utang records by customer, product, quantity, and price
- Automatic total and running unpaid balance calculation
- Mark one utang as paid
- Mark all customer utang as paid
- Record partial customer payments
- View all records and recent payments
- Search customers, products, and records
- Export customers and records as CSV
- Export and import JSON backups
- Responsive layout for desktop and mobile

## How To Run Locally

Open the project folder:

```powershell
cd "C:\MYPROJECTS\Sari-Sari Utang Tracker"
```

Open the app directly:

```powershell
Start-Process .\index.html
```

You can also open `index.html` manually in your browser.

## How To Deploy To Vercel

1. Push this project to GitHub.
2. Import the repository in Vercel.
3. Use these settings:
   - Framework Preset: `Other`
   - Build Command: leave empty
   - Output Directory: leave empty/root
4. Deploy.

The included `vercel.json` redirects all routes to `index.html`, which keeps the static app working on Vercel.

## Data Storage Warning

This app stores data only in the browser where it is used. Data will not automatically sync across phones, laptops, or browsers.

Before clearing browser data or moving devices, use:

`Settings -> Export JSON Backup`

To restore data later, use:

`Settings -> Import JSON Backup`

## Code Structure

```text
sari-sari-utang-tracker/
├── index.html          # Static app shell
├── static/
│   ├── app.js          # App logic, localStorage, CRUD, export/import
│   └── style.css       # Responsive dashboard styling
├── vercel.json         # Vercel static app rewrite
├── README.md           # Project setup and usage
└── PORTFOLIO.md        # Portfolio case study summary
```

## Future Improvements

- Add passcode protection for the owner
- Add printable customer receipt design
- Add better charts for reports
- Add cloud sync with Supabase e
- Add daily automatic backup reminders
