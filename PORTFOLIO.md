# Portfolio Case Study: Sari-Sari Utang Tracker

## Overview

Sari-Sari Utang Tracker is a local-first ledger app for a small Filipino sari-sari store. It helps the owner track customer utang, payments, unpaid balances, printable receipts, backups, and optional cloud sync.

## Problem

Small neighborhood stores often track utang manually in notebooks. This makes it hard to search customer balances, calculate partial payments, print a receipt, and keep backup copies of records.

## Solution

I built a static web app that runs quickly in the browser using localStorage, then added optional Supabase sync for cloud backup. The owner can use it on one device without a server, or connect a free Supabase project for cross-device data recovery.

## Main Features

- Owner passcode protection
- Add and search customers
- Add products and prices
- Record utang per customer
- Calculate paid amount and unpaid balance
- Mark individual or all records as paid
- Record partial payments
- Printable customer receipt
- Dashboard and report charts
- Export CSV reports
- Export/import JSON backups
- Daily backup reminders
- Optional Supabase cloud sync with Row Level Security
- Responsive dashboard layout

## Tech Used

- HTML
- CSS
- JavaScript
- Browser localStorage
- Supabase Auth and PostgreSQL
- Vercel static hosting

## What I Learned

- How to structure a plain JavaScript app without a framework
- How to design a local-first workflow for real store use
- How to use localStorage for fast persistent data
- How to add optional cloud sync without making the app depend on internet access
- How to calculate running balances from ledger data
- How to render simple charts with Canvas
- How to export CSV and JSON files from the browser
- How to prepare a static project for Vercel deployment
- How to write Supabase Row Level Security policies

## Limitations

This is designed for one store owner/admin. The local passcode is useful for casual protection on the device, but serious production use should also rely on strong device security, Supabase Auth, regular backups, and careful access control.

## Portfolio Pitch

A practical local business app built with plain HTML, CSS, and JavaScript, upgraded with optional Supabase cloud sync. It shows real-world problem solving, CRUD logic, local-first data design, auth-aware sync, responsive UI, reporting, backups, and deployment readiness.
