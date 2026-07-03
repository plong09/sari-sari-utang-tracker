(function () {
  const KEY = "sariSariUtangTracker.local.v2";
  const OLD_KEY = "sariSariUtangTracker.local.v1";
  const UNLOCK_KEY = "sariSariUtangTracker.unlocked";
  const CLOUD_TABLE = "ledger_snapshots";
  const DEFAULT_PRODUCTS = [
    { id: "p1", name: "Coke 1.5L", price: 20 },
    { id: "p2", name: "Noodles", price: 15 },
    { id: "p3", name: "Sardines", price: 28 },
    { id: "p4", name: "Bread", price: 10 },
    { id: "p5", name: "Egg", price: 10 }
  ];
  const DEFAULT_SETTINGS = {
    passcodeHash: "",
    passcodeSalt: "",
    backupReminder: true,
    lastBackupDate: "",
    supabaseUrl: "",
    supabaseAnonKey: "",
    cloudAutoSync: false,
    cloudLastSync: ""
  };
  const TITLES = {
    dashboard: ["Store overview", "Dashboard"],
    customers: ["Directory", "Customers"],
    products: ["Inventory", "Products"],
    records: ["Ledger", "Utang Records"],
    reports: ["Insights", "Reports"],
    settings: ["Security and sync", "Settings"]
  };

  let state = loadState();
  let selectedCustomerId = state.customers[0] ? state.customers[0].id : null;
  let route = getRoute();
  let unlocked = !state.settings.passcodeHash || sessionStorage.getItem(UNLOCK_KEY) === "true";
  let lockMessage = "";
  let cloudClient = null;
  let cloudSession = null;
  let cloudMessage = "";
  let cloudConfigKey = "";
  let cloudSubscription = null;
  let syncTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const view = $("#view");
  const appShell = $("#appShell") || $(".app");
  const lockScreen = $("#lockScreen");

  function id(prefix) {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function normalizeState(saved) {
    const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    return {
      customers: Array.isArray(saved.customers) ? saved.customers : [],
      products: Array.isArray(saved.products) && saved.products.length ? saved.products : DEFAULT_PRODUCTS,
      records: Array.isArray(saved.records) ? saved.records : [],
      payments: Array.isArray(saved.payments) ? saved.payments : [],
      settings
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || "{}";
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      return normalizeState({});
    }
  }

  function persistState() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function saveState(options) {
    const opts = options || {};
    persistState();
    render();
    if (!opts.skipCloud) scheduleCloudSync();
  }

  function getRoute() {
    return (location.hash || "#dashboard").replace("#", "") || "dashboard";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function peso(value) {
    return "P" + Number(value || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function niceDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
  }

  function recordBalance(record) {
    return Math.max(Number(record.total || 0) - Number(record.amountPaid || 0), 0);
  }

  function recordStatus(record) {
    const paid = Number(record.amountPaid || 0);
    if (paid >= Number(record.total || 0)) return "PAID";
    if (paid > 0) return "PARTIAL";
    return "UNPAID";
  }

  function customerBalance(customerId) {
    return state.records
      .filter((record) => record.customerId === customerId)
      .reduce((sum, record) => sum + recordBalance(record), 0);
  }

  function totals() {
    const totalUnpaid = state.records.reduce((sum, record) => sum + recordBalance(record), 0);
    const totalPaid = state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const todayUtang = state.records
      .filter((record) => String(record.createdAt || "").startsWith(todayKey()))
      .reduce((sum, record) => sum + Number(record.total || 0), 0);
    return { totalUnpaid, totalPaid, todayUtang, customerCount: state.customers.length };
  }

  function customerById(customerId) {
    return state.customers.find((customer) => customer.id === customerId) || null;
  }

  function openRecords(customerId, includePaid) {
    return state.records
      .filter((record) => record.customerId === customerId)
      .filter((record) => includePaid || recordBalance(record) > 0)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function customerRows() {
    return state.customers
      .map((customer) => ({ ...customer, balance: customerBalance(customer.id) }))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  function hasLedgerData() {
    return state.customers.length > 0 || state.records.length > 0 || state.payments.length > 0;
  }

  function needsBackupReminder() {
    return state.settings.backupReminder && hasLedgerData() && state.settings.lastBackupDate !== todayKey();
  }

  async function hashText(text) {
    const encoded = new TextEncoder().encode(text);
    const buffer = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function newSalt() {
    const values = new Uint8Array(16);
    crypto.getRandomValues(values);
    return Array.from(values).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function verifyPasscode(passcode) {
    if (!state.settings.passcodeHash) return true;
    const hash = await hashText(state.settings.passcodeSalt + passcode);
    return hash === state.settings.passcodeHash;
  }

  async function setPasscode(passcode) {
    const salt = newSalt();
    state.settings.passcodeSalt = salt;
    state.settings.passcodeHash = await hashText(salt + passcode);
    sessionStorage.setItem(UNLOCK_KEY, "true");
    unlocked = true;
    saveState({ skipCloud: true });
  }

  function clearPasscode() {
    state.settings.passcodeSalt = "";
    state.settings.passcodeHash = "";
    sessionStorage.removeItem(UNLOCK_KEY);
    unlocked = true;
    saveState({ skipCloud: true });
  }

  function renderLock() {
    if (appShell) appShell.hidden = true;
    if (!lockScreen) return;
    lockScreen.hidden = false;
    lockScreen.innerHTML = `
      <section class="login-card">
        <div class="store-illustration" aria-hidden="true">
          <div class="store-roof"></div><div class="store-awning"><span></span><span></span><span></span></div>
          <div class="store-body"><div class="store-window"></div><div class="store-door"></div></div><div class="store-shadow"></div>
        </div>
        <div class="login-panel">
          <div class="login-card-head"><h1>Sari-Sari Utang Tracker</h1><p>Owner passcode required</p></div>
          ${lockMessage ? `<div class="login-error"><i class="fas fa-circle-exclamation"></i>${escapeHtml(lockMessage)}</div>` : ""}
          <form class="login-form" data-action="unlock-app">
            <label class="login-field">Passcode
              <div class="login-input"><i class="fas fa-lock"></i><input type="password" name="passcode" autocomplete="current-password" required autofocus></div>
            </label>
            <button class="login-btn" type="submit"><i class="fas fa-sign-in-alt"></i> Unlock</button>
          </form>
        </div>
      </section>`;
  }

  function getSyncLabel() {
    if (!state.settings.supabaseUrl || !state.settings.supabaseAnonKey) return "Local only";
    if (cloudSession) return state.settings.cloudAutoSync ? "Cloud sync on" : "Cloud connected";
    return "Cloud not signed in";
  }

  function updateShell() {
    route = getRoute();
    if (!TITLES[route]) route = "dashboard";
    const title = TITLES[route];
    $("#pageEyebrow").textContent = title[0];
    $("#pageTitle").textContent = title[1];
    document.querySelectorAll("#mainNav a").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === route);
    });
    const summary = totals();
    $("#sideUnpaid").textContent = peso(summary.totalUnpaid);
    $("#sidePaid").textContent = peso(summary.totalPaid);
    $("#sideCustomers").textContent = summary.customerCount;
    $("#statUnpaid").textContent = peso(summary.totalUnpaid);
    $("#statPaid").textContent = peso(summary.totalPaid);
    $("#statToday").textContent = peso(summary.todayUtang);
    $("#statCustomers").textContent = summary.customerCount;
    const syncStatus = $("#syncStatus");
    if (syncStatus) syncStatus.textContent = getSyncLabel();
  }

  function render() {
    if (!unlocked) {
      renderLock();
      return;
    }
    if (lockScreen) lockScreen.hidden = true;
    if (appShell) appShell.hidden = false;
    updateShell();
    if (route === "customers") renderCustomers();
    else if (route === "products") renderProducts();
    else if (route === "records") renderRecords();
    else if (route === "reports") renderReports();
    else if (route === "settings") renderSettings();
    else renderDashboard();
  }

  function backupReminderHtml() {
    if (!needsBackupReminder()) return "";
    return `<div class="notice-banner"><div><strong>Daily backup reminder</strong><p>Export a JSON backup today so your local records stay safe.</p></div><button class="blue-btn" data-action="export-backup" type="button"><i class="fas fa-file-csv"></i> Export Backup</button></div>`;
  }

  function renderDashboard() {
    const rows = customerRows();
    if (!selectedCustomerId && rows[0]) selectedCustomerId = rows[0].id;
    if (selectedCustomerId && !customerById(selectedCustomerId)) selectedCustomerId = rows[0] ? rows[0].id : null;
    const selected = customerById(selectedCustomerId);
    view.innerHTML = `${backupReminderHtml()}
      <section class="content-grid">
        <div class="customer-panel">
          <div class="panel-head"><h3>Customers</h3><button class="icon-link" data-action="export-customers" title="Export customers"><i class="fas fa-file-csv"></i></button></div>
          <input type="text" id="customerSearch" placeholder="Search customer...">
          <div class="customer-list">
            ${rows.length ? rows.map((customer) => `
              <button class="customer customer-item ${customer.id === selectedCustomerId ? "active-customer" : ""}" data-action="select-customer" data-id="${customer.id}" type="button">
                <strong>${escapeHtml(customer.name)}</strong><span>${peso(customer.balance)}</span>
                <small>${escapeHtml(customer.phone || customer.address || "No contact details")}</small>
              </button>`).join("") : `<p class="empty">No customers yet.</p>`}
          </div>
        </div>
        <div class="details">${selected ? customerDetailHtml(selected) : emptyState("No customer selected", "Add a customer to start tracking utang.")}</div>
      </section>`;
    initSearch("#customerSearch", ".customer-item");
  }

  function customerDetailHtml(customer) {
    const records = openRecords(customer.id, false);
    const history = state.payments.filter((payment) => payment.customerId === customer.id).slice().reverse().slice(0, 20);
    const balance = customerBalance(customer.id);
    return `
      <div class="details-head">
        <div><h2>${escapeHtml(customer.name)}</h2><p>Total unpaid: <b>${peso(balance)}</b></p></div>
        <div class="actions">
          <button class="print-btn" data-action="print-receipt" data-id="${customer.id}" type="button"><i class="fas fa-print"></i> Receipt</button>
          <button class="blue-btn" data-action="export-customer" data-id="${customer.id}" type="button"><i class="fas fa-file-csv"></i> Export</button>
          ${balance > 0 ? `<button class="yellow-btn" data-action="prompt-payment" data-id="${customer.id}" type="button"><i class="fas fa-coins"></i> Partial</button><button class="green-btn" data-action="mark-all-paid" data-id="${customer.id}" type="button"><i class="fas fa-check-double"></i> Mark All Paid</button>` : ""}
          <button class="red-btn" data-action="delete-customer" data-id="${customer.id}" type="button"><i class="fas fa-trash-alt"></i> Delete Customer</button>
        </div>
      </div>
      <form class="customer-profile" data-action="update-customer" data-id="${customer.id}">
        <input name="name" value="${escapeHtml(customer.name)}" placeholder="Customer name" required>
        <input name="phone" value="${escapeHtml(customer.phone || "")}" placeholder="Phone number">
        <input name="address" value="${escapeHtml(customer.address || "")}" placeholder="Address">
        <textarea name="notes" placeholder="Notes">${escapeHtml(customer.notes || "")}</textarea>
        <button class="green-btn" type="submit"><i class="fas fa-save"></i> Save Customer</button>
      </form>
      ${recordsTable(records, true)}
      <div class="total-row">TOTAL UNPAID UTANG: <strong>${peso(balance)}</strong></div>
      <div class="form-card"><h3>Add New Utang</h3>${utangForm(customer.id)}</div>
      <div class="history-panel"><h3>Payment History</h3>${paymentHistoryTable(history)}</div>`;
  }

  function utangForm(customerId) {
    return `<form data-action="add-utang" data-id="${customerId}">
      <div class="form-grid">
        <select name="productId" required><option value="">Select item...</option>${state.products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)} - ${peso(product.price)}</option>`).join("")}</select>
        <input type="number" name="quantity" value="1" min="1" required>
        <input type="number" name="price" placeholder="Price" min="0.01" step="0.01" required>
        <input type="number" name="total" placeholder="Total" min="0.01" step="0.01" readonly required>
        <button class="green-btn" type="submit"><i class="fas fa-save"></i> Save Utang</button>
      </div>
    </form>`;
  }

  function recordsTable(records, withActions) {
    return `<table class="record-table"><thead><tr><th>Date</th><th>Customer</th><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>${withActions ? "<th>Action</th>" : ""}</tr></thead><tbody>
      ${records.length ? records.map((record) => {
        const customer = customerById(record.customerId);
        const balance = recordBalance(record);
        const status = recordStatus(record);
        return `<tr>
          <td data-label="Date">${niceDate(record.createdAt)}</td>
          <td data-label="Customer">${escapeHtml(customer ? customer.name : "Deleted")}</td>
          <td data-label="Item">${escapeHtml(record.itemName)}</td>
          <td data-label="Qty">${record.quantity}</td>
          <td data-label="Price">${peso(record.price)}</td>
          <td data-label="Total">${peso(record.total)}</td>
          <td data-label="Paid">${peso(record.amountPaid)}</td>
          <td data-label="Balance"><b>${peso(balance)}</b></td>
          <td data-label="Status"><span class="badge ${status.toLowerCase()}">${status}</span></td>
          ${withActions ? `<td data-label="Action"><div class="row-actions">${balance > 0 ? `<button class="action-btn paid-btn" data-action="mark-paid" data-id="${record.id}" type="button"><i class="fas fa-check-circle"></i> Mark Paid</button>` : ""}<button class="action-btn delete-btn" data-action="delete-record" data-id="${record.id}" type="button"><i class="fas fa-trash-alt"></i> Delete</button></div></td>` : ""}
        </tr>`;
      }).join("") : `<tr><td colspan="${withActions ? 10 : 9}">No records found.</td></tr>`}
    </tbody></table>`;
  }

  function paymentHistoryTable(payments) {
    if (!payments.length) return `<p class="empty">No payments yet.</p>`;
    return `<table class="record-table compact-table"><thead><tr><th>Date</th><th>Item</th><th>Amount</th><th>Note</th></tr></thead><tbody>${payments.map((payment) => `<tr><td data-label="Date">${niceDate(payment.createdAt)}</td><td data-label="Item">${escapeHtml(payment.itemName || "-")}</td><td data-label="Amount">${peso(payment.amount)}</td><td data-label="Note">${escapeHtml(payment.note || "-")}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderCustomers() {
    const rows = customerRows();
    view.innerHTML = `<section class="details"><div class="details-head"><h2>Customer Management</h2><button class="blue-btn" data-action="export-customers" type="button"><i class="fas fa-file-csv"></i> Export CSV</button></div>
      <form class="customer-form" data-action="add-customer"><input name="name" placeholder="Customer name" required><input name="phone" placeholder="Phone number"><input name="address" placeholder="Address"><textarea name="notes" placeholder="Notes"></textarea><button class="green-btn" type="submit"><i class="fas fa-plus"></i> New Customer</button></form>
      <input type="text" id="customerSearch" placeholder="Search customer..."><div class="customer-list">${rows.length ? rows.map((customer) => `<button class="customer customer-item" data-action="go-customer" data-id="${customer.id}" type="button"><strong>${escapeHtml(customer.name)}</strong><span>${peso(customer.balance)}</span><small>${escapeHtml([customer.phone, customer.address].filter(Boolean).join(" | ") || "No contact details")}</small></button>`).join("") : `<p class="empty">No customers yet.</p>`}</div></section>`;
    initSearch("#customerSearch", ".customer-item");
  }

  function renderProducts() {
    view.innerHTML = `<section class="products"><div class="products-head"><h3>Product Management</h3><input type="text" id="productSearch" placeholder="Search product..."></div>
      <form class="product-form" data-action="add-product"><input name="name" placeholder="Product name" required><input type="number" name="price" placeholder="Price" step="0.01" min="0.01" required><button class="green-btn" type="submit"><i class="fas fa-plus"></i> Add Product</button></form>
      <div class="product-list">${state.products.map((product) => `<div class="product product-item"><i class="fas fa-box"></i><b>${escapeHtml(product.name)}</b><span>${peso(product.price)}</span><button class="delete-product" data-action="delete-product" data-id="${product.id}" type="button">Delete</button></div>`).join("")}</div></section>`;
    initSearch("#productSearch", ".product-item", "grid");
  }

  function renderRecords() {
    const all = state.records.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    view.innerHTML = `<section class="details"><div class="details-head"><h2>All Utang Records</h2><button class="blue-btn" data-action="export-records" type="button"><i class="fas fa-file-csv"></i> Export All</button></div><input type="text" id="recordSearch" placeholder="Search customer or item...">${recordsTable(all, false)}</section>`;
    initSearch("#recordSearch", ".record-table tbody tr");
  }

  function renderReports() {
    const recent = state.payments.slice().reverse().slice(0, 10);
    view.innerHTML = `<section class="details"><div class="details-head"><h2>Reports</h2><div class="actions"><button class="blue-btn" data-action="export-customers" type="button"><i class="fas fa-users"></i> Customers CSV</button><button class="blue-btn" data-action="export-records" type="button"><i class="fas fa-receipt"></i> Records CSV</button></div></div>
      <div class="chart-grid"><div class="chart-card"><h3>Top Customer Balances</h3><canvas id="balanceChart" class="chart-canvas" width="640" height="320"></canvas></div><div class="chart-card"><h3>Paid vs Unpaid</h3><canvas id="paidChart" class="chart-canvas" width="420" height="320"></canvas></div></div>
      <div class="history-panel"><h3>Recent Payments</h3>${paymentHistoryTable(recent)}</div></section>`;
    requestAnimationFrame(drawReportCharts);
  }

  function renderSettings() {
    view.innerHTML = `<section class="details"><div class="details-head"><h2>Settings</h2><span class="sync-pill">${escapeHtml(getSyncLabel())}</span></div>
      ${backupReminderHtml()}
      <div class="settings-grid">
        <div class="settings-card"><h3>Owner Passcode</h3><p class="empty">Adds a local lock screen for this browser.</p>
          <form class="settings-form" data-action="set-passcode"><input type="password" name="passcode" minlength="4" placeholder="New passcode, minimum 4 characters" required><button class="green-btn" type="submit"><i class="fas fa-lock"></i> Set Passcode</button></form>
          <div class="actions"><button class="blue-btn" data-action="lock-now" type="button">Lock Now</button><button class="red-btn" data-action="clear-passcode" type="button">Remove Passcode</button></div>
        </div>
        <div class="settings-card"><h3>Supabase Cloud Sync</h3><p class="empty">Optional free-tier sync. Local data stays fast; cloud upload is debounced.</p>
          ${cloudMessage ? `<div class="notice-banner compact"><p>${escapeHtml(cloudMessage)}</p></div>` : ""}
          <form class="settings-form" data-action="save-supabase-config">
            <input name="supabaseUrl" value="${escapeHtml(state.settings.supabaseUrl)}" placeholder="Supabase project URL">
            <input name="supabaseAnonKey" value="${escapeHtml(state.settings.supabaseAnonKey)}" placeholder="Supabase anon public key">
            <button class="blue-btn" type="submit">Save Supabase Config</button>
          </form>
          <form class="settings-form two-col" data-action="cloud-auth">
            <input type="email" name="email" placeholder="Owner email" required>
            <input type="password" name="password" placeholder="Password" minlength="6" required>
            <button class="green-btn" name="mode" value="signin" type="submit">Sign In</button>
            <button class="blue-btn" name="mode" value="signup" type="submit">Sign Up</button>
          </form>
          <label class="toggle-line"><input type="checkbox" data-action="toggle-auto-sync" ${state.settings.cloudAutoSync ? "checked" : ""}> Auto sync after changes</label>
          <div class="actions"><button class="green-btn" data-action="cloud-upload" type="button">Upload Local</button><button class="blue-btn" data-action="cloud-download" type="button">Download Cloud</button><button class="red-btn" data-action="cloud-signout" type="button">Sign Out</button></div>
          <p class="empty">Last sync: ${state.settings.cloudLastSync ? niceDate(state.settings.cloudLastSync) : "Never"}</p>
        </div>
        <div class="settings-card"><h3>Backups</h3><p class="empty">Use JSON backups before clearing browser data or changing devices.</p>
          <label class="toggle-line"><input type="checkbox" data-action="toggle-backup-reminder" ${state.settings.backupReminder ? "checked" : ""}> Daily backup reminders</label>
          <div class="actions"><button class="blue-btn" data-action="export-backup" type="button"><i class="fas fa-file-csv"></i> Export JSON Backup</button><button class="green-btn" data-action="import-backup" type="button"><i class="fas fa-save"></i> Import JSON Backup</button><button class="red-btn" data-action="clear-data" type="button"><i class="fas fa-trash-alt"></i> Clear Local Data</button></div>
        </div>
      </div></section>`;
  }

  function emptyState(title, message) {
    return `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function addPayment(record, amount, note) {
    const applied = Math.min(Number(amount || 0), recordBalance(record));
    if (applied <= 0) return 0;
    record.amountPaid = Number(record.amountPaid || 0) + applied;
    state.payments.push({ id: id("pay"), customerId: record.customerId, recordId: record.id, itemName: record.itemName, amount: applied, note: note || "Payment", createdAt: new Date().toISOString() });
    return applied;
  }

  function customerPayment(customerId, amount, note) {
    let remaining = Number(amount || 0);
    openRecords(customerId, false).reverse().forEach((record) => {
      if (remaining <= 0) return;
      const applied = addPayment(record, remaining, note || "Customer payment");
      remaining -= applied;
    });
  }

  function exportableData() {
    return {
      customers: state.customers,
      products: state.products,
      records: state.records,
      payments: state.payments,
      settings: {
        passcodeHash: state.settings.passcodeHash,
        passcodeSalt: state.settings.passcodeSalt,
        backupReminder: state.settings.backupReminder,
        lastBackupDate: state.settings.lastBackupDate
      },
      exportedAt: new Date().toISOString()
    };
  }

  function applyImportedData(imported, options) {
    const currentCloud = {
      supabaseUrl: state.settings.supabaseUrl,
      supabaseAnonKey: state.settings.supabaseAnonKey,
      cloudAutoSync: state.settings.cloudAutoSync,
      cloudLastSync: state.settings.cloudLastSync
    };
    state = normalizeState(imported || {});
    if (options && options.preserveCloud) state.settings = { ...state.settings, ...currentCloud };
    unlocked = !state.settings.passcodeHash || sessionStorage.getItem(UNLOCK_KEY) === "true";
    selectedCustomerId = state.customers[0] ? state.customers[0].id : null;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvValue(value) {
    return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  }

  function exportCustomers() {
    const rows = [["Customer ID", "Name", "Unpaid Balance", "Phone", "Address", "Notes"]].concat(customerRows().map((customer) => [customer.id, customer.name, customer.balance, customer.phone || "", customer.address || "", customer.notes || ""]));
    download("customers.csv", rows.map((row) => row.map(csvValue).join(",")).join("\n"), "text/csv");
  }

  function exportRecords(customerId) {
    const records = customerId ? state.records.filter((record) => record.customerId === customerId) : state.records;
    const rows = [["Record ID", "Customer", "Item", "Qty", "Price", "Total", "Paid", "Balance", "Status", "Date"]].concat(records.map((record) => [record.id, customerById(record.customerId)?.name || "Deleted", record.itemName, record.quantity, record.price, record.total, record.amountPaid || 0, recordBalance(record), recordStatus(record), record.createdAt]));
    download(customerId ? "customer-utang-records.csv" : "utang-records.csv", rows.map((row) => row.map(csvValue).join(",")).join("\n"), "text/csv");
  }

  function exportBackup() {
    state.settings.lastBackupDate = todayKey();
    persistState();
    download("sari-sari-utang-backup.json", JSON.stringify(exportableData(), null, 2), "application/json");
    render();
  }

  function initSearch(inputSelector, itemSelector, displayValue) {
    const input = $(inputSelector);
    if (!input) return;
    input.addEventListener("input", () => {
      const query = input.value.toLowerCase();
      document.querySelectorAll(itemSelector).forEach((item) => {
        item.style.display = item.textContent.toLowerCase().includes(query) ? (displayValue || "") : "none";
      });
    });
  }

  function printReceipt(customerId) {
    const customer = customerById(customerId);
    if (!customer) return;
    const records = openRecords(customerId, false);
    const balance = customerBalance(customerId);
    const rows = records.map((record) => `<tr><td>${escapeHtml(record.itemName)}</td><td>${record.quantity}</td><td>${peso(record.price)}</td><td>${peso(recordBalance(record))}</td></tr>`).join("");
    const receipt = `<!doctype html><html><head><title>Receipt - ${escapeHtml(customer.name)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#172033}.receipt{max-width:720px;margin:auto}.head{border-bottom:2px solid #172033;padding-bottom:12px;margin-bottom:18px}.head h1{margin:0;font-size:26px}.meta{color:#64748b;margin-top:4px}.total{font-size:22px;font-weight:800;text-align:right;margin-top:16px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #dfe5ec;padding:10px;text-align:left}th{background:#f8fafc}.note{margin-top:24px;color:#64748b}@media print{button{display:none}}</style></head><body><main class="receipt"><div class="head"><h1>Sari-Sari Utang Receipt</h1><div class="meta">${new Date().toLocaleString("en-PH")}</div></div><p><strong>Customer:</strong> ${escapeHtml(customer.name)}</p><p><strong>Phone:</strong> ${escapeHtml(customer.phone || "-")}</p><p><strong>Address:</strong> ${escapeHtml(customer.address || "-")}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Balance</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No unpaid utang.</td></tr>`}</tbody></table><div class="total">Total unpaid: ${peso(balance)}</div><p class="note">Please keep this receipt for your records.</p><button onclick="window.print()">Print</button></main></body></html>`;
    const receiptWindow = window.open("", "_blank", "width=840,height=900");
    if (!receiptWindow) {
      alert("Please allow popups to print the receipt.");
      return;
    }
    receiptWindow.document.write(receipt);
    receiptWindow.document.close();
    receiptWindow.focus();
    receiptWindow.print();
  }

  function drawReportCharts() {
    drawBalanceChart();
    drawPaidChart();
  }

  function prepareCanvas(canvas) {
    if (!canvas) return null;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || canvas.width);
    const height = Math.max(240, rect.height || canvas.height);
    const context = canvas.getContext("2d");
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function drawEmptyChart(context, width, height, text) {
    context.fillStyle = "#64748b";
    context.font = "700 14px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2);
  }

  function drawBalanceChart() {
    const setup = prepareCanvas($("#balanceChart"));
    if (!setup) return;
    const { context, width, height } = setup;
    const rows = customerRows().filter((customer) => customer.balance > 0).slice(0, 6);
    if (!rows.length) {
      drawEmptyChart(context, width, height, "No unpaid balances yet");
      return;
    }
    const max = Math.max(...rows.map((customer) => customer.balance));
    const padding = { top: 28, right: 18, bottom: 58, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    context.strokeStyle = "#e5e7eb";
    context.fillStyle = "#64748b";
    context.font = "12px Arial, sans-serif";
    for (let step = 0; step <= 4; step += 1) {
      const y = padding.top + chartHeight - (chartHeight * step / 4);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.textAlign = "right";
      context.fillText(peso(max * step / 4), padding.left - 8, y + 4);
    }
    const slot = chartWidth / rows.length;
    const barWidth = Math.min(64, slot * 0.56);
    rows.forEach((customer, index) => {
      const barHeight = chartHeight * (customer.balance / max);
      const x = padding.left + index * slot + (slot - barWidth) / 2;
      const y = padding.top + chartHeight - barHeight;
      context.fillStyle = "#35a84d";
      context.fillRect(x, y, barWidth, barHeight);
      context.fillStyle = "#172033";
      context.font = "700 12px Arial, sans-serif";
      context.textAlign = "center";
      context.fillText(peso(customer.balance), x + barWidth / 2, y - 7);
      context.save();
      context.translate(x + barWidth / 2, height - padding.bottom + 26);
      context.rotate(-0.35);
      context.fillStyle = "#334155";
      context.font = "12px Arial, sans-serif";
      context.textAlign = "right";
      context.fillText(customer.name.length > 15 ? customer.name.slice(0, 14) + "..." : customer.name, 0, 0);
      context.restore();
    });
  }

  function drawPaidChart() {
    const setup = prepareCanvas($("#paidChart"));
    if (!setup) return;
    const { context, width, height } = setup;
    const summary = totals();
    const total = summary.totalPaid + summary.totalUnpaid;
    if (total <= 0) {
      drawEmptyChart(context, width, height, "No payment data yet");
      return;
    }
    const centerX = width / 2;
    const centerY = height / 2 - 10;
    const radius = Math.min(width, height) * 0.25;
    const lineWidth = Math.max(24, radius * 0.36);
    let angle = -Math.PI / 2;
    [
      { label: "Paid", value: summary.totalPaid, color: "#16803a" },
      { label: "Unpaid", value: summary.totalUnpaid, color: "#dc2626" }
    ].forEach((segment) => {
      if (segment.value <= 0) return;
      const next = angle + (Math.PI * 2 * segment.value / total);
      context.beginPath();
      context.arc(centerX, centerY, radius, angle, next);
      context.strokeStyle = segment.color;
      context.lineWidth = lineWidth;
      context.stroke();
      angle = next;
    });
    context.fillStyle = "#172033";
    context.font = "800 20px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(peso(total), centerX, centerY - 4);
    context.fillStyle = "#64748b";
    context.font = "12px Arial, sans-serif";
    context.fillText("Total recorded", centerX, centerY + 19);
  }

  function ensureCloudClient() {
    const url = state.settings.supabaseUrl.trim();
    const key = state.settings.supabaseAnonKey.trim();
    const nextConfigKey = url + "|" + key;
    if (!url || !key) return null;
    if (!window.supabase) {
      cloudMessage = "Supabase SDK is not available. Check your internet connection, then reload.";
      return null;
    }
    if (cloudClient && cloudConfigKey === nextConfigKey) return cloudClient;
    if (cloudSubscription) cloudSubscription.unsubscribe();
    cloudConfigKey = nextConfigKey;
    cloudClient = window.supabase.createClient(url, key);
    cloudClient.auth.getSession().then(({ data }) => {
      cloudSession = data.session || null;
      render();
    });
    const listener = cloudClient.auth.onAuthStateChange((_event, session) => {
      cloudSession = session;
      render();
    });
    cloudSubscription = listener.data.subscription;
    return cloudClient;
  }

  async function cloudSignIn(email, password, mode) {
    const client = ensureCloudClient();
    if (!client) {
      cloudMessage = cloudMessage.includes("SDK") ? cloudMessage : "Add Supabase URL and anon key first.";
      render();
      return;
    }
    const result = mode === "signup"
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (result.error) cloudMessage = result.error.message;
    else cloudMessage = mode === "signup" ? "Account created. Confirm email if Supabase requires it." : "Signed in to Supabase.";
    const sessionResult = await client.auth.getSession();
    cloudSession = sessionResult.data.session || null;
    render();
  }

  async function uploadCloud() {
    const client = ensureCloudClient();
    if (!client) {
      cloudMessage = cloudMessage.includes("SDK") ? cloudMessage : "Add Supabase URL and anon key first.";
      render();
      return;
    }
    if (!cloudSession) {
      cloudMessage = "Sign in to Supabase before uploading.";
      render();
      return;
    }
    const payload = {
      user_id: cloudSession.user.id,
      data: exportableData(),
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from(CLOUD_TABLE).upsert(payload, { onConflict: "user_id" });
    if (error) {
      cloudMessage = error.message;
      render();
      return;
    }
    state.settings.cloudLastSync = new Date().toISOString();
    cloudMessage = "Local data uploaded to Supabase.";
    saveState({ skipCloud: true });
  }

  async function downloadCloud() {
    const client = ensureCloudClient();
    if (!client) {
      cloudMessage = cloudMessage.includes("SDK") ? cloudMessage : "Add Supabase URL and anon key first.";
      render();
      return;
    }
    if (!cloudSession) {
      cloudMessage = "Sign in to Supabase before downloading.";
      render();
      return;
    }
    const { data, error } = await client.from(CLOUD_TABLE).select("data, updated_at").eq("user_id", cloudSession.user.id).maybeSingle();
    if (error) {
      cloudMessage = error.message;
      render();
      return;
    }
    if (!data || !data.data) {
      cloudMessage = "No cloud snapshot found yet.";
      render();
      return;
    }
    applyImportedData(data.data, { preserveCloud: true });
    state.settings.cloudLastSync = data.updated_at || new Date().toISOString();
    cloudMessage = "Cloud data downloaded to this browser.";
    saveState({ skipCloud: true });
  }

  function scheduleCloudSync() {
    if (!state.settings.cloudAutoSync || !cloudSession) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(uploadCloud, 900);
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-action]");
    if (!form) return;
    event.preventDefault();
    const data = formData(form);
    if (form.dataset.action === "unlock-app") {
      if (await verifyPasscode(data.passcode)) {
        lockMessage = "";
        unlocked = true;
        sessionStorage.setItem(UNLOCK_KEY, "true");
        render();
      } else {
        lockMessage = "Incorrect passcode.";
        renderLock();
      }
      return;
    }
    if (form.dataset.action === "set-passcode") {
      if (data.passcode.length >= 4) await setPasscode(data.passcode);
      return;
    }
    if (form.dataset.action === "save-supabase-config") {
      state.settings.supabaseUrl = data.supabaseUrl.trim();
      state.settings.supabaseAnonKey = data.supabaseAnonKey.trim();
      cloudClient = null;
      cloudMessage = "Supabase config saved.";
      ensureCloudClient();
      saveState({ skipCloud: true });
      return;
    }
    if (form.dataset.action === "cloud-auth") {
      await cloudSignIn(data.email.trim(), data.password, event.submitter.value);
      return;
    }
    if (form.dataset.action === "add-customer") {
      const customer = { id: id("cust"), name: data.name.trim(), phone: data.phone.trim(), address: data.address.trim(), notes: data.notes.trim(), createdAt: new Date().toISOString() };
      state.customers.unshift(customer);
      selectedCustomerId = customer.id;
      location.hash = "dashboard";
    }
    if (form.dataset.action === "update-customer") {
      const customer = customerById(form.dataset.id);
      if (customer) Object.assign(customer, { name: data.name.trim(), phone: data.phone.trim(), address: data.address.trim(), notes: data.notes.trim() });
    }
    if (form.dataset.action === "add-product") state.products.push({ id: id("prod"), name: data.name.trim(), price: Number(data.price || 0) });
    if (form.dataset.action === "add-utang") {
      const product = state.products.find((item) => item.id === data.productId);
      const qty = Number(data.quantity || 1);
      const price = Number(data.price || (product ? product.price : 0));
      state.records.unshift({ id: id("utang"), customerId: form.dataset.id, itemName: product ? product.name : "Item", quantity: qty, price, total: qty * price, amountPaid: 0, createdAt: new Date().toISOString() });
    }
    saveState();
  });

  document.addEventListener("change", (event) => {
    const productSelect = event.target.closest('select[name="productId"]');
    if (productSelect) {
      const form = productSelect.closest("form");
      const product = state.products.find((item) => item.id === productSelect.value);
      if (product && form) {
        form.elements.price.value = Number(product.price).toFixed(2);
        form.elements.total.value = (Number(form.elements.quantity.value || 1) * Number(product.price)).toFixed(2);
      }
    }
    if (event.target.id === "importFile") {
      const file = event.target.files[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          applyImportedData(JSON.parse(text), { preserveCloud: true });
          saveState();
        } catch (error) {
          alert("That backup file could not be imported. Please choose a valid Sari-Sari Utang backup JSON file.");
        }
      }).catch(() => {
        alert("The backup file could not be read. Please try again.");
      });
      event.target.value = "";
    }
    if (event.target.dataset.action === "toggle-auto-sync") {
      state.settings.cloudAutoSync = event.target.checked;
      saveState({ skipCloud: !event.target.checked });
    }
    if (event.target.dataset.action === "toggle-backup-reminder") {
      state.settings.backupReminder = event.target.checked;
      saveState({ skipCloud: true });
    }
  });

  document.addEventListener("input", (event) => {
    const form = event.target.closest('form[data-action="add-utang"]');
    if (form && (event.target.name === "quantity" || event.target.name === "price")) {
      form.elements.total.value = (Number(form.elements.quantity.value || 0) * Number(form.elements.price.value || 0)).toFixed(2);
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.tagName === "FORM") return;
    const action = button.dataset.action;
    if (action === "select-customer") selectedCustomerId = button.dataset.id;
    if (action === "go-customer") { selectedCustomerId = button.dataset.id; location.hash = "dashboard"; }
    if (action === "delete-customer" && confirm("Delete this customer and all related records?")) {
      state.customers = state.customers.filter((customer) => customer.id !== button.dataset.id);
      state.records = state.records.filter((record) => record.customerId !== button.dataset.id);
      state.payments = state.payments.filter((payment) => payment.customerId !== button.dataset.id);
      selectedCustomerId = state.customers[0] ? state.customers[0].id : null;
    }
    if (action === "delete-product" && confirm("Delete this product?")) state.products = state.products.filter((product) => product.id !== button.dataset.id);
    if (action === "delete-record" && confirm("Delete this utang record?")) {
      state.records = state.records.filter((record) => record.id !== button.dataset.id);
      state.payments = state.payments.filter((payment) => payment.recordId !== button.dataset.id);
    }
    if (action === "mark-paid") {
      const record = state.records.find((item) => item.id === button.dataset.id);
      if (record) addPayment(record, recordBalance(record), "Marked fully paid");
    }
    if (action === "mark-all-paid") customerPayment(button.dataset.id, customerBalance(button.dataset.id), "Marked all paid");
    if (action === "prompt-payment") {
      const amount = prompt("Payment amount", customerBalance(button.dataset.id).toFixed(2));
      if (amount) customerPayment(button.dataset.id, amount, "Customer partial payment");
    }
    if (action === "print-receipt" || action === "print") printReceipt(button.dataset.id || selectedCustomerId);
    if (action === "export-customers") exportCustomers();
    if (action === "export-records") exportRecords();
    if (action === "export-customer") exportRecords(button.dataset.id);
    if (action === "export-backup") { exportBackup(); return; }
    if (action === "import-backup") $("#importFile").click();
    if (action === "clear-data" && confirm("Clear all local customers, products, records, and payments?")) {
      state = normalizeState({ settings: state.settings });
      selectedCustomerId = null;
    }
    if (action === "lock-now") {
      if (!state.settings.passcodeHash) alert("Set an owner passcode first in Settings.");
      else {
        sessionStorage.removeItem(UNLOCK_KEY);
        unlocked = false;
        render();
        return;
      }
    }
    if (action === "clear-passcode" && confirm("Remove owner passcode from this browser?")) {
      clearPasscode();
      return;
    }
    if (action === "cloud-upload") { await uploadCloud(); return; }
    if (action === "cloud-download") { await downloadCloud(); return; }
    if (action === "cloud-signout") {
      const client = ensureCloudClient();
      if (client) await client.auth.signOut();
      cloudSession = null;
      cloudMessage = "Signed out of Supabase.";
      render();
      return;
    }
    saveState();
  });

  function initMobileMenu() {
    const btn = $("#mobileMenuBtn");
    const sidebar = $("#sidebar");
    const overlay = $("#sidebarOverlay");
    if (!btn || !sidebar || !overlay) return;
    btn.addEventListener("click", () => { sidebar.classList.toggle("active"); overlay.classList.toggle("active"); });
    overlay.addEventListener("click", () => { sidebar.classList.remove("active"); overlay.classList.remove("active"); });
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("resize", () => { if (getRoute() === "reports") drawReportCharts(); });
  initMobileMenu();
  ensureCloudClient();
  if (!location.hash) location.hash = "dashboard";
  render();
})();
