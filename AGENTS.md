# AGENTS.md

## Project Summary
- Chrome/Edge MV3 extension that enhances ezamowienia.gov.pl tender list pages.
- Adds open links, row actions, filters, keyboard navigation, toolbar, notes, and badges.
- Localized in English and Polish via `_locales/*/messages.json`.

## Key Files
- `manifest.json`: MV3 config, permissions, content script, options page.
- `content.js`: Main content script; injects UI and handles behavior on list pages.
- `styles.css`: UI styles injected by content script.
- `background.js`: Service worker; opens tabs on trusted requests.
- `options.html`, `options.js`, `options.css`: Settings UI (sync storage).
- `_locales/en/messages.json`, `_locales/pl/messages.json`: i18n strings.

## Runtime Scope
- Runs only on `https://ezamowienia.gov.pl/mp-client/*`.
- Content script checks `window.location.pathname` for tender list pages.

## Storage Usage
- `chrome.storage.sync`: `ezamSettings` (user settings).
- `chrome.storage.local`: `ezamFilters`, `ezamFilterPresets`, `ezamOfferNotes`,
  `ezamStarredIds`, `ezamLastOpened`.
- `sessionStorage`: `ezamOpenedIds`, `ezamScrollState`.

## UI/Behavior Highlights (content.js)
- Row augmentation: open link, copy buttons, star, select, inline note panel.
- Filters: status/city/organization/starred; chips in filter bar.
- Toolbar: quick jump, paging, compare, select tools, presets, continue panel.
- Keyboard: arrows, Enter, N, F, S, ?, Esc; alt+left/right paging.
- Badges: "New" and "Closing soon" based on Polish date parsing.

## Security / Trust Model
- URL opens are restricted to `https://ezamowienia.gov.pl/mp-client/tenders/`.
- Background tab opening only accepts trusted sender + trusted URL.

## Development Notes
- No build step or tests in repo.
- Prefer `rg` for searching if available; fallback to `grep`/`find`.
- Keep UI text in locale files; avoid hardcoded strings.
