const SETTINGS_KEY = 'ezamSettings';

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

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (data) => {
      resolve({ ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) });
    });
  });
}

function saveSettings(next) {
  chrome.storage.sync.set({ [SETTINGS_KEY]: next });
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

    input.addEventListener('change', () => {
      const updated = { ...settings };
      if (input.type === 'checkbox') {
        updated[key] = input.checked;
      } else if (input.type === 'number') {
        updated[key] = Number(input.value);
      } else {
        updated[key] = input.value;
      }
      settings = updated;
      saveSettings(updated);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings().then(bindInputs);
});
