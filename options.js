const SETTINGS_KEY = 'ezamSettings';
const LOCALES = ['en', 'pl'];

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
  closingSoonDays: 3
};

function detectLanguage() {
  const ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || '';
  const lang = (ui || navigator.language || '').toLowerCase();
  return lang.startsWith('pl') ? 'pl' : 'en';
}

function normalizeLanguage(language) {
  return language && language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

function normalizeLinkPlacement(value) {
  if (value === 'column') return 'details';
  if (value === 'details') return 'details';
  return 'cell';
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (data) => {
      const stored = data[SETTINGS_KEY] || {};
      const resolvedLanguage = normalizeLanguage(stored.language || detectLanguage());
      const settings = { ...DEFAULTS, ...stored, language: resolvedLanguage };
      settings.linkPlacement = normalizeLinkPlacement(settings.linkPlacement);
      resolve(settings);
    });
  });
}

function saveSettings(next) {
  const normalized = { ...next };
  if (Object.prototype.hasOwnProperty.call(normalized, 'linkPlacement')) {
    normalized.linkPlacement = normalizeLinkPlacement(normalized.linkPlacement);
  }
  chrome.storage.sync.set({ [SETTINGS_KEY]: normalized });
}

let messages = {};
let currentLanguage = 'en';

function formatMessage(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
}

function t(key, fallback, vars) {
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
}

function applyI18n() {
  document.documentElement.lang = currentLanguage;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = t(key, el.textContent);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    el.title = t(key, el.title || '');
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = t(key, el.placeholder || '');
  });

  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) {
    document.title = t(titleEl.dataset.i18n, document.title);
  }
}

function bindInputs(settings) {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    const value = settings[key];

    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = String(value);
    }

    const readNumberValue = (fallback) => {
      const raw = input.value.trim();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return fallback;
      const min = input.min !== '' ? Number(input.min) : null;
      const max = input.max !== '' ? Number(input.max) : null;
      let next = parsed;
      if (Number.isFinite(min)) next = Math.max(next, min);
      if (Number.isFinite(max)) next = Math.min(next, max);
      return next;
    };

    const commitValue = () => {
      const updated = { ...settings };
      const current = settings[key];
      if (input.type === 'checkbox') {
        updated[key] = input.checked;
      } else if (input.type === 'number') {
        const nextValue = readNumberValue(current);
        updated[key] = nextValue;
        if (nextValue !== Number(input.value)) {
          input.value = String(nextValue);
        }
      } else {
        updated[key] = input.value;
      }
      if (updated[key] === current) return;
      settings = updated;
      saveSettings(updated);

      if (key === 'language') {
        loadMessages(updated.language).then(() => {
          applyI18n();
        });
      }
    };

    input.addEventListener('change', commitValue);
    if (input.type === 'number') {
      input.addEventListener('input', commitValue);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings().then((settings) => {
    loadMessages(settings.language).then(() => {
      applyI18n();
      bindInputs(settings);
    });
  });
});
