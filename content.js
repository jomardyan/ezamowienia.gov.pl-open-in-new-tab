(() => {
  const BASE = 'https://ezamowienia.gov.pl/mp-client/tenders/';
  const ROW_SELECTOR = 'tr.tr-link';
  const SETTINGS_KEY = 'ezamSettings';
  const FILTERS_KEY = 'ezamFilters';
  const PRESETS_KEY = 'ezamFilterPresets';
  const OPENED_KEY = 'ezamOpenedIds';
  const SCROLL_KEY = 'ezamScrollState';
  const LIST_PATH_RE = /^\/mp-client\/(tenders|search\/list)\/?$/;
  const LOCALES = ['en', 'pl'];
  const COMPACT_MAX_WIDTH = 1920;

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
    showVisited: true,
    quickJump: true,
    keyboardNav: true,
    inlineExpand: true,
    showBadges: true,
    rememberScroll: true,
    showMiniToolbar: true,
    multiSelect: true,
    freezeColumns: 1,
    closingSoonDays: 3,
    language: 'en',
    toolbarMinimized: true
  };

  let settings = { ...DEFAULTS };
  const openedIds = new Set(loadOpenedIds());
  const selectedIds = new Set();
  let rowCursor = -1;
  let toolbar = null;
  let messages = {};
  let currentLanguage = 'en';
  let t = (key, fallback) => fallback || key;
  let compactColumns = false;
  let compactTimer = null;

  function detectLanguage() {
    const ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || '';
    const lang = (ui || navigator.language || '').toLowerCase();
    return lang.startsWith('pl') ? 'pl' : 'en';
  }

  function normalizeLanguage(language) {
    return language && language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
  }

  function formatMessage(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        return String(vars[key]);
      }
      return match;
    });
  }

  function translate(key, fallback, vars) {
    const entry = messages[key];
    const value = entry && entry.message ? entry.message : fallback || key;
    return formatMessage(value, vars);
  }

  async function loadMessages(language) {
    const normalized = normalizeLanguage(language);
    if (!LOCALES.includes(normalized)) return;

    currentLanguage = normalized;
    try {
      const url = chrome.runtime.getURL(`_locales/${normalized}/messages.json`);
      const response = await fetch(url);
      messages = await response.json();
    } catch (error) {
      messages = {};
    }

    t = translate;
  }

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
        settings = { ...DEFAULTS, language: detectLanguage() };
        resolve(settings);
        return;
      }
      chrome.storage.sync.get(SETTINGS_KEY, (data) => {
        const stored = data[SETTINGS_KEY] || {};
        const resolvedLanguage = normalizeLanguage(stored.language || detectLanguage());
        settings = { ...DEFAULTS, ...stored, language: resolvedLanguage };
        resolve(settings);
      });
    });
  }

  function rebuildUiForLanguage() {
    document.querySelectorAll('.ezam-expand-row').forEach((row) => row.remove());
    document.querySelectorAll('.ezam-actions').forEach((node) => node.remove());
    document.querySelectorAll('.ezam-select').forEach((node) => node.remove());
    document.querySelectorAll('.ezam-expand-toggle').forEach((node) => node.remove());

    const table = document.querySelector('#tenderListTable table');
    if (table && settings.linkPlacement === 'column') {
      removeExtraColumn(table);
    }

    refreshRows();

    const headerRow = table ? table.querySelector('thead tr') : null;
    if (headerRow) {
      headerRow.querySelectorAll('.ezam-controls').forEach((node) => node.remove());
      delete headerRow.dataset.ezamControlsReady;
      ensureHeaderControls(table);
    }

    if (toolbar) {
      toolbar.remove();
      toolbar = null;
      ensureToolbar();
      updateToolbarSelection();
    }
  }

  function handleSettingsUpdate(next) {
    const prevLanguage = settings.language;
    settings = { ...settings, ...next };
    if (next && Object.prototype.hasOwnProperty.call(next, 'language')) {
      settings.language = normalizeLanguage(next.language);
    }

    if (settings.language !== prevLanguage) {
      loadMessages(settings.language).then(() => {
        t = translate;
        rebuildUiForLanguage();
      });
    }
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

  function shouldCompactColumns() {
    return window.innerWidth <= COMPACT_MAX_WIDTH;
  }

  function isInlineExpandEnabled() {
    return settings.inlineExpand || compactColumns;
  }

  function applyCompactColumns() {
    const next = shouldCompactColumns();
    const changed = next !== compactColumns;
    compactColumns = next;
    document.documentElement.classList.toggle('ezam-compact-columns', compactColumns);
    if (changed) {
      refreshRows();
    }
  }

  function extractId(cells, row) {
    for (const cell of cells) {
      const text = cell.textContent.trim();
      if (/^ocds-/.test(text)) return text;
    }

    const fallback = row.textContent.match(/ocds-[a-z0-9-]+/i);
    return fallback ? fallback[0] : '';
  }

  function openInNewTab(url) {
    const opened = window.open(url, '_blank', 'noopener');
    if (opened) opened.opener = null;
  }

  function openWithBackground(url, active) {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'openTab', url, active: Boolean(active) });
      return true;
    }
    return false;
  }

  function openOffer(url, overrides = {}) {
    const useBackground = overrides.background ?? settings.openInBackground;
    if (useBackground) {
      if (openWithBackground(url, false)) return;
    }
    openInNewTab(url);
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
        if (event.shiftKey) {
          event.preventDefault();
          openOffer(offerUrl, { background: true });
          return;
        }
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

  function buildActionButtons(id, url) {
    const container = document.createElement('span');
    container.className = 'ezam-actions';

    const copyIdBtn = document.createElement('button');
    copyIdBtn.type = 'button';
    copyIdBtn.className = 'ezam-action-btn btn btn-outline-secondary btn-sm';
    copyIdBtn.title = t('copyId', 'Copy ID');
    copyIdBtn.setAttribute('aria-label', t('copyId', 'Copy ID'));
    copyIdBtn.dataset.ezamIcon = 'content_copy';
    const copyIdIcon = document.createElement('i');
    copyIdIcon.className = 'material-icons ezam-icon';
    copyIdIcon.textContent = 'content_copy';
    copyIdBtn.appendChild(copyIdIcon);

    copyIdBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyToClipboard(id)
        .then(() => {
          showToast(t('idCopied', 'ID copied'));
          showActionFeedback(copyIdBtn, t('actionOk', 'OK'));
        })
        .catch(() => showActionFeedback(copyIdBtn, t('actionFail', 'Fail')));
    });

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.type = 'button';
    copyLinkBtn.className = 'ezam-action-btn btn btn-outline-secondary btn-sm';
    copyLinkBtn.title = t('copyLink', 'Copy link');
    copyLinkBtn.setAttribute('aria-label', t('copyLink', 'Copy link'));
    copyLinkBtn.dataset.ezamIcon = 'link';
    const copyLinkIcon = document.createElement('i');
    copyLinkIcon.className = 'material-icons ezam-icon';
    copyLinkIcon.textContent = 'link';
    copyLinkBtn.appendChild(copyLinkIcon);

    copyLinkBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyToClipboard(url)
        .then(() => {
          showToast(t('linkCopied', 'Link copied'));
          showActionFeedback(copyLinkBtn, t('actionOk', 'OK'));
        })
        .catch(() => showActionFeedback(copyLinkBtn, t('actionFail', 'Fail')));
    });

    container.appendChild(copyIdBtn);
    container.appendChild(copyLinkBtn);

    return container;
  }

  function buildExpandButton(row, detailsRow) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ezam-action-btn btn btn-outline-secondary btn-sm';
    button.title = t('toggleDetails', 'Toggle details');
    button.setAttribute('aria-label', t('toggleDetails', 'Toggle details'));
    button.textContent = t('more', 'More');

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      detailsRow.classList.toggle('ezam-expand-row--open');
      button.textContent = detailsRow.classList.contains('ezam-expand-row--open')
        ? t('less', 'Less')
        : t('more', 'More');
    });

    return button;
  }

  function buildSelectCheckbox(id) {
    const wrapper = document.createElement('span');
    wrapper.className = 'ezam-select';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ezam-select-box';
    checkbox.checked = selectedIds.has(id);

    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      updateToolbarSelection();
    });

    wrapper.appendChild(checkbox);
    return wrapper;
  }

  function ensureExtraColumn(table) {
    if (!table) return;

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('th.ezam-extra-col')) {
      const th = document.createElement('th');
      th.className = 'ezam-extra-col';
      th.textContent = t('openLink', 'Open');
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
      toggleBtn.textContent =
        settings.linkPlacement === 'column'
          ? t('linkPlacementColumnLabel', 'Link: Column')
          : t('linkPlacementCellLabel', 'Link: Cell');
      toggleBtn.title = t('toggleLinkPlacement', 'Toggle link placement');
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
    menuBtn.textContent = t('optionsButton', 'Options');
    menuBtn.title = t('toggleOptions', 'Toggle options');

    const menu = document.createElement('div');
    menu.className = 'ezam-menu';

    const rowClickBtn = document.createElement('button');
    rowClickBtn.type = 'button';
    rowClickBtn.className = 'ezam-menu-item btn btn-outline-secondary btn-sm';

    const backgroundBtn = document.createElement('button');
    backgroundBtn.type = 'button';
    backgroundBtn.className = 'ezam-menu-item btn btn-outline-secondary btn-sm';

    const updateMenuLabels = () => {
      rowClickBtn.textContent = settings.rowClickOpen
        ? t('rowClickOn', 'Row click: On')
        : t('rowClickOff', 'Row click: Off');
      rowClickBtn.title = t('toggleRowClick', 'Toggle row click open');
      backgroundBtn.textContent = settings.openInBackground
        ? t('backgroundTabOn', 'Background tab: On')
        : t('backgroundTabOff', 'Background tab: Off');
      backgroundBtn.title = t('toggleBackgroundTab', 'Toggle background tab');
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
            'a, button, input, textarea, select, label, .ezam-actions, .ezam-select'
          )
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        saveScrollState();
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
        saveScrollState();
        openOffer(url, { background: true });
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

  function parsePolishDate(text) {
    if (!text) return null;
    const cleaned = text.replace(/,/g, '').replace(/godz/g, '').trim();
    const parts = cleaned.split(/\s+/);
    if (parts.length < 4) return null;
    const day = Number(parts[0]);
    const monthName = parts[1]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const year = Number(parts[2]);
    const time = parts[3];
    const monthMap = {
      stycznia: 0,
      lutego: 1,
      marca: 2,
      kwietnia: 3,
      maja: 4,
      czerwca: 5,
      lipca: 6,
      sierpnia: 7,
      wrzesnia: 8,
      pazdziernika: 9,
      listopada: 10,
      grudnia: 11
    };
    const month = monthMap[monthName];
    if (Number.isNaN(day) || Number.isNaN(year) || month === undefined) return null;
    const [hour, minute] = time.split(':').map((value) => Number(value));
    return new Date(year, month, day, hour || 0, minute || 0, 0, 0);
  }

  function applyBadges(row, cells) {
    if (!settings.showBadges) return;
    if (cells.length < 9) return;

    const titleCell = cells[0];
    titleCell.querySelectorAll('.ezam-badge').forEach((badge) => badge.remove());

    const submissionText = cells[7].textContent.trim();
    const initiationText = cells[8].textContent.trim();
    const submissionDate = parsePolishDate(submissionText);
    const initiationDate = parsePolishDate(initiationText);

    const now = new Date();
    if (submissionDate) {
      const diffDays = Math.ceil((submissionDate - now) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= settings.closingSoonDays) {
        const badge = document.createElement('span');
        badge.className = 'ezam-badge ezam-badge--soon';
        badge.textContent = t('closingSoon', 'Closing soon');
        titleCell.appendChild(badge);
      }
    }

    if (initiationDate) {
      const sameDay = initiationDate.toDateString() === now.toDateString();
      if (sameDay) {
        const badge = document.createElement('span');
        badge.className = 'ezam-badge ezam-badge--new';
        badge.textContent = t('newBadge', 'New');
        titleCell.appendChild(badge);
      }
    }
  }

  function buildExpandRow(row, cells) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('ezam-expand-row')) {
      return existing;
    }

    const detailsRow = document.createElement('tr');
    detailsRow.className = 'ezam-expand-row';

    const detailCell = document.createElement('td');
    detailCell.colSpan = row.querySelectorAll('td').length || cells.length;
    detailCell.className = 'ezam-expand-cell';

    const items = [
      [t('detailMode', 'Mode'), cells[2]?.textContent.trim()],
      [t('detailBzpTed', 'BZP/TED'), cells[3]?.textContent.trim()],
      [t('detailOrganization', 'Organization'), cells[4]?.textContent.trim()],
      [t('detailCity', 'City'), cells[5]?.textContent.trim()],
      [t('detailProvince', 'Province'), cells[6]?.textContent.trim()],
      [t('detailSubmission', 'Submission'), cells[7]?.textContent.trim()],
      [t('detailInitiation', 'Initiation'), cells[8]?.textContent.trim()]
    ].filter((entry) => entry[1]);

    const list = document.createElement('div');
    list.className = 'ezam-expand-grid';

    items.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'ezam-expand-item';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'ezam-expand-label';
      labelSpan.textContent = label + ':';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'ezam-expand-value';
      valueSpan.textContent = value;
      item.appendChild(labelSpan);
      item.appendChild(valueSpan);
      list.appendChild(item);
    });

    detailCell.appendChild(list);
    detailsRow.appendChild(detailCell);
    row.insertAdjacentElement('afterend', detailsRow);

    return detailsRow;
  }

  function getActionsCell(row, cells) {
    if (settings.linkPlacement === 'column') {
      let extraCell = row.querySelector('td.ezam-extra-cell');
      if (!extraCell) {
        extraCell = document.createElement('td');
        extraCell.className = 'ezam-extra-cell';
        row.appendChild(extraCell);
      }
      return extraCell;
    }

    return row.querySelector('td:last-child') || cells[cells.length - 1];
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
    applyBadges(row, cells);

    const detailsAnchor = row.querySelector('a:not(.ezam-open-link)');
    if (detailsAnchor) {
      applyAnchor(detailsAnchor, url, id, row);
    }

    const table = row.closest('table');
    if (settings.linkPlacement === 'column') {
      ensureExtraColumn(table);
    }

    const actionsCell = getActionsCell(row, cells);

    let openLink = actionsCell.querySelector('a.ezam-open-link');
    if (!openLink && detailsAnchor && settings.linkPlacement !== 'column') {
      openLink = detailsAnchor;
    }
    if (!openLink) {
      openLink = document.createElement('a');
      openLink.textContent = t('openLink', 'Open');
      actionsCell.appendChild(openLink);
    }
    applyAnchor(openLink, url, id, row);

    if (settings.multiSelect && !actionsCell.querySelector('.ezam-select')) {
      actionsCell.appendChild(buildSelectCheckbox(id));
    }

    if (isInlineExpandEnabled() && !actionsCell.querySelector('.ezam-expand-toggle')) {
      const detailsRow = buildExpandRow(row, cells);
      const expandBtn = buildExpandButton(row, detailsRow);
      expandBtn.classList.add('ezam-expand-toggle');
      actionsCell.appendChild(expandBtn);
    }

    if (settings.showCopyButtons && !actionsCell.querySelector('.ezam-actions')) {
      actionsCell.appendChild(buildActionButtons(id, url));
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

  function applyFreezeColumns() {
    const table = document.querySelector('#tenderListTable table');
    if (!table) return;
    table.classList.remove('ezam-freeze-1', 'ezam-freeze-2');
    if (settings.freezeColumns <= 0) return;

    const firstCell = table.querySelector('thead th');
    if (firstCell) {
      table.style.setProperty('--ezam-col1-width', `${firstCell.getBoundingClientRect().width}px`);
    }

    table.classList.add(settings.freezeColumns === 2 ? 'ezam-freeze-2' : 'ezam-freeze-1');
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

  function collectFilters(form) {
    const payload = {};
    getFilterControls(form).forEach(({ name, field }) => {
      payload[name] = field.value;
    });
    return payload;
  }

  function persistFilters(form) {
    if (!chrome.storage || !chrome.storage.local) return;
    const payload = collectFilters(form);
    chrome.storage.local.set({ [FILTERS_KEY]: payload });
  }

  function loadPresets(callback) {
    if (!chrome.storage || !chrome.storage.local) {
      callback([]);
      return;
    }
    chrome.storage.local.get(PRESETS_KEY, (data) => {
      const presets = data[PRESETS_KEY] || [];
      callback(Array.isArray(presets) ? presets : []);
    });
  }

  function savePreset(name, values) {
    loadPresets((presets) => {
      const next = presets.filter((preset) => preset.name !== name);
      next.push({ name, values });
      chrome.storage.local.set({ [PRESETS_KEY]: next }, updatePresetSelect);
    });
  }

  function applyPreset(values) {
    const form = document.querySelector('app-tender-filters form');
    if (!form) return;
    getFilterControls(form).forEach(({ name, field }) => {
      field.value = values[name] || '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function updatePresetSelect() {
    if (!toolbar) return;
    const select = toolbar.querySelector('.ezam-preset-select');
    if (!select) return;

    loadPresets((presets) => {
      select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('presetsPlaceholder', 'Presets');
    select.appendChild(placeholder);

      presets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name;
        select.appendChild(option);
      });
    });
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

  function getPaginationLinks() {
    const container = document.querySelector('.pagination-container');
    if (!container) return {};
    return {
      prev: container.querySelector('.prepend-arrow'),
      next: container.querySelector('.append-arrow')
    };
  }

  function getActivePage() {
    const active = document.querySelector('.pagination li a.active');
    return active ? active.textContent.trim() : '';
  }

  function saveScrollState() {
    if (!settings.rememberScroll) return;
    const state = {
      scrollY: window.scrollY,
      page: getActivePage()
    };
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(state));
  }

  function restoreScrollState() {
    if (!settings.rememberScroll) return;
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (!raw) return;

    try {
      const state = JSON.parse(raw);
      const active = getActivePage();
      if (state.page && active && state.page !== active) {
        const target = Array.from(document.querySelectorAll('.pagination li a')).find(
          (link) => link.textContent.trim() === state.page
        );
        if (target) {
          target.click();
          return;
        }
      }

      requestAnimationFrame(() => {
        window.scrollTo(0, state.scrollY || 0);
      });
    } catch (error) {
      // ignore
    }
  }

  function updateToolbarSelection() {
    if (!toolbar) return;
    const count = toolbar.querySelector('.ezam-selected-count');
    if (count) {
      count.textContent = t('selectedCount', 'Selected: {count}', { count: selectedIds.size });
    }
  }

  function selectAllRows() {
    document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
      const id = row.dataset.ezamOfferId;
      if (!id) return;
      const box = row.querySelector('.ezam-select-box');
      if (box) box.checked = true;
      selectedIds.add(id);
    });
    updateToolbarSelection();
  }

  function clearSelection() {
    selectedIds.clear();
    document.querySelectorAll('.ezam-select-box').forEach((box) => {
      box.checked = false;
    });
    updateToolbarSelection();
  }

  function openSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
    const urls = ids
      .map((id) => rows.find((row) => row.dataset.ezamOfferId === id))
      .filter(Boolean)
      .map((row) => row.dataset.ezamOfferUrl);

    urls.forEach((url, index) => {
      const active = !settings.openInBackground && index === urls.length - 1;
      if (openWithBackground(url, active)) return;
      openInNewTab(url);
    });
  }

  function findRowByQuery(query) {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
    const needle = query.trim().toLowerCase();
    if (!needle) return null;

    return rows.find((row) => {
      const id = row.dataset.ezamOfferId || '';
      const title = row.querySelector('td')?.textContent || '';
      return id.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
    });
  }

  function selectRow(row) {
    if (!row) return;
    document.querySelectorAll('.ezam-row-selected').forEach((r) => {
      r.classList.remove('ezam-row-selected');
    });
    row.classList.add('ezam-row-selected');
    rowCursor = Array.from(document.querySelectorAll(ROW_SELECTOR)).indexOf(row);
    row.scrollIntoView({ block: 'center' });
  }

  function moveRowCursor(delta) {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
    if (!rows.length) return;
    if (rowCursor < 0) rowCursor = 0;
    rowCursor = Math.max(0, Math.min(rows.length - 1, rowCursor + delta));
    selectRow(rows[rowCursor]);
  }

  function handleKeyboardNavigation(event) {
    if (!settings.keyboardNav) return;
    const target = event.target;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveRowCursor(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveRowCursor(-1);
    } else if (event.key === 'Enter') {
      const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
      const row = rows[rowCursor];
      if (row && row.dataset.ezamOfferUrl) {
        saveScrollState();
        if (event.shiftKey) {
          openOffer(row.dataset.ezamOfferUrl, { background: true });
        } else {
          openOffer(row.dataset.ezamOfferUrl);
        }
        markOpened(row.dataset.ezamOfferId, row);
      }
    } else if (event.altKey && event.key === 'ArrowLeft') {
      const { prev } = getPaginationLinks();
      if (prev && !prev.classList.contains('disabled')) prev.click();
    } else if (event.altKey && event.key === 'ArrowRight') {
      const { next } = getPaginationLinks();
      if (next && !next.classList.contains('disabled')) next.click();
    }
  }

  function ensureToolbar() {
    if (!settings.showMiniToolbar) return;
    if (toolbar) return;

    toolbar = document.createElement('div');
    toolbar.className = 'ezam-toolbar';

    const content = document.createElement('div');
    content.className = 'ezam-toolbar-content';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-outline-secondary btn-sm ezam-toolbar-toggle';
    toggleBtn.addEventListener('click', () => {
      settings.toolbarMinimized = !settings.toolbarMinimized;
      saveSettings({ toolbarMinimized: settings.toolbarMinimized });
      applyToolbarState();
    });

    const jumpInput = document.createElement('input');
    jumpInput.type = 'text';
    jumpInput.placeholder = t('jumpPlaceholder', 'Jump to ID/title');
    jumpInput.className = 'ezam-toolbar-input form-control';
    jumpInput.addEventListener('input', () => {
      const row = findRowByQuery(jumpInput.value);
      if (row) selectRow(row);
    });

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-outline-secondary btn-sm';
    prevBtn.textContent = t('prevPage', 'Prev page');
    prevBtn.addEventListener('click', () => {
      const { prev } = getPaginationLinks();
      if (prev && !prev.classList.contains('disabled')) prev.click();
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-outline-secondary btn-sm';
    nextBtn.textContent = t('nextPage', 'Next page');
    nextBtn.addEventListener('click', () => {
      const { next } = getPaginationLinks();
      if (next && !next.classList.contains('disabled')) next.click();
    });

    const openSelectedBtn = document.createElement('button');
    openSelectedBtn.type = 'button';
    openSelectedBtn.className = 'btn btn-secondary btn-sm';
    openSelectedBtn.textContent = t('openSelected', 'Open selected');
    openSelectedBtn.addEventListener('click', () => {
      saveScrollState();
      openSelected();
    });

    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'btn btn-outline-secondary btn-sm';
    selectAllBtn.textContent = t('selectAll', 'Select all');
    selectAllBtn.addEventListener('click', selectAllRows);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-outline-secondary btn-sm';
    clearBtn.textContent = t('clearSelection', 'Clear');
    clearBtn.addEventListener('click', clearSelection);

    const selectedCount = document.createElement('span');
    selectedCount.className = 'ezam-selected-count';
    selectedCount.textContent = t('selectedCount', 'Selected: {count}', { count: 0 });

    const presetSelect = document.createElement('select');
    presetSelect.className = 'ezam-preset-select form-control';
    presetSelect.addEventListener('change', () => {
      const name = presetSelect.value;
      if (!name) return;
      loadPresets((presets) => {
        const preset = presets.find((p) => p.name === name);
        if (preset) applyPreset(preset.values);
      });
    });

    const savePresetBtn = document.createElement('button');
    savePresetBtn.type = 'button';
    savePresetBtn.className = 'btn btn-outline-secondary btn-sm';
    savePresetBtn.textContent = t('savePreset', 'Save preset');
    savePresetBtn.addEventListener('click', () => {
      const name = window.prompt(t('presetNamePrompt', 'Preset name'));
      if (!name) return;
      const form = document.querySelector('app-tender-filters form');
      if (!form) return;
      savePreset(name, collectFilters(form));
    });

    if (settings.quickJump) content.appendChild(jumpInput);
    content.appendChild(prevBtn);
    content.appendChild(nextBtn);
    if (settings.multiSelect) {
      content.appendChild(openSelectedBtn);
      content.appendChild(selectAllBtn);
      content.appendChild(clearBtn);
      content.appendChild(selectedCount);
    }
    content.appendChild(presetSelect);
    content.appendChild(savePresetBtn);

    toolbar.appendChild(toggleBtn);
    toolbar.appendChild(content);
    document.body.appendChild(toolbar);
    updatePresetSelect();
    applyToolbarState();
  }

  function applyToolbarState() {
    if (!toolbar) return;
    toolbar.classList.toggle('ezam-toolbar--minimized', settings.toolbarMinimized);
    const toggle = toolbar.querySelector('.ezam-toolbar-toggle');
    if (toggle) {
      const label = settings.toolbarMinimized
        ? t('toolbarExpand', 'Show toolbar')
        : t('toolbarMinimize', 'Hide toolbar');
      toggle.textContent = label;
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
    }
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
      applyFreezeColumns();
    }).observe(document.body, { childList: true, subtree: true });
  }

  loadSettings()
    .then(() => loadMessages(settings.language))
    .then(() => {
      t = translate;

      applyCompactColumns();
      applyGlobalClasses();
      scanExisting();
      applyStickyHeader();
      applyFreezeColumns();
      setupFilterPersistence();
      ensureHeaderControls(document.querySelector('#tenderListTable table'));
      ensureToolbar();
      updateToolbarSelection();
      restoreScrollState();
      document.addEventListener('keydown', handleKeyboardNavigation);
      window.addEventListener('beforeunload', saveScrollState);
      window.addEventListener('resize', () => {
        if (compactTimer) clearTimeout(compactTimer);
        compactTimer = setTimeout(applyCompactColumns, 150);
      });
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return;
          if (!changes[SETTINGS_KEY] || !changes[SETTINGS_KEY].newValue) return;
          handleSettingsUpdate(changes[SETTINGS_KEY].newValue);
        });
      }
      observeChanges();
    });
})();
