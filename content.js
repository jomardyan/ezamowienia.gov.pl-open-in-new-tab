(() => {
  const BASE = 'https://ezamowienia.gov.pl/mp-client/tenders/';
  const ROW_SELECTOR = 'tr.tr-link';
  const SETTINGS_KEY = 'ezamSettings';
  const FILTERS_KEY = 'ezamFilters';
  const OPENED_KEY = 'ezamOpenedIds';
  const LIST_PATH_RE = /^\/mp-client\/tenders\/?$/;

  if (!LIST_PATH_RE.test(window.location.pathname)) {
    return;
  }

  const DEFAULTS = {
    linkPlacement: 'cell',
    highlightRows: true,
    showTooltips: true,
    showCopyButtons: true,
    enableMiddleClick: true,
    rowClickOpen: true,
    openInBackground: false,
    showCopyToast: true,
    rememberFilters: true,
    stickyHeader: true,
    showVisited: true
  };

  let settings = { ...DEFAULTS };
  const openedIds = new Set(loadOpenedIds());

  function loadOpenedIds() {
    try {
      const raw = sessionStorage.getItem(OPENED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveOpenedIds() {
    try {
      sessionStorage.setItem(OPENED_KEY, JSON.stringify(Array.from(openedIds)));
    } catch (error) {
      // ignore
    }
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        settings = { ...DEFAULTS };
        resolve();
        return;
      }
      chrome.storage.sync.get(SETTINGS_KEY, (data) => {
        settings = { ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) };
        resolve();
      });
    });
  }

  function saveSettings(next) {
    settings = { ...settings, ...next };
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    }
  }

  function applyGlobalClasses() {
    document.documentElement.classList.toggle('ezam-highlight', settings.highlightRows);
  }

  function extractId(cells, row) {
    if (cells.length >= 2) {
      const id = cells[1].textContent.trim();
      if (id && /^ocds-/.test(id)) return id;
    }

    const fallback = row.textContent.match(/ocds-[a-z0-9-]+/i);
    return fallback ? fallback[0] : '';
  }

  function openInNewTab(url) {
    const opened = window.open(url, '_blank', 'noopener');
    if (opened) opened.opener = null;
  }

  function openWithBackground(url) {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'openTab', url, active: false });
      return true;
    }
    return false;
  }

  function openOffer(url) {
    if (settings.openInBackground) {
      if (openWithBackground(url)) return;
    }
    openInNewTab(url);
  }

  function ensureToastContainer() {
    let toast = document.querySelector('.ezam-toast');
    if (toast) return toast;
    toast = document.createElement('div');
    toast.className = 'ezam-toast';
    document.body.appendChild(toast);
    return toast;
  }

  function showToast(message) {
    if (!settings.showCopyToast) return;
    const toast = ensureToastContainer();
    toast.textContent = message;
    toast.classList.add('ezam-toast--show');
    clearTimeout(toast._ezamTimer);
    toast._ezamTimer = setTimeout(() => {
      toast.classList.remove('ezam-toast--show');
    }, 1600);
  }

  function showActionFeedback(target, message) {
    if (!target) return;
    const original = target.dataset.ezamLabel || target.textContent;
    target.dataset.ezamLabel = original;
    target.textContent = message;
    setTimeout(() => {
      if (target.dataset.ezamIcon) {
        target.textContent = '';
        const icon = document.createElement('i');
        icon.className = 'material-icons ezam-icon';
        icon.textContent = target.dataset.ezamIcon;
        target.appendChild(icon);
      } else {
        target.textContent = target.dataset.ezamLabel || original;
      }
    }, 1000);
  }

  function markOpened(id, row) {
    if (!settings.showVisited) return;
    openedIds.add(id);
    saveOpenedIds();
    if (row) row.classList.add('ezam-opened');
  }

  function applyAnchor(anchor, url, id, row) {
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.classList.add('ezam-open-link');
    anchor.dataset.ezamOfferUrl = url;
    anchor.dataset.ezamOfferId = id;

    if (!anchor.dataset.ezamBound) {
      anchor.dataset.ezamBound = '1';

      // Stop row-level handlers from hijacking the click.
      anchor.addEventListener('click', (event) => {
        event.stopPropagation();
        if (settings.openInBackground && event.button === 0 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          openOffer(url);
        }
        markOpened(id, row);
      });
      anchor.addEventListener('mousedown', (event) => event.stopPropagation(), true);
      anchor.addEventListener('pointerdown', (event) => event.stopPropagation(), true);

      anchor.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const offerUrl = anchor.dataset.ezamOfferUrl;
        if (!offerUrl) return;
        if (event.shiftKey) return;
        event.preventDefault();
        window.location.href = offerUrl;
      });
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (error) {
        document.body.removeChild(textarea);
        reject(error);
      }
    });
  }

  function buildActionButtons(id, url, row) {
    const container = document.createElement('span');
    container.className = 'ezam-actions';

    const copyIdBtn = document.createElement('button');
    copyIdBtn.type = 'button';
    copyIdBtn.className = 'ezam-action-btn btn btn-outline-secondary btn-sm';
    copyIdBtn.title = 'Copy ID';
    copyIdBtn.setAttribute('aria-label', 'Copy ID');
    copyIdBtn.dataset.ezamIcon = 'content_copy';
    const copyIdIcon = document.createElement('i');
    copyIdIcon.className = 'material-icons ezam-icon';
    copyIdIcon.textContent = 'content_copy';
    copyIdBtn.appendChild(copyIdIcon);
    copyIdBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyToClipboard(id)
        .then(() => {
          showToast('ID copied');
          showActionFeedback(copyIdBtn, 'OK');
        })
        .catch(() => showActionFeedback(copyIdBtn, 'Fail'));
    });

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.type = 'button';
    copyLinkBtn.className = 'ezam-action-btn btn btn-outline-secondary btn-sm';
    copyLinkBtn.title = 'Copy link';
    copyLinkBtn.setAttribute('aria-label', 'Copy link');
    copyLinkBtn.dataset.ezamIcon = 'link';
    const copyLinkIcon = document.createElement('i');
    copyLinkIcon.className = 'material-icons ezam-icon';
    copyLinkIcon.textContent = 'link';
    copyLinkBtn.appendChild(copyLinkIcon);
    copyLinkBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyToClipboard(url)
        .then(() => {
          showToast('Link copied');
          showActionFeedback(copyLinkBtn, 'OK');
        })
        .catch(() => showActionFeedback(copyLinkBtn, 'Fail'));
    });

    container.appendChild(copyIdBtn);
    container.appendChild(copyLinkBtn);

    return container;
  }

  function ensureExtraColumn(table) {
    if (!table) return;

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('th.ezam-extra-col')) {
      const th = document.createElement('th');
      th.className = 'ezam-extra-col';
      th.textContent = 'Otworz';
      headerRow.appendChild(th);
    }

    const colgroup = table.querySelector('colgroup');
    if (colgroup && !colgroup.querySelector('col.ezam-extra-col')) {
      const col = document.createElement('col');
      col.className = 'ezam-extra-col';
      colgroup.appendChild(col);
    }
  }

  function removeExtraColumn(table) {
    if (!table) return;
    table.querySelectorAll('th.ezam-extra-col, col.ezam-extra-col').forEach((el) => el.remove());
    table.querySelectorAll('td.ezam-extra-cell').forEach((cell) => cell.remove());
  }

  function ensureHeaderControls(table) {
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow || headerRow.dataset.ezamControlsReady) return;
    headerRow.dataset.ezamControlsReady = '1';

    let toggleCell = headerRow.querySelector('th:last-child');
    if (!toggleCell) {
      toggleCell = document.createElement('th');
      headerRow.appendChild(toggleCell);
    }

    const controls = document.createElement('div');
    controls.className = 'ezam-controls';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ezam-toggle-btn btn btn-outline-secondary btn-sm';

    const updateLabel = () => {
      toggleBtn.textContent = settings.linkPlacement === 'column' ? 'Link: Column' : 'Link: Cell';
      toggleBtn.title = 'Toggle link placement';
    };

    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = settings.linkPlacement === 'column' ? 'cell' : 'column';
      saveSettings({ linkPlacement: next });
      updateLabel();
      refreshRows();
    });

    updateLabel();
    controls.appendChild(toggleBtn);

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'ezam-menu-wrapper';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'ezam-toggle-btn btn btn-outline-secondary btn-sm';
    menuBtn.textContent = 'Options';
    menuBtn.title = 'Toggle options';

    const menu = document.createElement('div');
    menu.className = 'ezam-menu';

    const rowClickBtn = document.createElement('button');
    rowClickBtn.type = 'button';
    rowClickBtn.className = 'ezam-menu-item btn btn-outline-secondary btn-sm';

    const backgroundBtn = document.createElement('button');
    backgroundBtn.type = 'button';
    backgroundBtn.className = 'ezam-menu-item btn btn-outline-secondary btn-sm';

    const updateMenuLabels = () => {
      rowClickBtn.textContent = settings.rowClickOpen ? 'Row click: On' : 'Row click: Off';
      rowClickBtn.title = 'Toggle row click open';
      backgroundBtn.textContent = settings.openInBackground
        ? 'Background tab: On'
        : 'Background tab: Off';
      backgroundBtn.title = 'Toggle background tab';
    };

    rowClickBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      saveSettings({ rowClickOpen: !settings.rowClickOpen });
      updateMenuLabels();
    });

    backgroundBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      saveSettings({ openInBackground: !settings.openInBackground });
      updateMenuLabels();
    });

    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.classList.toggle('ezam-menu--open');
    });

    document.addEventListener('click', () => {
      menu.classList.remove('ezam-menu--open');
    });

    updateMenuLabels();
    menu.appendChild(rowClickBtn);
    menu.appendChild(backgroundBtn);
    menuWrapper.appendChild(menuBtn);
    menuWrapper.appendChild(menu);
    controls.appendChild(menuWrapper);
    toggleCell.appendChild(controls);
  }

  function bindRowInteractions(row, id, url) {
    if (row.dataset.ezamBound) return;
    row.dataset.ezamBound = '1';

    row.addEventListener(
      'click',
      (event) => {
        if (!settings.rowClickOpen) return;
        if (event.button !== 0) return;
        const target = event.target;
        if (
          target.closest(
            'a, button, input, textarea, select, label, .ezam-actions'
          )
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openOffer(url);
        markOpened(id, row);
      },
      true
    );

    row.addEventListener(
      'auxclick',
      (event) => {
        if (!settings.enableMiddleClick) return;
        if (event.button !== 1) return;
        if (event.target.closest('a, button')) return;
        event.preventDefault();
        event.stopPropagation();
        openOffer(url);
        markOpened(id, row);
      },
      true
    );
  }

  function applyTooltips(cells) {
    if (!settings.showTooltips || !cells.length) return;
    const titleCell = cells[0];
    const text = titleCell.textContent.trim();
    if (text && text.length > 60 && !titleCell.title) {
      titleCell.title = text;
    }
  }

  function addLinkToRow(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;

    const id = extractId(cells, row);
    if (!id) return;

    const url = BASE + encodeURIComponent(id);
    row.classList.add('ezam-link-row');
    row.dataset.ezamOfferId = id;
    row.dataset.ezamOfferUrl = url;

    if (settings.showVisited && openedIds.has(id)) {
      row.classList.add('ezam-opened');
    }

    applyTooltips(cells);

    const detailsAnchor = row.querySelector('a:not(.ezam-open-link)');
    if (detailsAnchor) {
      applyAnchor(detailsAnchor, url, id, row);
    }

    if (settings.linkPlacement === 'column') {
      const table = row.closest('table');
      ensureExtraColumn(table);

      let extraCell = row.querySelector('td.ezam-extra-cell');
      if (!extraCell) {
        extraCell = document.createElement('td');
        extraCell.className = 'ezam-extra-cell';
        row.appendChild(extraCell);
      }

      let openLink = extraCell.querySelector('a.ezam-open-link');
      if (!openLink) {
        openLink = document.createElement('a');
        openLink.textContent = 'Otworz';
        extraCell.appendChild(openLink);
      }
      applyAnchor(openLink, url, id, row);

      if (settings.showCopyButtons && !extraCell.querySelector('.ezam-actions')) {
        extraCell.appendChild(buildActionButtons(id, url, row));
      }
    } else {
      const lastCell = row.querySelector('td:last-child') || cells[cells.length - 1];
      let openLink = lastCell.querySelector('a.ezam-open-link');
      if (!openLink && detailsAnchor) {
        openLink = detailsAnchor;
      }
      if (!openLink) {
        openLink = document.createElement('a');
        openLink.textContent = 'Otworz';
        lastCell.appendChild(openLink);
      }
      applyAnchor(openLink, url, id, row);

      if (settings.showCopyButtons && !lastCell.querySelector('.ezam-actions')) {
        lastCell.appendChild(buildActionButtons(id, url, row));
      }
    }

    bindRowInteractions(row, id, url);
  }

  function scanExisting() {
    document.querySelectorAll(ROW_SELECTOR).forEach(addLinkToRow);
  }

  function applyStickyHeader() {
    const table = document.querySelector('#tenderListTable table');
    if (!table) return;
    table.classList.toggle('ezam-sticky', settings.stickyHeader);
  }

  function refreshRows() {
    const table = document.querySelector('#tenderListTable table');
    if (settings.linkPlacement === 'column') {
      ensureExtraColumn(table);
    } else {
      removeExtraColumn(table);
    }

    document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
      row.classList.remove('ezam-opened');
      addLinkToRow(row);
    });
  }

  function getFilterControls(form) {
    const controls = [];
    form.querySelectorAll('[formcontrolname]').forEach((container) => {
      const name = container.getAttribute('formcontrolname');
      const field = container.querySelector('input, textarea, select');
      if (name && field) controls.push({ name, field });
    });
    return controls;
  }

  function restoreFilters(form) {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(FILTERS_KEY, (data) => {
      const stored = data[FILTERS_KEY] || {};
      getFilterControls(form).forEach(({ name, field }) => {
        if (!(name in stored)) return;
        field.value = stored[name];
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  function persistFilters(form) {
    if (!chrome.storage || !chrome.storage.local) return;
    const payload = {};
    getFilterControls(form).forEach(({ name, field }) => {
      payload[name] = field.value;
    });
    chrome.storage.local.set({ [FILTERS_KEY]: payload });
  }

  function setupFilterPersistence() {
    if (!settings.rememberFilters) return;
    const form = document.querySelector('app-tender-filters form');
    if (!form || form.dataset.ezamFiltersReady) return;
    form.dataset.ezamFiltersReady = '1';

    restoreFilters(form);
    getFilterControls(form).forEach(({ field }) => {
      field.addEventListener('input', () => persistFilters(form));
      field.addEventListener('change', () => persistFilters(form));
    });
  }

  function observeChanges() {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches(ROW_SELECTOR)) {
            addLinkToRow(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll(ROW_SELECTOR).forEach(addLinkToRow);
          }
        }
      }

      setupFilterPersistence();
      ensureHeaderControls(document.querySelector('#tenderListTable table'));
      applyStickyHeader();
    }).observe(document.body, { childList: true, subtree: true });
  }

  loadSettings().then(() => {
    applyGlobalClasses();
    scanExisting();
    applyStickyHeader();
    setupFilterPersistence();
    ensureHeaderControls(document.querySelector('#tenderListTable table'));
    observeChanges();
  });
})();
