const state = {
  links: [],
  filtered: [],
  filter: 'all',
  query: '',
  page: null
};

const els = {
  pageTitle: document.querySelector('#pageTitle'),
  totalCount: document.querySelector('#totalCount'),
  visibleCount: document.querySelector('#visibleCount'),
  domainCount: document.querySelector('#domainCount'),
  searchInput: document.querySelector('#searchInput'),
  linkList: document.querySelector('#linkList'),
  template: document.querySelector('#linkTemplate'),
  selectionStatus: document.querySelector('#selectionStatus'),
  selectAllButton: document.querySelector('#selectAllButton'),
  copyButton: document.querySelector('#copyButton'),
  exportButton: document.querySelector('#exportButton'),
  exportMenu: document.querySelector('#exportMenu'),
  refreshButton: document.querySelector('#refreshButton'),
  statusPanel: document.querySelector('#statusPanel')
};

const FILE_EXTENSIONS = new Set([
  'pdf', 'csv', 'tsv', 'json', 'xml', 'zip', 'gz', 'tar', '7z', 'rar',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp3', 'wav', 'mp4', 'mov', 'webm'
]);

function collectLinksFromPage() {
  const fileExtensions = new Set([
    'pdf', 'csv', 'tsv', 'json', 'xml', 'zip', 'gz', 'tar', '7z', 'rar',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp3', 'wav', 'mp4', 'mov', 'webm'
  ]);
  const pageUrl = location.href;
  const pageHost = location.hostname;

  const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au',
    'co.nz', 'com.br', 'com.mx', 'co.jp', 'co.kr', 'co.in', 'com.sg',
    'com.cn', 'com.hk', 'com.tw', 'co.za', 'com.tr', 'com.ar'
  ]);

  const FIRST_PARTY_ALIASES = {
    'reddit.com': ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'],
    'github.com': ['github.com', 'githubusercontent.com', 'githubassets.com'],
    'gitlab.com': ['gitlab.com', 'gitlab-static.net'],
    'stackoverflow.com': ['stackoverflow.com', 'stackexchange.com', 'sstatic.net'],
    'youtube.com': ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com'],
    'x.com': ['x.com', 'twitter.com', 't.co', 'twimg.com'],
    'twitter.com': ['x.com', 'twitter.com', 't.co', 'twimg.com'],
    'facebook.com': ['facebook.com', 'fb.com', 'fbcdn.net'],
    'linkedin.com': ['linkedin.com', 'licdn.com']
  };

  function registrableDomain(hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    const suffix = parts.slice(-2).join('.');
    return MULTI_PART_SUFFIXES.has(suffix) ? parts.slice(-3).join('.') : suffix;
  }

  const pageSite = registrableDomain(pageHost);
  const siteAliases = FIRST_PARTY_ALIASES[pageSite] || [pageSite];

  function belongsToSite(hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return siteAliases.some(alias => host === alias || host.endsWith(`.${alias}`));
  }

  const pageTitle = document.title || pageHost || pageUrl;
  const seen = new Set();
  const links = [];

  for (const anchor of document.querySelectorAll('a[href]')) {
    const rawHref = anchor.getAttribute('href')?.trim();
    if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) continue;

    let url;
    try {
      url = new URL(anchor.href, document.baseURI);
    } catch {
      continue;
    }

    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) continue;

    const normalized = url.href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const text = (anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || anchor.title || '').replace(/\s+/g, ' ').trim();
    const parentText = (anchor.closest('p, li, article, section, nav, td, div')?.innerText || '').replace(/\s+/g, ' ').trim();
    const context = parentText && parentText !== text ? parentText.slice(0, 220) : '';
    const extension = url.pathname.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
    const isFile = fileExtensions.has(extension);
    const isMail = url.protocol === 'mailto:';
    const isTel = url.protocol === 'tel:';
    const isInternal = ['http:', 'https:'].includes(url.protocol) && belongsToSite(url.hostname);

    links.push({
      url: normalized,
      text: text || url.hostname || normalized,
      context,
      hostname: url.hostname || url.protocol.replace(':', ''),
      protocol: url.protocol,
      type: isMail ? 'mailto' : isTel ? 'phone' : isFile ? 'file' : isInternal ? 'internal' : 'external'
    });
  }

  return { pageUrl, pageHost, pageSite, pageTitle, links };
}

async function loadLinks() {
  setStatus('Collecting links from the current page…');
  els.refreshButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab is available.');

    const restricted = /^(chrome|edge|about|chrome-extension):/i.test(tab.url || '');
    if (restricted) throw new Error('Chrome does not allow extensions to inspect this protected page. Open a normal website and try again.');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectLinksFromPage
    });

    state.page = result;
    state.links = result.links.map((link, index) => ({ ...link, id: index, selected: true }));
    els.pageTitle.textContent = result.pageTitle;
    els.pageTitle.title = result.pageUrl;
    clearStatus();
    applyFilters();
  } catch (error) {
    state.links = [];
    state.filtered = [];
    els.pageTitle.textContent = 'Unable to read this page';
    setStatus(error.message || 'The page could not be inspected.', true);
    render();
  } finally {
    els.refreshButton.disabled = false;
  }
}

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.filtered = state.links.filter(link => {
    const matchesType = state.filter === 'all' ||
      (state.filter === 'files' ? link.type === 'file' : link.type === state.filter);
    const haystack = `${link.text} ${link.url} ${link.hostname} ${link.context}`.toLowerCase();
    return matchesType && (!q || haystack.includes(q));
  });
  render();
}

function render() {
  els.linkList.replaceChildren();

  els.totalCount.textContent = state.links.length.toLocaleString();
  els.visibleCount.textContent = state.filtered.length.toLocaleString();
  els.domainCount.textContent = new Set(state.links.map(link => link.hostname).filter(Boolean)).size.toLocaleString();

  if (!state.filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = state.links.length
      ? '<strong>No matching links</strong>Try a different filter or search.'
      : '<strong>No links found</strong>This page may not contain standard anchor links.';
    els.linkList.append(empty);
    updateSelectionStatus();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const link of state.filtered) {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector('.link-card');
    const checkbox = node.querySelector('.select-link');
    const title = node.querySelector('.link-title');
    const type = node.querySelector('.link-type');
    const url = node.querySelector('.link-url');
    const context = node.querySelector('.link-context');
    const favicon = node.querySelector('.favicon');
    const copyOne = node.querySelector('.copy-one');

    card.dataset.id = link.id;
    checkbox.checked = link.selected;
    checkbox.addEventListener('change', () => {
      link.selected = checkbox.checked;
      updateSelectionStatus();
    });

    title.textContent = link.text;
    title.href = link.url;
    title.title = link.url;
    type.textContent = link.type;
    url.textContent = link.url;
    context.textContent = link.context;
    context.hidden = !link.context;

    favicon.textContent = link.type === 'mailto' ? '✉' : link.type === 'phone' ? '☎' : (link.hostname?.[0] || '↗').toUpperCase();

    copyOne.addEventListener('click', async () => {
      await copyText(link.url);
      flashButton(copyOne, '✓');
    });

    fragment.append(node);
  }

  els.linkList.append(fragment);
  updateSelectionStatus();
}

function selectedLinks() {
  return state.links.filter(link => link.selected);
}

function updateSelectionStatus() {
  const count = selectedLinks().length;
  els.selectionStatus.textContent = `${count.toLocaleString()} selected`;
  els.copyButton.disabled = count === 0;
  els.exportButton.disabled = count === 0;
  const allVisibleSelected = state.filtered.length > 0 && state.filtered.every(link => link.selected);
  els.selectAllButton.textContent = allVisibleSelected ? 'Clear shown' : 'Select shown';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function formatLinks(links, format) {
  switch (format) {
    case 'json':
      return JSON.stringify({
        source: state.page?.pageUrl,
        title: state.page?.pageTitle,
        exportedAt: new Date().toISOString(),
        links: links.map(({ selected, id, ...link }) => link)
      }, null, 2);
    case 'csv': {
      const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      return ['Text,URL,Domain,Type,Context', ...links.map(link =>
        [link.text, link.url, link.hostname, link.type, link.context].map(quote).join(',')
      )].join('\n');
    }
    case 'md':
      return `# Links from ${state.page?.pageTitle || 'page'}\n\nSource: ${state.page?.pageUrl || ''}\n\n` +
        links.map(link => `- [${link.text.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${link.url})`).join('\n');
    default:
      return links.map(link => link.url).join('\n');
  }
}

function exportLinks(format) {
  const links = selectedLinks();
  if (!links.length) return;

  const mime = { txt: 'text/plain', csv: 'text/csv', json: 'application/json', md: 'text/markdown' }[format];
  const content = formatLinks(links, format);
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const objectUrl = URL.createObjectURL(blob);
  const filenameBase = slugify(state.page?.pageTitle || state.page?.pageHost || 'page-links');
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${filenameBase}-links.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
}

function setStatus(message, error = false) {
  els.statusPanel.hidden = false;
  els.statusPanel.textContent = message;
  els.statusPanel.classList.toggle('error', error);
}

function clearStatus() {
  els.statusPanel.hidden = true;
  els.statusPanel.textContent = '';
  els.statusPanel.classList.remove('error');
}

function flashButton(button, temporaryText) {
  const previous = button.textContent;
  button.textContent = temporaryText;
  setTimeout(() => { button.textContent = previous; }, 900);
}

els.searchInput.addEventListener('input', event => {
  state.query = event.target.value;
  applyFilters();
});

document.querySelectorAll('.filter').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelector('.filter.active')?.classList.remove('active');
    button.classList.add('active');
    state.filter = button.dataset.filter;
    applyFilters();
  });
});

els.selectAllButton.addEventListener('click', () => {
  const shouldSelect = !state.filtered.every(link => link.selected);
  state.filtered.forEach(link => { link.selected = shouldSelect; });
  render();
});

els.copyButton.addEventListener('click', async () => {
  const links = selectedLinks();
  await copyText(links.map(link => link.url).join('\n'));
  const original = els.copyButton.textContent;
  els.copyButton.textContent = `Copied ${links.length}`;
  setTimeout(() => { els.copyButton.textContent = original; }, 1000);
});

els.exportButton.addEventListener('click', event => {
  event.stopPropagation();
  els.exportMenu.hidden = !els.exportMenu.hidden;
});

els.exportMenu.addEventListener('click', event => {
  const button = event.target.closest('[data-format]');
  if (!button) return;
  exportLinks(button.dataset.format);
  els.exportMenu.hidden = true;
});

document.addEventListener('click', event => {
  if (!els.exportMenu.contains(event.target) && event.target !== els.exportButton) {
    els.exportMenu.hidden = true;
  }
});

document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== els.searchInput) {
    event.preventDefault();
    els.searchInput.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && document.activeElement !== els.searchInput) {
    event.preventDefault();
    state.filtered.forEach(link => { link.selected = true; });
    render();
  }
});

els.refreshButton.addEventListener('click', loadLinks);
loadLinks();
