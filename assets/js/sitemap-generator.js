(function () {
  const page = document.querySelector('[data-sitemap-page]');
  if (!page) return;

  const els = {
    baseUrl: document.getElementById('siteBaseUrl'),
    urlList: document.getElementById('urlListInput'),
    changefreq: document.getElementById('changefreqSelect'),
    priority: document.getElementById('prioritySelect'),
    lastmod: document.getElementById('lastmodInput'),
    includeLastmod: document.getElementById('includeLastmodToggle'),
    output: document.getElementById('sitemapOutput'),
    errorBox: document.getElementById('sitemapErrorBox'),
    statUrls: document.getElementById('statUrlCount'),
    statSize: document.getElementById('statXmlSize'),
    statLines: document.getElementById('statLineCount'),
    generateBtn: document.getElementById('generateSitemapBtn'),
    copyBtn: document.getElementById('copySitemapBtn'),
    downloadBtn: document.getElementById('downloadSitemapBtn'),
    clearBtn: document.getElementById('clearSitemapBtn'),
    sampleBtn: document.getElementById('loadSampleBtn'),
    toast: document.getElementById('sitemapToast'),
    urlPreview: document.getElementById('urlPreviewCount'),
  };

  const escapeXml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const MAX_SITEMAP_URLS = 50000; // sitemaps.org protocol limit per file

  // toISOString() converts to UTC, which shifts the calendar day for users
  // outside UTC (e.g. late evening in India) — use local date parts so the
  // default date matches "today" in the user's own timezone.
  const toLocalDateInputValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const showToast = (message) => {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
  };

  const setError = (message) => {
    if (!els.errorBox) return;
    const msg = message || '';
    els.errorBox.textContent = msg;
    els.errorBox.classList.toggle('hidden', !msg);
  };

  const normalizeBaseUrl = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withProtocol.replace(/\/+$/, '');
  };

  const normalizeUrl = (entry, baseUrl) => {
    const trimmed = String(entry || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // Any other "scheme://" (ftp://, file://, ws://, ...) is already an
    // absolute URL too — pass it through as-is so the http(s)-only check in
    // parseUrlLines can actually reject it, instead of silently mangling it
    // into a nonsense path appended to the base URL (e.g. https://site.com/ftp://...).
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${baseUrl}${path}`;
  };

  const parseUrlLines = (text, baseUrl, { silent = false } = {}) => {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const urls = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const normalized = normalizeUrl(line, baseUrl);
      try {
        const parsed = new URL(normalized);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Unsupported protocol');
        }
        const canonical = parsed.toString();
        if (!seen.has(canonical)) {
          seen.add(canonical);
          urls.push(canonical);
        }
      } catch (error) {
        if (!silent) {
          throw new Error(`Invalid URL on line ${index + 1}: "${line}"`);
        }
      }
    });

    return urls;
  };

  const buildSitemap = ({ urls, changefreq, priority, lastmod, includeLastmod }) => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    urls.forEach((loc) => {
      xml += '  <url>\n';
      xml += `    <loc>${escapeXml(loc)}</loc>\n`;
      if (includeLastmod && lastmod) {
        xml += `    <lastmod>${escapeXml(lastmod)}</lastmod>\n`;
      }
      if (changefreq) {
        xml += `    <changefreq>${escapeXml(changefreq)}</changefreq>\n`;
      }
      if (priority !== '') {
        xml += `    <priority>${escapeXml(priority)}</priority>\n`;
      }
      xml += '  </url>\n';
    });

    xml += '</urlset>\n';
    return xml;
  };

  const highlightXml = (xml) => {
    const safe = escapeHtml(xml);
    return safe
      .replace(/(&lt;loc&gt;)([\s\S]*?)(&lt;\/loc&gt;)/g, '$1<span class="tok-loc">$2</span>$3')
      .replace(/(&lt;\/?)([\w:-]+)(.*?&gt;)/g, '<span class="tok-tag">$1$2$3</span>');
  };

  const updateStats = (urlCount, xml) => {
    if (els.statUrls) els.statUrls.textContent = String(urlCount);
    if (els.statLines) els.statLines.textContent = String(xml.split('\n').length);
    if (els.statSize) {
      els.statSize.textContent = formatBytes(new Blob([xml]).size);
    }
  };

  const updateUrlPreview = () => {
    if (!els.urlPreview) return;
    const baseUrl = normalizeBaseUrl(els.baseUrl?.value);
    if (!baseUrl || !els.urlList?.value.trim()) {
      els.urlPreview.textContent = '0 URLs detected';
      return;
    }
    try {
      const count = parseUrlLines(els.urlList.value, baseUrl, { silent: true }).length;
      els.urlPreview.textContent = `${count} URL${count === 1 ? '' : 's'} detected`;
    } catch (error) {
      els.urlPreview.textContent = '0 URLs detected';
    }
  };

  const renderOutput = (xml) => {
    if (!els.output) return;
    els.output.innerHTML = highlightXml(xml);
    els.output.dataset.raw = xml;
  };

  const generateSitemap = () => {
    setError('');

    const baseUrl = normalizeBaseUrl(els.baseUrl?.value);
    if (!baseUrl) {
      setError('Enter a valid website base URL, for example https://example.com');
      return;
    }

    let urls = [];
    try {
      urls = parseUrlLines(els.urlList?.value, baseUrl);
    } catch (error) {
      setError(error.message);
      return;
    }

    if (!urls.length) {
      setError('Add at least one URL to include in your sitemap.');
      return;
    }

    if (urls.length > MAX_SITEMAP_URLS) {
      setError(`A single sitemap.xml can list at most ${MAX_SITEMAP_URLS.toLocaleString()} URLs per the sitemaps.org protocol — you have ${urls.length.toLocaleString()}. Split your URLs across multiple sitemap files and link them from a sitemap index file instead.`);
      return;
    }

    const xml = buildSitemap({
      urls,
      changefreq: els.changefreq?.value || 'weekly',
      priority: els.priority?.value ?? '0.7',
      lastmod: els.lastmod?.value || '',
      includeLastmod: Boolean(els.includeLastmod?.checked),
    });

    renderOutput(xml);
    updateStats(urls.length, xml);
    els.output?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(`Generated sitemap with ${urls.length} URL${urls.length === 1 ? '' : 's'}`);
  };

  const copyText = async (text) => {
    if (!text || text.startsWith('Generate a sitemap')) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      showToast('Sitemap XML copied to clipboard');
    } catch (error) {
      console.error('Copy failed', error);
      showToast('Copy failed — please try again');
    }
  };

  const downloadSitemap = (text) => {
    if (!text || text.startsWith('Generate a sitemap')) return;
    const blob = new Blob([text], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sitemap.xml';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('sitemap.xml downloaded');
  };

  const loadSample = () => {
    if (els.baseUrl) els.baseUrl.value = 'https://example.com';
    if (els.urlList) {
      els.urlList.value = ['/', '/about.html', '/contact.html', '/blog/post-one.html', '/blog/post-two.html'].join('\n');
    }
    if (els.changefreq) els.changefreq.value = 'weekly';
    if (els.priority) els.priority.value = '0.7';
    if (els.includeLastmod) els.includeLastmod.checked = true;
    if (els.lastmod) els.lastmod.value = toLocalDateInputValue(new Date());
    updateUrlPreview();
    generateSitemap();
  };

  const clearAll = () => {
    if (els.urlList) els.urlList.value = '';
    if (els.output) {
      els.output.textContent = 'Generate a sitemap to preview XML here.';
      delete els.output.dataset.raw;
    }
    setError('');
    if (els.statUrls) els.statUrls.textContent = '—';
    if (els.statSize) els.statSize.textContent = '—';
    if (els.statLines) els.statLines.textContent = '—';
    updateUrlPreview();
  };

  if (els.lastmod && !els.lastmod.value) {
    els.lastmod.value = toLocalDateInputValue(new Date());
  }

  els.generateBtn?.addEventListener('click', generateSitemap);
  els.copyBtn?.addEventListener('click', () => copyText(els.output?.dataset.raw || els.output?.textContent || ''));
  els.downloadBtn?.addEventListener('click', () => downloadSitemap(els.output?.dataset.raw || els.output?.textContent || ''));
  els.clearBtn?.addEventListener('click', clearAll);
  els.sampleBtn?.addEventListener('click', loadSample);
  els.baseUrl?.addEventListener('input', updateUrlPreview);
  els.urlList?.addEventListener('input', updateUrlPreview);

  updateUrlPreview();
})();
