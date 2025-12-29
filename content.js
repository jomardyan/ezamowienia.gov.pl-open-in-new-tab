(() => {
  const BASE = 'https://ezamowienia.gov.pl/mp-client/tenders/';
  const ROW_SELECTOR = 'tr.tr-link';

  function applyAnchor(anchor, url) {
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    // Stop row-level handlers from hijacking the click.
    anchor.addEventListener('click', (event) => event.stopPropagation());
    anchor.addEventListener('mousedown', (event) => event.stopPropagation(), true);
    anchor.addEventListener('pointerdown', (event) => event.stopPropagation(), true);
  }

  function extractId(cells, row) {
    if (cells.length >= 2) {
      const id = cells[1].textContent.trim();
      if (id && /^ocds-/.test(id)) return id;
    }

    const fallback = row.textContent.match(/ocds-[a-z0-9-]+/i);
    return fallback ? fallback[0] : '';
  }

  function addLinkToRow(row) {
    if (row.dataset.ezamLinkAdded) return;

    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;

    const id = extractId(cells, row);
    if (!id) return;

    row.dataset.ezamLinkAdded = '1';
    const url = BASE + encodeURIComponent(id);

    const lastCell = row.querySelector('td:last-child');
    const existingAnchor = lastCell && lastCell.querySelector('a');

    if (existingAnchor) {
      applyAnchor(existingAnchor, url);
      return;
    }

    const anchor = document.createElement('a');
    anchor.textContent = 'Otworz';
    anchor.className = 'ezam-open-link';
    applyAnchor(anchor, url);

    if (lastCell) {
      lastCell.appendChild(anchor);
      return;
    }

    const newCell = document.createElement('td');
    newCell.appendChild(anchor);
    row.appendChild(newCell);
  }

  function scanExisting() {
    document.querySelectorAll(ROW_SELECTOR).forEach(addLinkToRow);
  }

  scanExisting();

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
  }).observe(document.body, { childList: true, subtree: true });
})();
