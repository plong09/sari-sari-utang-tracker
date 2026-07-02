(function () {
  const KEY = "sariSariUtangTracker.local.v1";
  const DEFAULT_PRODUCTS = [
    { id: "p1", name: "Coke 1.5L", price: 20 },
    { id: "p2", name: "Noodles", price: 15 },
    { id: "p3", name: "Sardines", price: 28 },
    { id: "p4", name: "Bread", price: 10 },
    { id: "p5", name: "Egg", price: 10 }
  ];
  const TITLES = {
    dashboard: ["Store overview", "Dashboard"],
    customers: ["Directory", "Customers"],
    products: ["Inventory", "Products"],
    records: ["Ledger", "Utang Records"],
    reports: ["Insights", "Reports"],
    settings: ["Local storage", "Settings"]
  };

  let state = loadState();
  let selectedCustomerId = state.customers[0] ? state.customers[0].id : null;
  let route = getRoute();

  const $ = (selector) => document.querySelector(selector);
  const view = $("#view");

  function id(prefix) {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        customers: Array.isArray(saved.customers) ? saved.customers : [],
        products: Array.isArray(saved.products) && saved.products.length ? saved.products : DEFAULT_PRODUCTS,
        records: Array.isArray(saved.records) ? saved.records : [],
        payments: Array.isArray(saved.payments) ? saved.payments : []
      };
    } catch (error) {
      return { customers: [], products: DEFAULT_PRODUCTS, records: [], payments: [] };
    }
  }

  function saveState() {
    localStorage.setItem(KEY, JSON.stringify(state));
    render();
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
  }

  function render() {
    updateShell();
    if (route === "customers") renderCustomers();
    else if (route === "products") renderProducts();
    else if (route === "records") renderRecords();
    else if (route === "reports") renderReports();
    else if (route === "settings") renderSettings();
    else renderDashboard();
  }

  function renderDashboard() {
    const rows = customerRows();
    if (!selectedCustomerId && rows[0]) selectedCustomerId = rows[0].id;
    if (selectedCustomerId && !customerById(selectedCustomerId)) selectedCustomerId = rows[0] ? rows[0].id : null;
    const selected = customerById(selectedCustomerId);
    view.innerHTML = `
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
          <button class="print-btn" data-action="print" type="button"><i class="fas fa-print"></i> Print</button>
          <button class="blue-btn" data-action="export-customer" data-id="${customer.id}" type="button"><i class="fas fa-file-csv"></i> Export</button>
          ${balance > 0 ? `<button class="yellow-btn" data-action="prompt-payment" data-id="${customer.id}" type="button"><i class="fas fa-coins"></i> Partial</button><button class="green-btn" data-action="mark-all-paid" data-id="${customer.id}" type="button"><i class="fas fa-check-double"></i> Mark All Paid</button>` : ""}
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
    const rows = customerRows().filter((customer) => customer.balance > 0).slice(0, 8);
    const recent = state.payments.slice().reverse().slice(0, 10);
    view.innerHTML = `<section class="details"><div class="details-head"><h2>Reports</h2><div class="actions"><button class="blue-btn" data-action="export-customers" type="button"><i class="fas fa-users"></i> Customers CSV</button><button class="blue-btn" data-action="export-records" type="button"><i class="fas fa-receipt"></i> Records CSV</button></div></div>
      <div class="chart-grid"><div class="chart-card"><h3>Top Customers with Unpaid Balance</h3>${rows.length ? rows.map((customer) => `<div class="customer"><strong>${escapeHtml(customer.name)}</strong><span>${peso(customer.balance)}</span></div>`).join("") : `<p class="empty">No unpaid balances yet.</p>`}</div><div class="chart-card"><h3>Recent Payments</h3>${paymentHistoryTable(recent)}</div></div></section>`;
  }

  function renderSettings() {
    view.innerHTML = `<section class="details"><div class="details-head"><h2>Local Data</h2></div><p class="empty">Data is saved in this browser only. Export backups regularly before clearing browser data or moving devices.</p><div class="actions" style="margin-top:16px"><button class="blue-btn" data-action="export-backup" type="button"><i class="fas fa-file-csv"></i> Export JSON Backup</button><button class="green-btn" data-action="import-backup" type="button"><i class="fas fa-save"></i> Import JSON Backup</button><button class="red-btn" data-action="clear-data" type="button"><i class="fas fa-trash-alt"></i> Clear Local Data</button></div></section>`;
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

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-action]");
    if (!form) return;
    event.preventDefault();
    const data = formData(form);
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
    if (form.dataset.action === "add-product") {
      state.products.push({ id: id("prod"), name: data.name.trim(), price: Number(data.price || 0) });
    }
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
        const imported = JSON.parse(text);
        state = { customers: imported.customers || [], products: imported.products || DEFAULT_PRODUCTS, records: imported.records || [], payments: imported.payments || [] };
        selectedCustomerId = state.customers[0] ? state.customers[0].id : null;
        saveState();
      });
      event.target.value = "";
    }
  });

  document.addEventListener("input", (event) => {
    const form = event.target.closest('form[data-action="add-utang"]');
    if (form && (event.target.name === "quantity" || event.target.name === "price")) {
      form.elements.total.value = (Number(form.elements.quantity.value || 0) * Number(form.elements.price.value || 0)).toFixed(2);
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.tagName === "FORM") return;
    const action = button.dataset.action;
    if (action === "select-customer") selectedCustomerId = button.dataset.id;
    if (action === "go-customer") { selectedCustomerId = button.dataset.id; location.hash = "dashboard"; }
    if (action === "delete-product" && confirm("Delete this product?")) state.products = state.products.filter((product) => product.id !== button.dataset.id);
    if (action === "delete-record" && confirm("Delete this utang record?")) state.records = state.records.filter((record) => record.id !== button.dataset.id);
    if (action === "mark-paid") {
      const record = state.records.find((item) => item.id === button.dataset.id);
      if (record) addPayment(record, recordBalance(record), "Marked fully paid");
    }
    if (action === "mark-all-paid") customerPayment(button.dataset.id, customerBalance(button.dataset.id), "Marked all paid");
    if (action === "prompt-payment") {
      const amount = prompt("Payment amount", customerBalance(button.dataset.id).toFixed(2));
      if (amount) customerPayment(button.dataset.id, amount, "Customer partial payment");
    }
    if (action === "print") window.print();
    if (action === "export-customers") exportCustomers();
    if (action === "export-records") exportRecords();
    if (action === "export-customer") exportRecords(button.dataset.id);
    if (action === "export-backup") download("sari-sari-utang-backup.json", JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), "application/json");
    if (action === "import-backup") $("#importFile").click();
    if (action === "clear-data" && confirm("Clear all local customers, products, records, and payments?")) {
      state = { customers: [], products: DEFAULT_PRODUCTS, records: [], payments: [] };
      selectedCustomerId = null;
    }
    saveState();
  });

  function initMobileMenu() {
    const btn = $("#mobileMenuBtn");
    const sidebar = $("#sidebar");
    const overlay = $("#sidebarOverlay");
    btn.addEventListener("click", () => { sidebar.classList.toggle("active"); overlay.classList.toggle("active"); });
    overlay.addEventListener("click", () => { sidebar.classList.remove("active"); overlay.classList.remove("active"); });
  }

  window.addEventListener("hashchange", render);
  initMobileMenu();
  if (!location.hash) location.hash = "dashboard";
  render();
})();
