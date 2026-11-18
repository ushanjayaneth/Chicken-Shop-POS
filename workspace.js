(() => {
  "use strict";

  const icons = {
    pos: '<path d="M3 3h2l2 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    inventory: '<path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10M7.5 5l9 4"/>',
    barcodes: '<path d="M3 4v16M6 4v16M10 4v16M13 4v16M15 4v16M19 4v16M21 4v16"/>',
    loans: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>',
    returns: '<path d="M3 9h12a6 6 0 0 1 0 12h-3M3 9l5-5M3 9l5 5"/>',
    coconut: '<path d="M19.5 4.5c-5.5-2-11.4.1-14 4.2-3.4 5.2-.9 11 4.5 11.8 5.3.8 11-5.8 9.5-16Z"/><path d="M6 9c3 1 6 4 7 8M9 5c3 1 6 4 7 7"/>',
    dayend: '<path d="M4 4v16h17M9 15v-4M14 15V7M19 15v-7"/>',
    admin: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    settings: '<path d="m10 3-.7 2.3-2 .9L5 5.5l-2 3.4 1.7 1.8v2.6L3 15.1l2 3.4 2.3-.7 2 .9L10 21h4l.7-2.3 2-.9 2.3.7 2-3.4-1.7-1.8v-2.6L21 8.9l-2-3.4-2.3.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    camera: '<path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
    processing: '<path d="m14 4 6 6M4 20l9-9M10 4l4-1 7 7-1 4M3 17l4 4M15 15l5 5M16 16l2-2"/>',
    payroll: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 8M22 21v-3a7 7 0 0 0-4-6"/>',
    sale: '<path d="M3 7h18v13H3ZM3 7l2-4h14l2 4M8 11v2a4 4 0 0 0 8 0v-2"/>',
    buy: '<path d="M3 3h2l2 12h11l3-9H6M12 6v6M9 9h6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>'
  };
  const pages = {
    pos: { label: "Point of Sale", nav: "Point of Sale" },
    inventory: { label: "Inventory", nav: "Inventory" },
    barcodes: { label: "Barcodes", nav: "Barcodes" },
    loans: { label: "Loans & Customers", nav: "Loans & Customers" },
    returns: { label: "Returns", nav: "Returns" },
    coconut: { label: "Coconut Business", nav: "Coconut Business" },
    dayend: { label: "Day-End Summary", nav: "Day-End Summary" },
    admin: { label: "Administration", nav: "Administration" }
  };
  const coconutTabs = {
    summary: { label: "Summary & Reports", icon: "dayend" },
    buy: { label: "Purchases", icon: "buy" },
    processing: { label: "Processing", icon: "processing" },
    sale: { label: "Sales", icon: "sale" },
    payroll: { label: "Workers & Payroll", icon: "payroll" }
  };
  const fieldLabels = {
    posSearch: "Search products",
    barcodeInput: "Scan or enter a barcode",
    invSearch: "Search inventory",
    coconutDate: "Coconut business date",
    dayendDate: "Day-end date",
    ccPLStartDate: "Report start date",
    ccPLEndDate: "Report end date",
    adminPeriod: "Dashboard period",
    billSearchInput: "Search sales by bill ID",
    retBillSearch: "Sale bill ID",
    returnSearch: "Search supplier returns",
    pinInput: "Admin PIN"
  };

  let framePending = false;
  let fieldSequence = 0;
  let dialogSequence = 0;
  let activeDialog = null;
  let returnFocus = null;
  let sidebarWasOpen = false;
  const desktop = window.matchMedia("(min-width: 1100px)");

  function icon(name) {
    return `<svg class="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name] || icons.pos}</svg>`;
  }

  function decorateNavigation() {
    document.querySelectorAll(".nav-tab[data-tab]").forEach((tab) => {
      const page = pages[tab.dataset.tab];
      if (!page || tab.dataset.workspaceDecorated) return;
      tab.innerHTML = icon(tab.dataset.tab) + `<span>${page.nav}</span>`;
      tab.dataset.workspaceDecorated = "true";
    });
    Object.entries(coconutTabs).forEach(([key, value]) => {
      const tab = document.getElementById(`ccTab_${key}`);
      if (!tab || tab.dataset.workspaceDecorated) return;
      tab.innerHTML = icon(value.icon) + `<span>${value.label}</span>`;
      tab.dataset.workspaceDecorated = "true";
      tab.setAttribute("aria-controls", `ccSection_${key}`);
    });
  }

  function enhanceControls() {
    document.querySelectorAll(".nav-tab, .cat-chip, .opt-tab, .item-card, .sale-type-card, .mobile-cart-btn, .lc-item[onclick], div.mobile-only[onclick]").forEach((control) => {
      control.setAttribute("role", "button");
      control.tabIndex = 0;
      if (control.classList.contains("item-card")) {
        const name = control.querySelector(".item-card-name")?.textContent.trim();
        if (name) control.setAttribute("aria-label", `${control.classList.contains("out-stock") ? "Out of stock" : "Add to cart"} ${name}`);
      }
      if (control.classList.contains("cat-chip") || control.classList.contains("opt-tab")) {
        control.setAttribute("aria-pressed", String(control.classList.contains("active")));
      }
    });
    document.querySelectorAll(".nav-tab[data-tab]").forEach((tab) => {
      if (tab.classList.contains("active")) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    document.querySelectorAll("input, select, textarea").forEach((control) => {
      if (control.type === "hidden") return;
      if (!control.id) control.id = `workspace-field-${++fieldSequence}`;
      if (!control.name) control.name = control.id;
      const group = control.closest(".form-group");
      const label = group?.querySelector("label");
      if (label && !label.htmlFor) label.htmlFor = control.id;
      if (!control.hasAttribute("aria-label") && !document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) {
        const fallback = fieldLabels[control.id] || control.placeholder?.replace(/^[\p{Extended_Pictographic}\s]+/u, "").replace(/\.{3}/g, "").trim() || control.id.replace(/([a-z])([A-Z])/g, "$1 $2");
        control.setAttribute("aria-label", fallback);
      }
      if (!control.autocomplete) control.autocomplete = control.type === "password" ? "current-password" : "off";
      if (control.type === "number" && !control.inputMode) control.inputMode = control.step === "1" || control.step === "" ? "numeric" : "decimal";
      if (/phone/i.test(control.id) && control.type === "text") control.inputMode = "tel";
      if (/barcode|search|pin/i.test(control.id)) control.spellcheck = false;
    });
    document.querySelectorAll("button").forEach((button) => {
      if (!button.hasAttribute("type")) button.type = "button";
      if (button.hasAttribute("aria-label")) return;
      let label = button.title;
      if (button.classList.contains("modal-x")) label = "Close dialog";
      if (button.classList.contains("menu-btn")) label = "Open navigation";
      if (button.classList.contains("cart-item-del")) label = `Remove ${button.closest(".cart-item")?.querySelector(".cart-item-name")?.textContent.trim() || "item"} from cart`;
      if (button.classList.contains("qty-btn")) {
        const action = /[+＋]/.test(button.textContent) ? "Increase" : "Decrease";
        const item = button.closest(".cart-item")?.querySelector(".cart-item-name")?.textContent.trim() || "item";
        label = `${action} ${item} quantity`;
      }
      if (label) button.setAttribute("aria-label", label);
    });
    document.querySelectorAll(".item-img-wrap img, .item-thumb img").forEach((image) => {
      if (!image.hasAttribute("width")) image.width = 240;
      if (!image.hasAttribute("height")) image.height = 180;
    });
    document.querySelectorAll("#coconutTab table").forEach((table) => {
      if (table.parentElement.classList.contains("workspace-table-scroll")) return;
      const scroll = document.createElement("div");
      scroll.className = "workspace-table-scroll";
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      const heading = table.closest(".admin-section")?.querySelector("h3")?.textContent.trim();
      scroll.setAttribute("aria-label", heading || "Coconut business records");
      table.before(scroll);
      scroll.append(table);
    });
  }

  function visibleFocusTargets(container) {
    return [...container.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length && !element.closest("[inert]"));
  }

  function updateShell() {
    const selected = document.querySelector(".tab-panel.active");
    const pageKey = selected?.id.replace(/Tab$/, "") || "pos";
    if (document.body.dataset.workspace !== pageKey) document.body.dataset.workspace = pageKey;
    const title = document.getElementById("workspacePageTitle");
    const pageTitle = pages[pageKey]?.label || "Mr. Chicken House";
    if (title && title.textContent !== pageTitle) title.textContent = pageTitle;
    const sync = document.getElementById("syncDot");
    const status = document.getElementById("workspaceSyncText");
    if (sync && status) {
      const labels = {connected:"Cloud connected", pending:"Sync pending", syncing:"Syncing", offline:"Cloud offline", error:"Cloud unavailable", conflict:"Sync needs review"};
      const label = labels[sync.dataset.state] || labels.pending;
      if (status.textContent !== label) status.textContent = label;
      status.parentElement.title = sync.title;
      const network = document.getElementById("workspaceNetwork");
      if (network) {
        const online = navigator.onLine !== false;
        network.dataset.online = String(online);
        const networkLabel = online ? "Online" : "Offline";
        if (network.lastElementChild.textContent !== networkLabel) network.lastElementChild.textContent = networkLabel;
      }
    }
    const sidebar = document.getElementById("sidebar");
    const menu = document.querySelector(".menu-btn");
    const sidebarOpen = !desktop.matches && sidebar?.classList.contains("show");
    if (sidebar) {
      sidebar.inert = !desktop.matches && !sidebarOpen;
      sidebar.setAttribute("aria-hidden", String(!desktop.matches && !sidebarOpen));
    }
    if (menu) {
      menu.setAttribute("aria-expanded", String(Boolean(sidebarOpen)));
      menu.setAttribute("aria-controls", "sidebar");
    }
    if (sidebarOpen && !sidebarWasOpen) visibleFocusTargets(sidebar)[0]?.focus({ preventScroll: true });
    if (!sidebarOpen && sidebarWasOpen && sidebar?.contains(document.activeElement)) menu?.focus({ preventScroll: true });
    sidebarWasOpen = Boolean(sidebarOpen);
    const openOverlay = [...document.querySelectorAll(".overlay.open")].at(-1);
    const nextDialog = openOverlay?.querySelector(".modal") || null;
    if (nextDialog !== activeDialog) {
      if (nextDialog) {
        if (!activeDialog) returnFocus = document.activeElement;
        if (!nextDialog.contains(document.activeElement)) {
          const first = visibleFocusTargets(nextDialog)[0] || nextDialog;
          first.focus({ preventScroll: true });
        }
      } else if (activeDialog && returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
        returnFocus = null;
      }
      activeDialog = nextDialog;
    }
    document.querySelectorAll(".overlay").forEach((overlay) => {
      const modal = overlay.querySelector(".modal");
      if (!modal) return;
      overlay.setAttribute("aria-hidden", String(!overlay.classList.contains("open")));
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.tabIndex = -1;
      const heading = modal.querySelector(".modal-title");
      if (heading) {
        if (!heading.id) heading.id = `workspace-dialog-title-${++dialogSequence}`;
        modal.setAttribute("aria-labelledby", heading.id);
      }
    });
  }

  function refresh() {
    framePending = false;
    decorateNavigation();
    enhanceControls();
    updateShell();
  }

  function scheduleRefresh() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(refresh);
  }

  function initialize() {
    if (document.body.dataset.workspaceReady) return;
    document.body.dataset.workspaceReady = "true";
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = "#101211";
    const skip = document.createElement("a");
    skip.className = "workspace-skip-link";
    skip.href = "#content";
    skip.textContent = "Skip to workspace";
    document.body.prepend(skip);
    const content = document.getElementById("content");
    content?.setAttribute("role", "main");
    if (content) content.tabIndex = -1;
    const sidebar = document.getElementById("sidebar");
    sidebar?.setAttribute("role", "navigation");
    sidebar?.setAttribute("aria-label", "Main navigation");
    const brand = sidebar?.querySelector(".nav-brand");
    if (brand) brand.innerHTML = 'Mr. Chicken House<span class="workspace-brand-sub">Business management</span>';
    const topBrand = document.querySelector("#nav > .nav-brand");
    if (topBrand) {
      [...topBrand.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => node.remove());
    }
    const heading = document.createElement("div");
    heading.className = "workspace-page-heading";
    heading.innerHTML = '<h1 id="workspacePageTitle">Point of Sale</h1>';
    topBrand?.after(heading);
    document.querySelectorAll('linearGradient[id^="rcm"] stop').forEach((stop, index) => {
      stop.setAttribute("stop-color", index % 2 ? "#d7a94f" : "#eac06e");
    });
    document.querySelectorAll('rect[stroke^="url(#rcm"]').forEach((rect) => rect.setAttribute("fill", "#1c211a"));
    const settingsButton = document.querySelector('#nav button[title="Settings"]');
    if (settingsButton) settingsButton.innerHTML = icon("settings");
    const cameraButton = document.querySelector(".barcode-cam-btn");
    if (cameraButton) cameraButton.innerHTML = icon("camera");
    const searchIcon = document.querySelector(".pos-search-icon");
    if (searchIcon) searchIcon.innerHTML = icon("search");
    const search = document.getElementById("posSearch");
    if (search) search.placeholder = "Search products…";
    const barcode = document.getElementById("barcodeInput");
    if (barcode) barcode.placeholder = "Scan barcode…";
    const sync = document.getElementById("syncDot");
    if (sync) {
      const status = document.createElement("div");
      status.className = "workspace-status";
      status.setAttribute("role", "status");
      sync.before(status);
      const network = document.createElement("span");
      network.id = "workspaceNetwork";
      network.className = "workspace-status-row";
      network.innerHTML = '<i class="workspace-network-dot" aria-hidden="true"></i><span></span>';
      status.append(network);
      const cloud = document.createElement("span");
      cloud.className = "workspace-status-row";
      cloud.append(sync);
      status.append(cloud);
      const text = document.createElement("span");
      text.id = "workspaceSyncText";
      cloud.append(text);
    }
    document.getElementById("toasts")?.setAttribute("aria-live", "polite");
    document.getElementById("toasts")?.setAttribute("aria-atomic", "false");
    document.querySelectorAll("#coconutTab, #dayendTab").forEach((panel) => panel.children[1]?.classList.add("workspace-scroll"));
    document.querySelector("#ccSection_summary > div:not(.stats-row)")?.classList.add("workspace-summary-columns");
    document.querySelector("#ccSection_processing > div:first-child")?.classList.add("workspace-processing-grid");
    document.querySelector("#ccSection_processing > .admin-section > div")?.classList.add("workspace-processing-logs");
    const coconutHeading = document.querySelector("#coconutTab .inv-bar h2");
    if (coconutHeading) coconutHeading.textContent = "Business Overview";
    const sidebarClose = document.querySelector(".sidebar-head > button");
    if (sidebarClose) {
      sidebarClose.innerHTML = icon("close");
      sidebarClose.setAttribute("aria-label", "Close navigation");
    }
    refresh();
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => mutation.target.parentElement?.closest("#clock"))) return;
      scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "title"] });
    desktop.addEventListener("change", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    window.addEventListener("offline", scheduleRefresh);
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if ((event.key === "Enter" || event.key === " ") && target.matches('[role="button"]') && !target.matches("button, input, select, textarea, a")) {
        event.preventDefault();
        target.click();
        return;
      }
      if (event.key !== "Tab") return;
      const trap = activeDialog || (!desktop.matches && sidebarWasOpen ? sidebar : null);
      if (!trap) return;
      const targets = visibleFocusTargets(trap);
      if (!targets.length) {
        event.preventDefault();
        trap.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (target === first || !trap.contains(target))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (target === last || !trap.contains(target))) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
