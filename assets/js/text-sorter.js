(() => {
  const E = window.TextSorterEngine;
  if (!E) return;

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'tooladda-text-sorter-draft';

  const inputText = $('srtInput');
  const outputText = $('srtOutput');
  const lineCounter = $('srtLineCount');
  const charCounter = $('srtCharCount');
  const statTotalLines = $('srtStatTotal');
  const statUniqueLines = $('srtStatUnique');
  const statTotalChars = $('srtStatChars');
  const statWords = $('srtStatWords');
  const statBlanksRemoved = $('srtStatBlanks');
  const statDuplicatesRemoved = $('srtStatDupes');
  const statShortest = $('srtStatShort');
  const statLongest = $('srtStatLong');
  const sortBtn = $('srtSortBtn');
  const copyBtn = $('srtCopyBtn');
  const copyInputBtn = $('srtCopyInputBtn');
  const downloadTxtBtn = $('srtDownloadTxtBtn');
  const downloadCsvBtn = $('srtDownloadCsvBtn');
  const clearBtn = $('srtClearBtn');
  const swapBtn = $('srtSwapBtn');
  const fileInput = $('srtFile');
  const toolMessage = $('srtMessage');
  const restoreBar = $('srtRestore');
  const restoreBtn = $('srtRestoreBtn');
  const dismissRestoreBtn = $('srtDismissRestore');
  const emptyState = $('srtEmpty');
  const studio = $('srtStudio');

  const optCaseInsensitive = $('optCaseInsensitive');
  const optRemoveBlanks = $('optRemoveBlanks');
  const optRemoveDuplicates = $('optRemoveDuplicates');
  const optTrim = $('optTrim');
  const optReverse = $('optReverse');
  const optIgnoreNumbers = $('optIgnoreNumbers');
  const optIgnorePunctuation = $('optIgnorePunctuation');
  const optLastWord = $('optLastWord');

  const optionEls = [
    optCaseInsensitive, optRemoveBlanks, optRemoveDuplicates, optTrim,
    optReverse, optIgnoreNumbers, optIgnorePunctuation, optLastWord,
  ];

  const readMode = (name, fallback) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : fallback;
  };

  const currentOptions = () => E.normalizeOptions({
    splitMode: readMode('splitMode', 'lines'),
    sortMode: readMode('sortMode', 'az'),
    caseInsensitive: Boolean(optCaseInsensitive?.checked),
    removeBlanks: Boolean(optRemoveBlanks?.checked),
    removeDuplicates: Boolean(optRemoveDuplicates?.checked),
    trim: Boolean(optTrim?.checked),
    reverse: Boolean(optReverse?.checked),
    ignoreNumbers: Boolean(optIgnoreNumbers?.checked),
    ignorePunctuation: Boolean(optIgnorePunctuation?.checked),
    lastWord: Boolean(optLastWord?.checked),
  });

  const showMessage = (text, tone) => {
    if (!toolMessage) return;
    toolMessage.hidden = false;
    toolMessage.dataset.tone = tone === 'bad' ? 'bad' : 'good';
    toolMessage.textContent = text;
  };

  const clearMessage = () => {
    if (!toolMessage) return;
    toolMessage.hidden = true;
    toolMessage.textContent = '';
    delete toolMessage.dataset.tone;
  };

  const syncTabBars = () => {
    document.querySelectorAll('.srt-tabs').forEach((bar) => {
      bar.querySelectorAll('.srt-chip').forEach((tab) => {
        const input = tab.querySelector('input');
        tab.classList.toggle('is-active', Boolean(input && input.checked));
      });
    });
  };

  const updateCountersAndStats = () => {
    if (!inputText) return;
    const opts = currentOptions();
    const units = E.splitUnits(inputText.value, opts.splitMode);
    const isWords = opts.splitMode === 'words';
    const stats = E.computeStats(units, opts);

    if (lineCounter) {
      lineCounter.textContent = String(isWords
        ? units.filter((u) => u.trim() !== '').length
        : (opts.removeBlanks
          ? units.filter((l) => (opts.trim ? l.trim() : l) !== '').length
          : units.length));
    }
    if (charCounter) charCounter.textContent = String((inputText.value || '').length);
    if (statTotalLines) statTotalLines.textContent = String(stats.originalTotalLines);
    if (statUniqueLines) statUniqueLines.textContent = String(stats.uniqueLines);
    if (statTotalChars) statTotalChars.textContent = String(stats.originalChars);
    if (statWords) statWords.textContent = String(isWords ? units.filter((u) => u.trim() !== '').length : stats.words);
    if (statBlanksRemoved) statBlanksRemoved.textContent = String(stats.blanksRemoved);
    if (statDuplicatesRemoved) statDuplicatesRemoved.textContent = String(stats.duplicatesRemoved);
    if (statShortest) statShortest.textContent = String(stats.shortest);
    if (statLongest) statLongest.textContent = String(stats.longest);
    if (emptyState) emptyState.hidden = (inputText.value || '').trim().length > 0;
  };

  const persistDraft = () => {
    try {
      const payload = {
        text: inputText?.value || '',
        options: currentOptions(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) { /* private mode */ }
  };

  const applyOptions = (options) => {
    const opts = E.normalizeOptions(options);
    document.querySelectorAll('input[name="splitMode"]').forEach((el) => {
      el.checked = el.value === opts.splitMode;
    });
    document.querySelectorAll('input[name="sortMode"]').forEach((el) => {
      el.checked = el.value === opts.sortMode;
    });
    if (optCaseInsensitive) optCaseInsensitive.checked = opts.caseInsensitive;
    if (optRemoveBlanks) optRemoveBlanks.checked = opts.removeBlanks;
    if (optRemoveDuplicates) optRemoveDuplicates.checked = opts.removeDuplicates;
    if (optTrim) optTrim.checked = opts.trim;
    if (optReverse) optReverse.checked = opts.reverse;
    if (optIgnoreNumbers) optIgnoreNumbers.checked = opts.ignoreNumbers;
    if (optIgnorePunctuation) optIgnorePunctuation.checked = opts.ignorePunctuation;
    if (optLastWord) optLastWord.checked = opts.lastWord;
    syncTabBars();
  };

  const performSort = (silent) => {
    const raw = inputText?.value || '';
    if (!raw.trim()) {
      if (outputText) outputText.value = '';
      if (!silent) showMessage('Paste some text first.', 'bad');
      updateCountersAndStats();
      return;
    }

    const result = E.sortText(raw, currentOptions());
    if (outputText) outputText.value = result.text;
    updateCountersAndStats();
    persistDraft();
    if (!silent) {
      showMessage(result.truncated
        ? 'Sorted the first part of a very large list. Trim the input if you need everything.'
        : 'Text sorted.', 'good');
    }
  };

  const autoSort = () => {
    if (!(inputText?.value || '').trim()) return;
    performSort(true);
  };

  const tryCopy = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      showMessage(okMsg, 'good');
      return;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          showMessage(okMsg, 'good');
          return;
        }
      } catch (err) { /* fall through */ }
    }
    showMessage('Copy failed. Select the text and copy it yourself.', 'bad');
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
  };

  const handleSort = () => performSort(false);

  const handleCopy = () => {
    const text = outputText?.value || '';
    if (!text.trim()) {
      showMessage('Nothing to copy yet. Sort some text first.', 'bad');
      return;
    }
    tryCopy(text, 'Sorted text copied.');
  };

  const handleCopyInput = () => {
    const text = inputText?.value || '';
    if (!text.trim()) {
      showMessage('Nothing in the input to copy.', 'bad');
      return;
    }
    tryCopy(text, 'Input copied.');
  };

  const handleDownloadTxt = () => {
    const text = outputText?.value || '';
    if (!text.trim()) {
      showMessage('Nothing to download yet. Sort some text first.', 'bad');
      return;
    }
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'text-sorter-result.txt');
    showMessage('TXT downloaded.', 'good');
  };

  const handleDownloadCsv = () => {
    const text = outputText?.value || '';
    if (!text.trim()) {
      showMessage('Nothing to download yet. Sort some text first.', 'bad');
      return;
    }
    const opts = currentOptions();
    const parts = opts.splitMode === 'words' ? text.trim().split(/\s+/) : text.split(/\r?\n/);
    downloadBlob(new Blob([E.toCsv(parts)], { type: 'text/csv;charset=utf-8' }), 'text-sorter-result.csv');
    showMessage('CSV downloaded.', 'good');
  };

  const handleClear = () => {
    if (inputText) inputText.value = '';
    if (outputText) outputText.value = '';
    clearMessage();
    updateCountersAndStats();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    showMessage('Cleared.', 'good');
  };

  const handleSwap = () => {
    if (!inputText || !outputText) return;
    const inVal = inputText.value;
    inputText.value = outputText.value;
    outputText.value = inVal;
    clearMessage();
    updateCountersAndStats();
    persistDraft();
  };

  const loadSample = (id) => {
    const sample = E.SAMPLES[id] || E.SAMPLES.fruits;
    if (inputText) inputText.value = sample;
    if (id === 'words') {
      const wordsRadio = document.querySelector('input[name="splitMode"][value="words"]');
      if (wordsRadio) wordsRadio.checked = true;
    }
    if (id === 'files') {
      const natural = document.querySelector('input[name="sortMode"][value="natural"]');
      if (natural) natural.checked = true;
    }
    if (id === 'names') {
      if (optLastWord) optLastWord.checked = true;
    }
    syncTabBars();
    clearMessage();
    updateCountersAndStats();
    autoSort();
    persistDraft();
  };

  const readFile = (file) => {
    if (!file) return;
    const type = String(file.type || '');
    const name = String(file.name || '').toLowerCase();
    if (type && !type.startsWith('text/') && type !== 'application/json' && type !== 'application/csv') {
      if (!/\.(txt|csv|md|json|log)$/.test(name)) {
        showMessage('Use a text file (.txt, .csv, .md).', 'bad');
        return;
      }
    }
    if (file.size > E.MAX_CHARS) {
      showMessage('That file is too large for the browser sorter.', 'bad');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (inputText) inputText.value = E.capText(String(reader.result || ''));
      clearMessage();
      updateCountersAndStats();
      autoSort();
      persistDraft();
      showMessage('File loaded.', 'good');
    };
    reader.onerror = () => showMessage('Could not read that file.', 'bad');
    reader.readAsText(file);
  };

  const setPane = (pane) => {
    if (!studio) return;
    studio.dataset.pane = pane;
    document.querySelectorAll('.srt-mobtab').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.pane === pane));
    });
  };

  const maybeOfferRestore = () => {
    if (!restoreBar) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.text || !String(saved.text).trim()) return;
    if ((inputText?.value || '').trim()) return;
    restoreBar.hidden = false;
    restoreBtn?.addEventListener('click', () => {
      if (inputText) inputText.value = saved.text;
      applyOptions(saved.options);
      restoreBar.hidden = true;
      updateCountersAndStats();
      autoSort();
    }, { once: true });
    dismissRestoreBtn?.addEventListener('click', () => {
      restoreBar.hidden = true;
    }, { once: true });
  };

  inputText?.addEventListener('input', () => {
    clearMessage();
    updateCountersAndStats();
    autoSort();
    persistDraft();
  });

  optionEls.forEach((el) => {
    el?.addEventListener('change', () => {
      clearMessage();
      updateCountersAndStats();
      autoSort();
      persistDraft();
    });
  });

  document.querySelectorAll('input[name="sortMode"], input[name="splitMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      clearMessage();
      syncTabBars();
      updateCountersAndStats();
      autoSort();
      persistDraft();
    });
  });

  sortBtn?.addEventListener('click', handleSort);
  copyBtn?.addEventListener('click', handleCopy);
  copyInputBtn?.addEventListener('click', handleCopyInput);
  downloadTxtBtn?.addEventListener('click', handleDownloadTxt);
  downloadCsvBtn?.addEventListener('click', handleDownloadCsv);
  clearBtn?.addEventListener('click', handleClear);
  swapBtn?.addEventListener('click', handleSwap);
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    readFile(file);
    fileInput.value = '';
  });

  document.querySelectorAll('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', () => loadSample(btn.getAttribute('data-sample')));
  });

  document.querySelectorAll('.srt-mobtab').forEach((btn) => {
    btn.addEventListener('click', () => setPane(btn.dataset.pane));
  });

  const drop = $('srtDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach((type) => {
      drop.addEventListener(type, (ev) => {
        ev.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      drop.addEventListener(type, (ev) => {
        ev.preventDefault();
        drop.classList.remove('is-over');
      });
    });
    drop.addEventListener('drop', (ev) => {
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      readFile(file);
    });
  }

  syncTabBars();
  updateCountersAndStats();
  maybeOfferRestore();
})();
