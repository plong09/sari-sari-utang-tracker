(function () {
  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  function getAppData() {
    const dataElement = document.getElementById("app-data");
    if (!dataElement) return {};

    try {
      return JSON.parse(dataElement.textContent || "{}");
    } catch (error) {
      console.error("Could not parse app data.", error);
      return {};
    }
  }

  function showModal(modal) {
    if (modal) {
      modal.style.display = "block";
    }
  }

  function hideModal(modal) {
    if (modal) {
      modal.style.display = "none";
    }
  }

  function moneyFormat(value) {
    return "\u20B1" + Number(value || 0).toLocaleString();
  }

  function setButtonLoading(button, loadingText) {
    if (!button || button.classList.contains("is-loading")) return;

    button.dataset.originalHtml = button.innerHTML;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;

    button.innerHTML = "";

    const spinner = document.createElement("span");
    const label = document.createElement("span");

    spinner.className = "button-spinner";
    spinner.setAttribute("aria-hidden", "true");
    label.textContent = loadingText;

    button.appendChild(spinner);
    button.appendChild(label);
  }

  function initSubmitLoading() {
    document.querySelectorAll("form").forEach((form) => {
      form.addEventListener("submit", (event) => {
        if (event.defaultPrevented) return;

        const method = (form.getAttribute("method") || "GET").toUpperCase();
        if (method !== "POST") return;

        const submitter = event.submitter || form.querySelector("button[type='submit']");
        if (!submitter || submitter.dataset.noLoading === "true") return;

        const loadingText = submitter.dataset.loadingText || "Saving...";
        setButtonLoading(submitter, loadingText);
      });
    });
  }

  function initMobileMenu() {
    const mobileMenuBtn = document.getElementById("mobileMenuBtn");
    const sidebar = document.getElementById("sidebar");
    const sidebarOverlay = document.getElementById("sidebarOverlay");

    if (!mobileMenuBtn || !sidebar || !sidebarOverlay) return;

    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("active");
      sidebarOverlay.classList.toggle("active");
    });

    sidebarOverlay.addEventListener("click", () => {
      sidebar.classList.remove("active");
      sidebarOverlay.classList.remove("active");
    });
  }

  function initDeleteModal() {
    const deleteModal = document.getElementById("deleteModal");
    const deleteForm = document.getElementById("deleteForm");
    const cancelDeleteBtn = document.getElementById("cancelDelete");

    function openDeleteModal(utangId, customerId) {
      if (!deleteModal || !deleteForm) return;

      deleteForm.action = `/delete-utang/${utangId}/${customerId}`;
      showModal(deleteModal);
    }

    window.openDeleteModal = openDeleteModal;

    document.querySelectorAll(".js-delete-utang-btn").forEach((button) => {
      button.addEventListener("click", () => {
        openDeleteModal(button.dataset.utangId, button.dataset.customerId);
      });
    });

    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener("click", () => hideModal(deleteModal));
    }

    return deleteModal;
  }

  function initPaidModal() {
    const paidModal = document.getElementById("paidModal");
    const paidModalTitle = document.getElementById("paidModalTitle");
    const paidModalMessage = document.getElementById("paidModalMessage");
    const paidForm = document.getElementById("paidForm");
    const confirmPaid = document.getElementById("confirmPaid");
    const cancelPaid = document.getElementById("cancelPaid");

    if (!paidModal || !paidForm) return null;

    document.querySelectorAll(".js-paid-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.paidAction;
        if (!action) return;

        paidForm.action = action;

        if (paidModalTitle) {
          paidModalTitle.textContent = button.dataset.paidTitle || "Mark as paid?";
        }
        if (paidModalMessage) {
          paidModalMessage.textContent = button.dataset.paidMessage ||
            "This will record the remaining balance as a payment.";
        }
        if (confirmPaid) {
          confirmPaid.textContent = button.dataset.paidConfirm || "Mark Paid";
        }

        showModal(paidModal);
      });
    });

    if (cancelPaid) {
      cancelPaid.addEventListener("click", () => hideModal(paidModal));
    }

    return paidModal;
  }

  function initCustomerPaymentModal() {
    const paymentModal = document.getElementById("paymentModal");
    const paymentForm = document.getElementById("paymentForm");
    const paymentCustomerId = document.getElementById("paymentCustomerId");
    const paymentAmount = document.getElementById("paymentAmount");
    const paymentItem = document.getElementById("paymentItem");
    const paymentRemaining = document.getElementById("paymentRemaining");
    const cancelPayment = document.getElementById("cancelPayment");

    if (!paymentModal || !paymentForm || !paymentCustomerId || !paymentAmount) return null;

    function openCustomerPaymentModal(customerId, balance, customerName) {
      const amount = Number(balance || 0);

      paymentForm.action = "/add-customer-payment";
      paymentCustomerId.value = customerId;
      paymentAmount.value = "";
      paymentAmount.max = amount.toFixed(2);
      paymentAmount.placeholder = `Up to \u20B1${amount.toFixed(2)}`;

      if (paymentItem) {
        paymentItem.textContent = `Partial payment for ${customerName}`;
      }
      if (paymentRemaining) {
        paymentRemaining.textContent = `Total unpaid balance: \u20B1${amount.toFixed(2)}`;
      }

      showModal(paymentModal);
      paymentAmount.focus();
    }

    document.querySelectorAll(".js-customer-payment-btn").forEach((button) => {
      button.addEventListener("click", () => {
        openCustomerPaymentModal(
          button.dataset.customerId,
          button.dataset.balance,
          button.dataset.customerName
        );
      });
    });

    if (cancelPayment) {
      cancelPayment.addEventListener("click", () => hideModal(paymentModal));
    }

    return paymentModal;
  }

  function initEditButtons() {
    document.querySelectorAll(".js-edit-utang-btn").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.editUrl) {
          window.location.href = button.dataset.editUrl;
        }
      });
    });
  }

  function initConfirmLinks() {
    document.querySelectorAll(".js-confirm-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        const message = link.dataset.confirm || "Are you sure?";
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      });
    });

    document.querySelectorAll(".js-confirm-form").forEach((form) => {
      form.addEventListener("submit", (event) => {
        const message = form.dataset.confirm || "Are you sure?";
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      });
    });
  }

  function initModalBackdropClose(modals) {
    window.addEventListener("click", (event) => {
      modals.forEach((modal) => {
        if (event.target === modal) {
          hideModal(modal);
        }
      });
    });
  }

  function initUtangTotal() {
    const itemSearch = document.getElementById("itemSearch");
    const itemSearchBtn = document.getElementById("itemSearchBtn");
    const itemSuggestions = document.getElementById("itemSuggestions");
    const itemSelect = document.getElementById("itemSelect");
    const quantityInput = document.getElementById("quantityInput");
    const priceInput = document.getElementById("priceInput");
    const totalInput = document.getElementById("totalInput");

    if (!itemSelect || !quantityInput || !priceInput || !totalInput) return;

    const itemOptions = Array.from(itemSelect.options).map((option) => ({
      value: option.value,
      text: option.textContent.trim(),
      price: option.dataset.price || "",
      placeholder: option.value === ""
    }));
    const productOptions = itemOptions.filter((option) => !option.placeholder);

    function getItemMatches(searchValue) {
      const query = (searchValue || "").trim().toLowerCase();
      if (!query) return productOptions;

      return productOptions.filter((option) => {
        return option.text.toLowerCase().includes(query);
      });
    }

    function renderItemOptions(searchValue) {
      const selectedValue = itemSelect.value;
      const query = (searchValue || "").trim().toLowerCase();
      const matches = itemOptions.filter((option) => {
        return option.placeholder || option.text.toLowerCase().includes(query);
      });

      itemSelect.innerHTML = "";
      matches.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.text;
        if (item.price) {
          option.dataset.price = item.price;
        }
        itemSelect.appendChild(option);
      });

      if (query && matches.length === 1) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No matching item";
        option.disabled = true;
        itemSelect.appendChild(option);
      }

      const stillAvailable = matches.some((item) => item.value === selectedValue);
      itemSelect.value = stillAvailable ? selectedValue : "";
    }

    function selectItem(item) {
      itemSearch.value = item.text;
      renderItemOptions(item.text);
      itemSelect.value = item.value;
      hideItemSuggestions();
      computeTotal();
    }

    function hideItemSuggestions() {
      if (itemSuggestions) {
        itemSuggestions.hidden = true;
      }
    }

    function renderItemSuggestions(searchValue) {
      if (!itemSuggestions) return;

      const query = (searchValue || "").trim();
      const matches = getItemMatches(query).slice(0, 8);
      itemSuggestions.innerHTML = "";

      if (!query) {
        hideItemSuggestions();
        return;
      }

      if (matches.length === 0) {
        const empty = document.createElement("button");
        empty.className = "item-suggestion item-suggestion-empty";
        empty.type = "button";
        empty.disabled = true;
        empty.textContent = "No matching item";
        itemSuggestions.appendChild(empty);
        itemSuggestions.hidden = false;
        return;
      }

      matches.forEach((item) => {
        const button = document.createElement("button");
        const name = document.createElement("span");
        const price = document.createElement("small");

        button.className = "item-suggestion";
        button.type = "button";
        name.textContent = item.text;
        price.textContent = "\u20B1" + Number(item.price || 0).toFixed(2);

        button.appendChild(name);
        button.appendChild(price);
        button.addEventListener("click", () => selectItem(item));
        itemSuggestions.appendChild(button);
      });

      itemSuggestions.hidden = false;
    }

    function computeTotal() {
      const selectedOption = itemSelect.options[itemSelect.selectedIndex];
      const price = parseFloat(selectedOption.getAttribute("data-price")) || 0;
      const quantity = parseInt(quantityInput.value, 10) || 0;
      const total = price * quantity;

      priceInput.value = price ? price.toFixed(2) : "";
      totalInput.value = total ? total.toFixed(2) : "";
    }

    if (itemSearch) {
      itemSearch.addEventListener("input", () => {
        renderItemOptions(itemSearch.value);
        renderItemSuggestions(itemSearch.value);
        computeTotal();
      });

      itemSearch.addEventListener("focus", () => {
        renderItemSuggestions(itemSearch.value);
      });

      itemSearch.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;

        const firstMatch = getItemMatches(itemSearch.value)[0];
        if (firstMatch) {
          event.preventDefault();
          selectItem(firstMatch);
        }
      });
    }

    if (itemSearchBtn) {
      itemSearchBtn.addEventListener("click", () => {
        renderItemOptions(itemSearch ? itemSearch.value : "");
        const firstMatch = getItemMatches(itemSearch ? itemSearch.value : "")[0];

        if (firstMatch) {
          selectItem(firstMatch);
        }

        itemSelect.focus();
      });
    }

    itemSelect.addEventListener("change", () => {
      const selectedOption = itemSelect.options[itemSelect.selectedIndex];
      if (itemSearch && selectedOption && selectedOption.value) {
        itemSearch.value = selectedOption.textContent.trim();
      }
      hideItemSuggestions();
      computeTotal();
    });
    quantityInput.addEventListener("input", computeTotal);

    document.addEventListener("click", (event) => {
      const itemPicker = itemSearch ? itemSearch.closest(".item-picker") : null;
      if (itemPicker && itemPicker.contains(event.target)) return;
      hideItemSuggestions();
    });
  }

  function initListSearch(inputId, itemSelector, visibleDisplay) {
    const searchInput = document.getElementById(inputId);
    const items = document.querySelectorAll(itemSelector);

    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
      const searchValue = searchInput.value.toLowerCase();

      items.forEach((item) => {
        const name = item.textContent.toLowerCase();
        item.style.display = name.includes(searchValue) ? visibleDisplay : "none";
      });
    });
  }

  function initCharts(appData) {
    if (appData.page !== "reports" || typeof Chart === "undefined") return;

    const customerCanvas = document.getElementById("customerChart");
    const paidCanvas = document.getElementById("paidChart");
    const customerNames = appData.customerChartNames || [];
    const customerTotals = appData.customerChartTotals || [];
    const unpaidTotal = appData.totalUtang || 0;
    const paidTotal = appData.totalPaid || 0;

    if (customerCanvas) {
      new Chart(customerCanvas, {
        type: "bar",
        data: {
          labels: customerNames,
          datasets: [{
            label: "Unpaid Balance",
            data: customerTotals,
            backgroundColor: "rgba(53, 168, 77, 0.85)",
            borderColor: "#16803a",
            borderWidth: 1,
            borderRadius: 8,
            barThickness: 55
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return "Unpaid: " + moneyFormat(context.raw);
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function (value) {
                  return "\u20B1" + value;
                }
              }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      });
    }

    if (paidCanvas) {
      new Chart(paidCanvas, {
        type: "doughnut",
        data: {
          labels: ["Unpaid", "Paid"],
          datasets: [{
            data: [unpaidTotal, paidTotal],
            backgroundColor: ["#ef4444", "#35a84d"],
            borderWidth: 4,
            hoverOffset: 10
          }]
        },
        options: {
          responsive: true,
          cutout: "65%",
          plugins: {
            legend: { position: "bottom" },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return context.label + ": " + moneyFormat(context.raw);
                }
              }
            }
          }
        }
      });
    }
  }

  onReady(() => {
    const appData = getAppData();
    const modals = [
      initDeleteModal(),
      initPaidModal(),
      initCustomerPaymentModal()
    ].filter(Boolean);

    initMobileMenu();
    initEditButtons();
    initConfirmLinks();
    initSubmitLoading();
    initModalBackdropClose(modals);
    initUtangTotal();
    initListSearch("customerSearch", ".customer-item", "block");
    initListSearch("productSearch", ".product-item", "grid");
    initCharts(appData);
  });
})();
