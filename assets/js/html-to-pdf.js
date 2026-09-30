document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-html-to-pdf-page]');
  if (!page) return;

  const tabButtons = Array.from(page.querySelectorAll('[data-input-tab]'));
  const tabPanels = Array.from(page.querySelectorAll('[data-input-panel]'));
  const urlInput = page.querySelector('[data-url-input]');
  const fetchUrlBtn = page.querySelector('[data-fetch-url-btn]');
  const htmlInput = page.querySelector('[data-html-input]');
  const htmlFileInput = page.querySelector('[data-html-file-input]');
  const filePickers = Array.from(page.querySelectorAll('[data-html-file-picker]'));
  const fileNameInput = page.querySelector('[data-file-name]');
  const pageSizeSelect = page.querySelector('[data-page-size]');
  const pageOrientationSelect = page.querySelector('[data-page-orientation]');
  const marginInput = page.querySelector('[data-margin-mm]');
  const scaleInput = page.querySelector('[data-scale]');
  const scaleValue = page.querySelector('[data-scale-value]');
  const bgGraphicsCheck = page.querySelector('[data-bg-graphics]');
  const headerInput = page.querySelector('[data-header-text]');
  const footerInput = page.querySelector('[data-footer-text]');
  const pageNumbersCheck = page.querySelector('[data-page-numbers]');
  const jsWaitInput = page.querySelector('[data-js-wait]');
  const previewFrame = page.querySelector('[data-preview-frame]');
  const previewToggle = page.querySelector('[data-preview-toggle]');
  const previewWrap = page.querySelector('[data-preview-wrap]');
  const convertButton = page.querySelector('[data-convert-btn]');
  const convertAnotherBtn = page.querySelector('[data-convert-another]');
  const downloadLinks = Array.from(page.querySelectorAll('[data-download-link]'));
  const resultPanel = page.querySelector('[data-result-panel]');
  const progressWrap = page.querySelector('[data-progress-wrap]');
  const progressFill = page.querySelector('[data-progress-fill]');
  const progressText = page.querySelector('[data-progress-text]');
  const messageBox = page.querySelector('[data-message]');
  const loader = page.querySelector('[data-loader]');
  const stepIndicators = Array.from(page.querySelectorAll('[data-step-indicator]'));
  const stickyCta = document.querySelector('[data-sticky-convert-cta]');

  let activeTab = 'html';
  let activeBlobUrl = null;
  let previewTimer = null;

  const PAGE_DIMENSIONS = {
    a4: { w: 210, h: 297 },
    letter: { w: 216, h: 279 },
    legal: { w: 216, h: 356 },
  };

  const setMessage = (text, type = 'success') => {
    messageBox.textContent = text;
    messageBox.className = `htp-message ${type}`;
    messageBox.classList.remove('hidden');
    messageBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
  };

  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.className = 'htp-message hidden';
  };

  const toggleLoader = (visible) => {
    loader.classList.toggle('hidden', !visible);
    convertButton.disabled = visible;
    if (fetchUrlBtn) fetchUrlBtn.disabled = visible;
    filePickers.forEach((b) => { b.disabled = visible; });
  };

  const setProgress = (pct, label) => {
    if (!progressWrap || !progressFill) return;
    progressWrap.classList.remove('hidden');
    progressWrap.setAttribute('aria-hidden', 'false');
    progressWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (progressText && label) progressText.textContent = label;
  };

  const hideProgress = () => {
    if (!progressWrap) return;
    progressWrap.classList.add('hidden');
    progressWrap.setAttribute('aria-hidden', 'true');
    if (progressFill) progressFill.style.width = '0%';
  };

  const hideDownload = () => {
    downloadLinks.forEach((link) => {
      link.classList.add('hidden');
      link.removeAttribute('href');
    });
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
    if (resultPanel) resultPanel.classList.add('hidden');
  };

  const getCleanFileName = () => {
    const rawName = fileNameInput?.value.trim();
    return rawName ? `${rawName.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf` : 'html-to-pdf.pdf';
  };

  const setActiveTab = (tab) => {
    activeTab = tab;
    tabButtons.forEach((btn) => {
      const on = btn.getAttribute('data-input-tab') === tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-input-panel') !== tab);
    });
    updatePreview();
  };

  const isValidUrl = (value) => {
    try {
      const u = new URL(value.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const parseHtmlSource = (rawHtml) => {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(rawHtml, 'text/html');
    const hasHtmlWrapper = /<\s*html[\s>]/i.test(rawHtml) || /<\s*body[\s>]/i.test(rawHtml);
    const bodyHtml = hasHtmlWrapper ? (parsed.body ? parsed.body.innerHTML : rawHtml) : rawHtml;
    const styleTags = Array.from(parsed.querySelectorAll('style')).map((s) => s.outerHTML).join('\n');
    const linkTags = Array.from(parsed.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.outerHTML).join('\n');
    return { bodyHtml, styleTags, linkTags };
  };

  const getHtmlContent = () => {
    if (activeTab === 'url') {
      return htmlInput.value.trim();
    }
    return htmlInput.value.trim();
  };

  const wrapPreviewDoc = (rawHtml) => {
    if (!rawHtml) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui;padding:1rem;color:#64748b"><p>Preview appears here when you add HTML content.</p></body></html>';
    }
    if (/<\s*html[\s>]/i.test(rawHtml)) return rawHtml;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;padding:16px;line-height:1.5;}</style></head><body>${rawHtml}</body></html>`;
  };

  const updatePreview = () => {
    if (!previewFrame || !previewWrap || previewWrap.classList.contains('hidden')) return;
    const html = getHtmlContent();
    previewFrame.srcdoc = wrapPreviewDoc(html);
  };

  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 350);
  };

  const waitForImages = (root) => {
    const imgs = Array.from(root.querySelectorAll('img'));
    if (!imgs.length) return Promise.resolve();
    return Promise.all(
      imgs.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth !== 0) resolve();
            else {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 5000);
            }
          })
      )
    );
  };

  /** Avoid tainted canvas: set crossOrigin, drop images that cannot load with CORS. */
  const prepareImagesForCapture = async (root) => {
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise((resolve) => {
            const src = (img.getAttribute('src') || '').trim();
            if (!src || /^data:/i.test(src) || /^blob:/i.test(src)) {
              resolve();
              return;
            }

            let settled = false;
            const finish = (replace) => {
              if (settled) return;
              settled = true;
              if (replace) {
                const ph = document.createElement('div');
                ph.setAttribute('data-img-placeholder', '');
                ph.textContent = 'Image omitted (cross-origin — use a data: URL or self-hosted image)';
                ph.style.cssText = 'padding:10px 14px;margin:6px 0;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#64748b;line-height:1.4;';
                img.replaceWith(ph);
              }
              resolve();
            };

            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('load', () => finish(false), { once: true });
            img.addEventListener('error', () => finish(true), { once: true });

            const current = img.src || src;
            img.src = '';
            img.src = current;
            setTimeout(() => finish(true), 6000);
          })
      )
    );
  };

  const captureToCanvas = async (html2canvasFn, container, options) => {
    return html2canvasFn(container, {
      scale: options.scale,
      useCORS: true,
      allowTaint: false,
      foreignObjectRendering: false,
      backgroundColor: options.backgroundColor,
      logging: false,
      windowWidth: Math.max(document.documentElement.clientWidth, 1024),
      windowHeight: Math.max(document.documentElement.clientHeight, 800),
    });
  };

  const canvasToJpeg = (canvas, quality = 0.98) => {
    try {
      return canvas.toDataURL('image/jpeg', quality);
    } catch (err) {
      if (/tainted|securityerror/i.test(err.message || '')) {
        throw new Error(
          'Could not export PDF because of cross-origin images or CSS backgrounds. Remove external images, use data: URLs, or self-hosted assets — then try again.'
        );
      }
      throw err;
    }
  };

  const ensureLibraries = async () => {
    if (typeof window.html2canvas === 'function' && ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF)) {
      return;
    }
    await new Promise((resolve, reject) => {
      const s1 = document.createElement('script');
      s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s1.onload = () => {
        const s2 = document.createElement('script');
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s2.onload = resolve;
        s2.onerror = () => reject(new Error('Could not load jsPDF library.'));
        document.head.appendChild(s2);
      };
      s1.onerror = () => reject(new Error('Could not load html2canvas library.'));
      document.head.appendChild(s1);
    });
  };

  const fetchUrlToHtml = async () => {
    const url = urlInput?.value.trim();
    if (!isValidUrl(url)) {
      throw new Error('Enter a valid http:// or https:// URL.');
    }

    setProgress(15, 'Fetching webpage…');
    let response;
    try {
      response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    } catch {
      throw new Error(
        'Could not fetch this URL due to browser CORS restrictions. Copy the page HTML (View Source) and paste it in the HTML tab, or save the page as .html and upload it.'
      );
    }

    if (!response.ok) {
      throw new Error(`Could not fetch URL (HTTP ${response.status}). Try pasting HTML instead.`);
    }

    const html = await response.text();
    if (!html.trim()) throw new Error('URL returned empty content.');

    htmlInput.value = html;
    setActiveTab('html');
    setMessage('Page HTML loaded from URL. Review preview and convert to PDF.', 'success');
    schedulePreview();
    return html;
  };

  const loadHtmlFile = async (file) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.html') && !name.endsWith('.htm') && file.type !== 'text/html') {
      throw new Error('Please upload an .html or .htm file.');
    }
    const text = await file.text();
    htmlInput.value = text;
    setActiveTab('html');
    if (fileNameInput && !fileNameInput.value.trim()) {
      fileNameInput.value = file.name.replace(/\.(html|htm)$/i, '');
    }
    schedulePreview();
  };

  const addPageDecorations = (pdf, pageIndex, totalPages, pageWidthMm, pageHeightMm, marginMm) => {
    const header = headerInput?.value.trim();
    const footer = footerInput?.value.trim();
    const showNumbers = pageNumbersCheck?.checked;

    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);

    if (header) {
      /* Clamp so a small margin can't push the header above the page (invisible). */
      const headerY = Math.max(5, marginMm - 3);
      pdf.text(header, pageWidthMm / 2, headerY, { align: 'center' });
    }

    let footerLine = footer || '';
    if (showNumbers) {
      const num = `Page ${pageIndex + 1} of ${totalPages}`;
      footerLine = footerLine ? `${footerLine} · ${num}` : num;
    }
    if (footerLine) {
      /* Clamp so a small margin can't push the footer past the bottom edge (invisible). */
      const footerY = Math.min(pageHeightMm - 4, pageHeightMm - marginMm + 8);
      pdf.text(footerLine, pageWidthMm / 2, footerY, { align: 'center' });
    }
  };

  const convertHtmlToPdf = async () => {
    const rawHtml = getHtmlContent();
    if (!rawHtml) {
      setMessage('Add HTML content — paste code, upload a file, or fetch a CORS-accessible URL.', 'error');
      return;
    }

    toggleLoader(true);
    clearMessage();
    hideDownload();
    setProgress(5, 'Loading PDF engines…');

    let container = null;

    try {
      await ensureLibraries();

      const html2canvasFn = window.html2canvas;
      const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;

      const { bodyHtml, styleTags, linkTags } = parseHtmlSource(rawHtml);
      const scale = Math.min(2.5, Math.max(0.5, parseFloat(scaleInput?.value, 10) || 1));
      const marginMm = Math.min(40, Math.max(0, parseFloat(marginInput?.value, 10) || 10));
      const jsWaitMs = Math.min(10000, Math.max(0, parseInt(jsWaitInput?.value, 10) || 0));
      const captureScale = 2 * scale;
      const renderWidth = Math.round(800 * scale);

      setProgress(20, 'Rendering HTML…');

      container = document.createElement('div');
      container.setAttribute('data-pdf-render-container', '');
      container.style.cssText = [
        'position:absolute', 'left:0',
        `top:${window.scrollY + window.innerHeight + 50}px`,
        `width:${renderWidth}px`, 'height:auto', 'margin:0', 'padding:0',
        bgGraphicsCheck?.checked ? 'background:transparent' : 'background:#ffffff',
        'z-index:-1', 'pointer-events:none', 'overflow:visible',
        'opacity:1', 'visibility:visible', 'display:block',
      ].join(';');

      container.innerHTML = `
        ${linkTags}
        ${styleTags}
        <div data-pdf-inner style="width:${renderWidth}px;padding:24px;${bgGraphicsCheck?.checked ? '' : 'background:#ffffff;'}color:#000000;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;text-align:left;line-height:1.5;">
          ${bodyHtml}
        </div>
      `;

      document.body.appendChild(container);
      await new Promise((r) => requestAnimationFrame(() => r()));
      await prepareImagesForCapture(container);
      await waitForImages(container);
      if (jsWaitMs > 0) await new Promise((r) => setTimeout(r, jsWaitMs));
      else await new Promise((r) => setTimeout(r, 150));

      const inner = container.querySelector('[data-pdf-inner]');
      const rect = inner.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        throw new Error('Rendered HTML has no visible content. Check your markup and CSS.');
      }

      setProgress(45, 'Capturing layout…');

      const canvasOptions = {
        scale: captureScale,
        backgroundColor: bgGraphicsCheck?.checked ? null : '#ffffff',
      };

      let canvas;
      try {
        canvas = await captureToCanvas(html2canvasFn, container, canvasOptions);
      } catch (firstErr) {
        container.querySelectorAll('img').forEach((img) => {
          if (!img.closest('[data-img-placeholder]')) {
            const ph = document.createElement('div');
            ph.textContent = 'Image omitted for PDF export';
            ph.style.cssText = 'padding:8px 12px;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:6px;font-size:11px;color:#64748b;';
            img.replaceWith(ph);
          }
        });
        canvas = await captureToCanvas(html2canvasFn, container, canvasOptions);
      }

      if (!canvas || canvas.width < 5 || canvas.height < 5) {
        throw new Error('Canvas capture failed. Try simplifying CSS or removing external images.');
      }

      setProgress(70, 'Building PDF…');

      const pageSizeKey = ['letter', 'legal'].includes(pageSizeSelect?.value) ? pageSizeSelect.value : 'a4';
      const orientation = pageOrientationSelect?.value === 'landscape' ? 'landscape' : 'portrait';
      const dims = PAGE_DIMENSIONS[pageSizeKey];
      const pageWidthMm = orientation === 'landscape' ? dims.h : dims.w;
      const pageHeightMm = orientation === 'landscape' ? dims.w : dims.h;
      const headerFooterSpace = (headerInput?.value.trim() || footerInput?.value.trim() || pageNumbersCheck?.checked) ? 8 : 0;
      const contentWidthMm = pageWidthMm - marginMm * 2;
      const contentHeightMm = pageHeightMm - marginMm * 2 - headerFooterSpace;

      const imgWidthMm = contentWidthMm;
      const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

      const pdf = new jsPDFCtor({
        unit: 'mm',
        format: pageSizeKey,
        orientation,
        compress: true,
      });

      const imgData = canvasToJpeg(canvas, 0.98);
      let totalPages = 1;

      if (imgHeightMm <= contentHeightMm) {
        pdf.addImage(imgData, 'JPEG', marginMm, marginMm + headerFooterSpace / 2, imgWidthMm, imgHeightMm, undefined, 'FAST');
        totalPages = 1;
      } else {
        const pxPerMm = canvas.width / imgWidthMm;
        const pageSlicePx = Math.floor(contentHeightMm * pxPerMm);
        let renderedPx = 0;
        let pageIndex = 0;
        const slices = [];

        while (renderedPx < canvas.height) {
          const sliceHeightPx = Math.min(pageSlicePx, canvas.height - renderedPx);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          const ctx = sliceCanvas.getContext('2d');
          if (!bgGraphicsCheck?.checked) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          }
          ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
          slices.push({
            data: canvasToJpeg(sliceCanvas, 0.98),
            heightMm: sliceHeightPx / pxPerMm,
          });
          renderedPx += sliceHeightPx;
          pageIndex += 1;
        }

        totalPages = slices.length;
        slices.forEach((slice, i) => {
          if (i > 0) pdf.addPage(pageSizeKey, orientation);
          pdf.addImage(slice.data, 'JPEG', marginMm, marginMm + headerFooterSpace / 2, imgWidthMm, slice.heightMm, undefined, 'FAST');
        });
      }

      for (let i = 0; i < totalPages; i += 1) {
        pdf.setPage(i + 1);
        addPageDecorations(pdf, i, totalPages, pageWidthMm, pageHeightMm, marginMm);
      }

      setProgress(95, 'Finalizing…');

      const blob = pdf.output('blob');
      if (!blob || blob.size < 400) {
        throw new Error('Generated PDF looks empty. Simplify HTML or check for unsupported content.');
      }

      activeBlobUrl = URL.createObjectURL(blob);
      downloadLinks.forEach((link) => {
        link.href = activeBlobUrl;
        link.download = getCleanFileName();
        link.classList.remove('hidden');
      });

      if (resultPanel) resultPanel.classList.remove('hidden');
      setProgress(100, 'Done!');
      setMessage(`PDF created (${totalPages} page${totalPages > 1 ? 's' : ''}). Download below.`, 'success');
    } catch (error) {
      console.error('[HTML to PDF]', error);
      hideProgress();
      setMessage(error.message || 'Failed to generate PDF.', 'error');
    } finally {
      if (container?.parentNode) container.parentNode.removeChild(container);
      toggleLoader(false);
    }
  };

  const resetForAnother = () => {
    hideDownload();
    hideProgress();
    clearMessage();
    if (resultPanel) resultPanel.classList.add('hidden');
  };

  const triggerDownload = (e) => {
    e?.preventDefault();
    if (!activeBlobUrl) return;
    const a = document.createElement('a');
    a.href = activeBlobUrl;
    a.download = getCleanFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.getAttribute('data-input-tab')));
  });

  if (fetchUrlBtn) {
    fetchUrlBtn.addEventListener('click', async () => {
      try {
        toggleLoader(true);
        clearMessage();
        await fetchUrlToHtml();
      } catch (err) {
        setMessage(err.message, 'error');
      } finally {
        toggleLoader(false);
        hideProgress();
      }
    });
  }

  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && fetchUrlBtn) fetchUrlBtn.click();
    });
  }

  htmlInput?.addEventListener('input', schedulePreview);

  filePickers.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      htmlFileInput?.click();
    });
    if (btn.getAttribute('tabindex') === '0') {
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          htmlFileInput?.click();
        }
      });
    }
  });

  htmlFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toggleLoader(true);
      clearMessage();
      await loadHtmlFile(file);
      setMessage('HTML file loaded. Adjust settings and convert to PDF.', 'success');
    } catch (err) {
      setMessage(err.message, 'error');
    } finally {
      toggleLoader(false);
      e.target.value = '';
    }
  });

  if (scaleInput && scaleValue) {
    scaleInput.addEventListener('input', () => {
      scaleValue.textContent = `${parseFloat(scaleInput.value, 10).toFixed(1)}×`;
    });
  }

  if (previewToggle && previewWrap) {
    previewToggle.addEventListener('click', () => {
      const hidden = previewWrap.classList.toggle('hidden');
      previewToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      if (!hidden) updatePreview();
    });
  }

  convertButton?.addEventListener('click', convertHtmlToPdf);
  convertAnotherBtn?.addEventListener('click', resetForAnother);
  downloadLinks.forEach((link) => link.addEventListener('click', triggerDownload));

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      convertButton?.focus();
    });
  }

  setActiveTab('html');
  if (scaleValue && scaleInput) scaleValue.textContent = `${parseFloat(scaleInput.value, 10).toFixed(1)}×`;
});
