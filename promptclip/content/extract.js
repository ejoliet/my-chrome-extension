(() => {
  const BLOCKED_SELECTORS = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'nav', 'footer', 'aside', 'form', '[role="navigation"]', '[role="banner"]',
    '[role="contentinfo"]', '[aria-hidden="true"]', '.ads', '.ad', '.advertisement',
    '.cookie', '.cookies', '.modal', '.popup', '.newsletter', '.subscribe'
  ];

  const normalizeWhitespace = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  const absoluteUrl = (href) => {
    try { return new URL(href, location.href).href; } catch (_err) { return href || ''; }
  };

  function fallbackHtml() {
    const clone = document.cloneNode(true);
    clone.querySelectorAll(BLOCKED_SELECTORS.join(',')).forEach((node) => node.remove());
    clone.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', absoluteUrl(a.getAttribute('href'))));
    clone.querySelectorAll('img[src]').forEach((img) => img.setAttribute('src', absoluteUrl(img.getAttribute('src'))));
    const main = clone.querySelector('main, article, [role="main"], .content, #content') || clone.body;
    return main ? main.innerHTML : document.body.innerHTML;
  }

  function markdownFromHtml(html) {
    const service = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      linkStyle: 'inlined'
    });

    // AIDEV-NOTE: Preserve tables as HTML because vanilla Markdown table conversion is lossy.
    service.keep(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);
    service.remove(['script', 'style', 'noscript']);

    service.addRule('fencedCodeLanguage', {
      filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
      replacement: (_content, node) => {
        const code = node.firstChild;
        const className = code.getAttribute('class') || '';
        const match = className.match(/language-([a-z0-9_-]+)/i);
        const lang = match ? match[1] : '';
        return `\n\n\`\`\`${lang}\n${code.textContent.replace(/\n+$/,'')}\n\`\`\`\n\n`;
      }
    });

    return normalizeWhitespace(service.turndown(html));
  }

  function yamlEscape(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
  }

  function buildYaml({ title, url, mode, siteName, byline, excerpt }) {
    const lines = [
      '---',
      `title: "${yamlEscape(title)}"`,
      `url: "${yamlEscape(url)}"`,
      `captured_at: "${new Date().toISOString()}"`,
      `source: "PromptClip"`,
      `mode: "${mode}"`
    ];
    if (siteName) lines.push(`site_name: "${yamlEscape(siteName)}"`);
    if (byline) lines.push(`byline: "${yamlEscape(byline)}"`);
    if (excerpt) lines.push(`excerpt: "${yamlEscape(excerpt)}"`);
    lines.push('---', '');
    return lines.join('\n');
  }

  function rawTextLength() {
    return normalizeWhitespace(document.body?.innerText || document.documentElement?.textContent || '').length;
  }

  window.PromptClipExtract = function PromptClipExtract() {
    if (document.contentType === 'application/pdf' || location.href.toLowerCase().endsWith('.pdf')) {
      throw new Error('PDF pages are not supported by this extractor. Use the browser PDF download, then convert the file separately.');
    }

    let article = null;
    let fallback = false;
    let html = '';
    const originalChars = rawTextLength();

    try {
      const clone = document.cloneNode(true);
      clone.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', absoluteUrl(a.getAttribute('href'))));
      clone.querySelectorAll('img[src]').forEach((img) => img.setAttribute('src', absoluteUrl(img.getAttribute('src'))));
      article = new Readability(clone, {
        charThreshold: 300,
        keepClasses: false,
        classesToPreserve: ['language-js', 'language-javascript', 'language-python', 'highlight']
      }).parse();
    } catch (_err) {
      article = null;
    }

    if (article?.content && normalizeWhitespace(article.textContent || '').length >= 120) {
      html = article.content;
    } else {
      fallback = true;
      html = fallbackHtml();
    }

    const title = normalizeWhitespace(article?.title || document.title || location.hostname || 'Untitled page');
    const bodyMd = markdownFromHtml(html);
    const markdown = normalizeWhitespace(`${buildYaml({
      title,
      url: location.href,
      mode: fallback ? 'fallback' : 'readability',
      siteName: article?.siteName,
      byline: article?.byline,
      excerpt: article?.excerpt
    })}# ${title}\n\n${bodyMd}`);

    return {
      ok: true,
      markdown,
      title,
      url: location.href,
      mode: fallback ? 'fallback' : 'readability',
      originalChars,
      markdownChars: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4)
    };
  };
})();
