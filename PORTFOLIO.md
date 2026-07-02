# Portfolio Case Study: Sari-Sari Utang Tracker

## Overview

Sari-Sari Utang Tracker is a browser-based ledger app for a small Filipino sari-sari store. It helps the store owner track customers who buy on credit, record payments, and monitor unpaid balances.

## Problem

Small neighborhood stores often track utang manually in notebooks. This can make it hard to search customer balances, calculate partial payments, and keep backup copies of records.

## Solution

I built a static web app that runs in the browser and saves data using localStorage. The owner can manage customers, products, credit records, and payments without installing a database or server.

## Main Features

- Add and search customers
- Add products and prices
- Record utang per customer
- Calculate total, paid amount, and unpaid balance
- Mark individual or all records as paid
- Record partial payments
- Export CSV reports
- Export/import JSON backups
- Responsive dashboard layout

## Tech Used

- HTML
- CSS
- JavaScript
- Browser localStorage
- Vercel static hosting

## What I Learned

- How to structure a plain JavaScript app without a framework
- How to use localStorage for simple persistent data
- How to build CRUD features on the frontend
- How to calculate running balances from record data
- How to export CSV and JSON files from the browser
- How to prepare a static project for Vercel deployment

## Limitations

This version stores data only in one browser. It is good for a simple single-device store setup, but a larger real-world version should use a cloud database, authentication, and automatic backups.

## Future Improvements

- Add owner passcode or login
- Add cloud sync
- Add printable receipt layout
- Add monthly sales and collection reports
- Add product categories
- Add backup reminders

## Portfolio Pitch

A practical local business app built with plain HTML, CSS, and JavaScript. It shows real-world problem solving, CRUD logic, browser storage, responsive design, and deployment readiness.
