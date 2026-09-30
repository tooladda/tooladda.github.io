/* ==========================================================================
   ToolAdda — CSV to Interactive Chart (studio UI)
   Wires the import surface, data grid, chart controls and export bar to the
   dependency-free renderer in csv-chart-engine.js.

   Everything runs locally: no CSV ever leaves the browser.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.CSVChartEngine;
  if (!E) return;

  var MAX_CHART_POINTS = 3000;
  var MAX_PIE_SLICES = 24;
  var LARGE_ROWS = 20000;
  var PAGE_SIZE = 50;

  /* ======================================================================
     State — one source of truth
     ====================================================================== */

  var state = {
    importedCSV: '',        // exactly what the user gave us (never mutated)
    workingCSV: '',         // current CSV after any raw edits
    delimiter: ',',
    hasHeader: true,
    dataset: null,
    viewIndices: [],
    hiddenColumns: {},
    search: '',
    sort: { column: null, direction: 'asc' },
    filters: [],
    page: 0,
    chart: {
      type: 'bar',
      xAxis: null,
      scatterX: null,
      series: [],           // column indices
      hiddenSeries: {},     // seriesIndex -> true
      colors: {},           // columnIndex -> '#rrggbb'
      palette: 'default',
      aggregation: 'none',
      missing: 'skip',
      title: '',
      titleTouched: false,
      xTitle: '',
      yTitle: '',
      options: null
    },
    renderer: null,
    fullscreen: false
  };

  state.chart.options = JSON.parse(JSON.stringify(E.DEFAULT_OPTIONS));

  var dom = {};
  var searchTimer = 0;
  var editorTimer = 0;

  /* ======================================================================
     DOM helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }

  function on(node, event, handler, opts) {
    if (node) node.addEventListener(event, handler, opts);
  }

  function make(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined && textContent !== null) node.textContent = String(textContent);
    return node;
  }

  function setText(node, value) { if (node) node.textContent = String(value); }

  function fmtInt(n) {
    try { return Number(n).toLocaleString(); } catch (e) { return String(n); }
  }

  var statusTimer = 0;
  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 4200);
  }

  function announce(message) {
    if (dom.live) dom.live.textContent = message;
  }

  function importError(message) {
    if (!dom.importError) return;
    if (!message) { dom.importError.hidden = true; dom.importError.textContent = ''; return; }
    dom.importError.textContent = message;
    dom.importError.hidden = false;
    announce(message);
  }

  function copyText(value, label) {
    function done() { status((label || 'Copied') + ' ✓', 'good'); }
    function fail() { status('Your browser blocked clipboard access. Select the text and copy manually.', 'bad'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, function () { legacyCopy(value) ? done() : fail(); });
    } else {
      legacyCopy(value) ? done() : fail();
    }
  }

  function legacyCopy(value) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function downloadText(content, filename, mime) {
    downloadBlob(new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' }), filename);
  }

  /* ======================================================================
     Sample datasets
     ====================================================================== */

  var SAMPLES = {
    sales: {
      label: 'Monthly sales & profit',
      csv: 'Month,Sales,Profit,Expenses\nJanuary,12000,3500,8500\nFebruary,15000,4200,10800\nMarch,18000,5100,12900\nApril,21000,6200,14800\nMay,19500,5800,13700\nJune,23400,7100,16300\nJuly,25100,7900,17200\nAugust,22800,6600,16200\nSeptember,26900,8400,18500\nOctober,29500,9600,19900\nNovember,31200,10100,21100\nDecember,35800,12400,23400\n'
    },
    traffic: {
      label: 'Website traffic',
      csv: 'Date,Visitors,Conversions,Bounce Rate\n2026-01-01,1200,80,52%\n2026-02-01,1450,95,49%\n2026-03-01,1800,120,47%\n2026-04-01,2100,142,45%\n2026-05-01,2450,171,44%\n2026-06-01,2380,166,46%\n2026-07-01,2790,205,41%\n2026-08-01,3120,238,39%\n'
    },
    products: {
      label: 'Product performance',
      csv: 'Product,Sales,Rating,Returns\nProduct A,1200,4.5,32\nProduct B,950,4.2,41\nProduct C,1500,4.8,18\nProduct D,720,3.9,55\nProduct E,1840,4.7,24\nProduct F,610,3.6,63\n'
    },
    regions: {
      label: 'Regional revenue (quoted fields)',
      csv: 'Region,City,Revenue,Growth\nNorth,"New York, NY",125500,12%\nNorth,"Boston, MA",84200,8%\nSouth,"Austin, TX",96700,19%\nSouth,"Miami, FL",71300,6%\nWest,"San Francisco, CA",158900,15%\nWest,"Seattle, WA",112400,11%\nEast,"Atlanta, GA",68800,9%\nEast,"Charlotte, NC",54100,4%\n'
    }
  };

  /* ======================================================================
     Import
     ====================================================================== */

  function handleFileUpload(file) {
    importError('');
    if (!file) return;

    var name = (file.name || '').toLowerCase();
    var okType = /\.(csv|tsv|txt)$/.test(name) ||
      file.type === 'text/csv' || file.type === 'application/csv' ||
      file.type === 'text/tab-separated-values' || file.type === 'text/plain';

    if (!okType) {
      importError('Please select a valid CSV file. Accepted: .csv (also .tsv and .txt).');
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      importError('That file is larger than 40 MB. Try splitting it, or filter it down before importing.');
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () { importError('The file could not be read. It may be locked by another program.'); };
    reader.onload = function () {
      var ok = ingestCSV(String(reader.result || ''), file.name);
      if (ok) status('Imported ' + file.name, 'good');
    };
    reader.readAsText(file, 'UTF-8');
  }

  /**
   * Parse CSV text and rebuild every derived view.
   * Returns true when the import produced a usable dataset.
   */
  function ingestCSV(rawText, sourceName) {
    var text = String(rawText || '');
    if (!text.trim()) {
      importError('CSV file is empty. Paste some rows or pick another file.');
      return false;
    }

    var delimiter = E.detectDelimiter(text);
    var parsed = E.parseCSVText(text, delimiter);

    if (!parsed.rows.length) {
      importError('No rows could be read from that CSV.');
      return false;
    }

    var hasHeader = E.looksLikeHeader(parsed.rows);
    var dataset = E.buildDataset(parsed.rows, hasHeader);

    if (!dataset.columns.length) {
      importError('Could not detect any columns in that CSV.');
      return false;
    }
    if (!dataset.rows.length) {
      importError('That CSV only contains a header row — there is no data to chart.');
      return false;
    }

    state.importedCSV = text;
    state.workingCSV = text;
    state.delimiter = parsed.delimiter;
    state.hasHeader = hasHeader;
    state.dataset = dataset;
    state.filters = [];
    state.search = '';
    state.sort = { column: null, direction: 'asc' };
    state.page = 0;
    state.hiddenColumns = {};
    state.chart.hiddenSeries = {};
    state.chart.colors = {};
    state.chart.titleTouched = false;

    if (dom.search) dom.search.value = '';
    if (dom.headerToggle) dom.headerToggle.checked = hasHeader;
    if (dom.delimiterSelect) dom.delimiterSelect.value = parsed.delimiter;

    importError('');
    if (parsed.unterminated) {
      status('A quoted field was left open in the CSV — the last value may be merged.', 'warn');
    }

    autoSelectColumns();
    afterDatasetChange(true);

    document.body.classList.add('cvz-has-data');
    if (dom.studio) dom.studio.dataset.state = 'ready';
    if (dom.sourceName) setText(dom.sourceName, sourceName || 'Pasted data');

    if (dataset.rows.length > LARGE_ROWS) {
      status('Large dataset detected — ' + fmtInt(dataset.rows.length) + ' rows. The table is paginated and the chart is capped at ' + fmtInt(MAX_CHART_POINTS) + ' points.', 'warn');
    }

    announce('CSV imported. ' + fmtInt(dataset.rows.length) + ' rows and ' + dataset.columns.length + ' columns detected.');

    if (isMobileStudio()) setActivePane('chart');

    return true;
  }

  /** Re-parse the working CSV after a header/delimiter/editor change. */
  function reparseWorking(options) {
    var opts = options || {};
    var delimiter = opts.delimiter || state.delimiter;
    var parsed = E.parseCSVText(state.workingCSV, delimiter);
    var hasHeader = opts.hasHeader === undefined ? state.hasHeader : opts.hasHeader;
    var dataset = E.buildDataset(parsed.rows, hasHeader);

    if (!dataset.columns.length || !dataset.rows.length) {
      status('That combination leaves no data rows. Reverting.', 'bad');
      return false;
    }

    state.delimiter = delimiter;
    state.hasHeader = hasHeader;
    state.dataset = dataset;
    state.filters = state.filters.filter(function (f) { return f.column < dataset.columns.length; });
    if (state.sort.column !== null && state.sort.column >= dataset.columns.length) state.sort.column = null;
    state.page = 0;
    autoSelectColumns();
    afterDatasetChange(true);
    return true;
  }

  /* ======================================================================
     Column selection helpers
     ====================================================================== */

  function numericColumns() {
    return state.dataset.columns.filter(function (c) { return c.type === 'number'; });
  }

  function columnsOfType(type) {
    return state.dataset.columns.filter(function (c) { return c.type === type; });
  }

  /** Pick a sensible X axis, series and chart type for freshly imported data. */
  function autoSelectColumns() {
    var cols = state.dataset.columns;
    var nums = numericColumns();
    var dates = columnsOfType('date');
    var strings = cols.filter(function (c) { return c.type === 'string' || c.type === 'boolean'; });

    var x = dates.length ? dates[0] : (strings.length ? strings[0] : (cols.length ? cols[0] : null));
    state.chart.xAxis = x ? x.index : null;

    state.chart.series = nums.slice(0, 3).map(function (c) { return c.index; });
    state.chart.scatterX = nums.length ? nums[0].index : null;
    if (nums.length > 1 && state.chart.series.length > 1 && state.chart.series[0] === state.chart.scatterX) {
      // scatter defaults to first numeric on X, second on Y
    }

    state.chart.type = suggestChartType();
    state.chart.hiddenSeries = {};
    if (!state.chart.titleTouched) state.chart.title = defaultTitle();
  }

  /** Requirement: suggest, never force. */
  function suggestChartType() {
    var cols = state.dataset.columns;
    var nums = numericColumns();
    var dates = columnsOfType('date');
    var x = state.chart.xAxis !== null ? cols[state.chart.xAxis] : null;

    if (!nums.length) return 'bar';
    if (dates.length && x && x.type === 'date') return nums.length > 1 ? 'line' : 'area';
    if (x && x.type === 'number' && nums.length >= 2) return 'scatter';
    if (x && nums.length === 1 && x.distinctCount > 1 && x.distinctCount <= 8) return 'doughnut';
    return 'bar';
  }

  function defaultTitle() {
    var cols = state.dataset ? state.dataset.columns : [];
    var x = state.chart.xAxis !== null && cols[state.chart.xAxis] ? cols[state.chart.xAxis].name : '';
    var names = state.chart.series.map(function (i) { return cols[i] ? cols[i].name : ''; }).filter(Boolean);
    if (!names.length) return 'Chart';
    var lead = names.length > 2 ? names.slice(0, 2).join(', ') + ' and more' : names.join(' & ');
    return x ? lead + ' by ' + x : lead;
  }

  /* ======================================================================
     Data pipeline: filter → search → sort
     ====================================================================== */

  function filterData() {
    var visibleCols = state.dataset.columns
      .map(function (c) { return c.index; })
      .filter(function (i) { return !state.hiddenColumns[i]; });
    return E.filterRows(state.dataset, state.filters, state.search, visibleCols);
  }

  function sortData(indices) {
    if (state.sort.column === null) return indices;
    return E.sortRowIndices(state.dataset, indices, state.sort.column, state.sort.direction);
  }

  function recomputeView() {
    state.viewIndices = sortData(filterData());
    var maxPage = Math.max(0, Math.ceil(state.viewIndices.length / PAGE_SIZE) - 1);
    if (state.page > maxPage) state.page = maxPage;
  }

  /** Everything downstream of the dataset, in one place. */
  function afterDatasetChange(rebuildControls) {
    recomputeView();
    renderSummary();
    if (rebuildControls) {
      renderAxisControls();
      renderSeriesControls();
      renderColumnToggles();
      renderFilterRows();
      syncChartInputs();
    }
    renderDataTable();
    applyTypeVisibility();
    updateChart();
  }

  function refreshData() {
    recomputeView();
    renderSummary();
    renderDataTable();
    updateChart();
  }

  /* ======================================================================
     Summary
     ====================================================================== */

  function renderSummary() {
    if (!state.dataset) return;
    var ds = state.dataset;
    setText(dom.statRows, fmtInt(ds.rows.length));
    setText(dom.statCols, fmtInt(ds.columns.length));
    setText(dom.statNumeric, fmtInt(numericColumns().length));
    setText(dom.statDates, fmtInt(columnsOfType('date').length));
    setText(dom.statMissing, fmtInt(ds.missing));
    setText(dom.statDelimiter, E.delimiterLabel(state.delimiter));
    setText(dom.statFiltered, fmtInt(state.viewIndices.length));
  }

  /* ======================================================================
     Data table
     ====================================================================== */

  var TYPE_LABELS = { number: '123', date: 'date', string: 'text', boolean: 'bool', empty: 'empty' };

  function renderDataTable() {
    if (!dom.thead || !dom.tbody || !state.dataset) return;

    var cols = state.dataset.columns.filter(function (c) { return !state.hiddenColumns[c.index]; });

    /* header */
    while (dom.thead.firstChild) dom.thead.removeChild(dom.thead.firstChild);
    var headRow = document.createElement('tr');

    var indexTh = make('th', 'cvz-th cvz-th--idx', '#');
    indexTh.scope = 'col';
    headRow.appendChild(indexTh);

    cols.forEach(function (col) {
      var th = make('th', 'cvz-th');
      th.scope = 'col';
      var btn = make('button', 'cvz-sortbtn');
      btn.type = 'button';
      var isSorted = state.sort.column === col.index;
      btn.setAttribute('aria-label', 'Sort by ' + col.name +
        (isSorted && state.sort.direction === 'asc' ? ', currently ascending' : isSorted ? ', currently descending' : ''));

      btn.appendChild(make('span', 'cvz-sortbtn__name', col.name));
      btn.appendChild(make('span', 'cvz-tag cvz-tag--' + col.type, TYPE_LABELS[col.type] || col.type));
      var arrow = make('span', 'cvz-sortbtn__arrow', isSorted ? (state.sort.direction === 'asc' ? '▲' : '▼') : '↕');
      arrow.setAttribute('aria-hidden', 'true');
      btn.appendChild(arrow);

      th.setAttribute('aria-sort', isSorted ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      btn.addEventListener('click', function () {
        if (state.sort.column === col.index) {
          state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort.column = col.index;
          state.sort.direction = 'asc';
        }
        state.page = 0;
        refreshData();
        renderDataTable();
      });
      th.appendChild(btn);
      headRow.appendChild(th);
    });
    dom.thead.appendChild(headRow);

    /* body */
    while (dom.tbody.firstChild) dom.tbody.removeChild(dom.tbody.firstChild);

    var total = state.viewIndices.length;
    var start = state.page * PAGE_SIZE;
    var slice = state.viewIndices.slice(start, start + PAGE_SIZE);

    if (!slice.length) {
      var emptyRow = document.createElement('tr');
      var td = make('td', 'cvz-empty-cell', total === 0
        ? 'No rows match the current search and filters.'
        : 'Nothing on this page.');
      td.colSpan = cols.length + 1;
      emptyRow.appendChild(td);
      dom.tbody.appendChild(emptyRow);
    } else {
      var frag = document.createDocumentFragment();
      slice.forEach(function (rowIndex, i) {
        var tr = document.createElement('tr');
        tr.appendChild(make('td', 'cvz-td cvz-td--idx', fmtInt(start + i + 1)));
        cols.forEach(function (col) {
          var raw = state.dataset.rows[rowIndex][col.index];
          var cell = make('td', 'cvz-td' + (col.type === 'number' ? ' cvz-td--num' : ''));
          if (raw === '' || raw === undefined) {
            var dash = make('span', 'cvz-null', '—');
            dash.title = 'Missing value';
            cell.appendChild(dash);
          } else {
            // textContent only — CSV content is never interpreted as markup.
            cell.textContent = raw;
            cell.title = raw;
          }
          tr.appendChild(cell);
        });
        frag.appendChild(tr);
      });
      dom.tbody.appendChild(frag);
    }

    var showing = slice.length ? (fmtInt(start + 1) + '–' + fmtInt(start + slice.length)) : '0';
    setText(dom.tableInfo, 'Showing ' + showing + ' of ' + fmtInt(total) + ' rows' +
      (total !== state.dataset.rows.length ? ' (filtered from ' + fmtInt(state.dataset.rows.length) + ')' : ''));

    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    setText(dom.pageInfo, 'Page ' + (state.page + 1) + ' of ' + pages);
    if (dom.prevPage) dom.prevPage.disabled = state.page <= 0;
    if (dom.nextPage) dom.nextPage.disabled = state.page >= pages - 1;
  }

  function renderColumnToggles() {
    if (!dom.columnList || !state.dataset) return;
    while (dom.columnList.firstChild) dom.columnList.removeChild(dom.columnList.firstChild);

    state.dataset.columns.forEach(function (col) {
      var id = 'cvz-colvis-' + col.index;
      var wrap = make('label', 'cvz-check');
      wrap.setAttribute('for', id);
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = !state.hiddenColumns[col.index];
      input.addEventListener('change', function () {
        if (input.checked) delete state.hiddenColumns[col.index];
        else state.hiddenColumns[col.index] = true;
        refreshData();
        renderDataTable();
      });
      wrap.appendChild(input);
      wrap.appendChild(make('span', null, col.name));
      wrap.appendChild(make('span', 'cvz-tag cvz-tag--' + col.type, TYPE_LABELS[col.type] || col.type));
      dom.columnList.appendChild(wrap);
    });
  }

  /* ======================================================================
     Filters
     ====================================================================== */

  function renderFilterRows() {
    if (!dom.filterList || !state.dataset) return;
    while (dom.filterList.firstChild) dom.filterList.removeChild(dom.filterList.firstChild);

    if (!state.filters.length) {
      dom.filterList.appendChild(make('p', 'cvz-hint', 'No filters yet. Add one to narrow the rows feeding the chart.'));
      return;
    }

    state.filters.forEach(function (filter, i) {
      var row = make('div', 'cvz-filter');

      var colSelect = document.createElement('select');
      colSelect.className = 'cvz-select cvz-select--sm';
      colSelect.setAttribute('aria-label', 'Filter ' + (i + 1) + ' column');
      state.dataset.columns.forEach(function (col) {
        var opt = document.createElement('option');
        opt.value = String(col.index);
        opt.textContent = col.name;
        if (col.index === filter.column) opt.selected = true;
        colSelect.appendChild(opt);
      });
      colSelect.addEventListener('change', function () {
        filter.column = Number(colSelect.value);
        state.page = 0;
        refreshData();
        renderDataTable();
      });

      var opSelect = document.createElement('select');
      opSelect.className = 'cvz-select cvz-select--sm';
      opSelect.setAttribute('aria-label', 'Filter ' + (i + 1) + ' operator');
      E.OPERATORS.forEach(function (op) {
        var opt = document.createElement('option');
        opt.value = op.id;
        opt.textContent = op.label;
        if (op.id === filter.operator) opt.selected = true;
        opSelect.appendChild(opt);
      });
      opSelect.addEventListener('change', function () {
        filter.operator = opSelect.value;
        valueInput.disabled = filter.operator === 'empty' || filter.operator === 'nempty';
        state.page = 0;
        refreshData();
        renderDataTable();
      });

      var valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'cvz-input cvz-input--sm';
      valueInput.value = filter.value || '';
      valueInput.placeholder = 'Value';
      valueInput.setAttribute('aria-label', 'Filter ' + (i + 1) + ' value');
      valueInput.disabled = filter.operator === 'empty' || filter.operator === 'nempty';
      valueInput.addEventListener('input', function () {
        filter.value = valueInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          state.page = 0;
          refreshData();
          renderDataTable();
        }, 220);
      });

      var remove = make('button', 'cvz-iconbtn', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove filter ' + (i + 1));
      remove.addEventListener('click', function () {
        state.filters.splice(i, 1);
        state.page = 0;
        renderFilterRows();
        refreshData();
        renderDataTable();
      });

      row.appendChild(colSelect);
      row.appendChild(opSelect);
      row.appendChild(valueInput);
      row.appendChild(remove);
      dom.filterList.appendChild(row);
    });
  }

  /* ======================================================================
     Chart controls
     ====================================================================== */

  function renderAxisControls() {
    if (!dom.xAxis || !state.dataset) return;

    function fill(select, columns, selectedIndex) {
      while (select.firstChild) select.removeChild(select.firstChild);
      columns.forEach(function (col) {
        var opt = document.createElement('option');
        opt.value = String(col.index);
        opt.textContent = col.name + ' · ' + (TYPE_LABELS[col.type] || col.type);
        if (col.index === selectedIndex) opt.selected = true;
        select.appendChild(opt);
      });
    }

    fill(dom.xAxis, state.dataset.columns, state.chart.xAxis);
    fill(dom.scatterX, numericColumns(), state.chart.scatterX);
  }

  function renderSeriesControls() {
    if (!dom.seriesList || !state.dataset) return;
    while (dom.seriesList.firstChild) dom.seriesList.removeChild(dom.seriesList.firstChild);

    var nums = numericColumns();
    if (!nums.length) {
      dom.seriesList.appendChild(make('p', 'cvz-hint',
        'No numeric columns were detected. Import a CSV containing numeric data, or check that numbers are not wrapped in text.'));
      return;
    }

    var palette = E.paletteColors(state.chart.palette, isDarkTheme());

    nums.forEach(function (col) {
      var active = state.chart.series.indexOf(col.index) !== -1;
      var row = make('div', 'cvz-series' + (active ? ' is-active' : ''));

      var id = 'cvz-series-' + col.index;
      var label = make('label', 'cvz-series__label');
      label.setAttribute('for', id);

      var check = document.createElement('input');
      check.type = 'checkbox';
      check.id = id;
      check.checked = active;
      check.addEventListener('change', function () {
        if (check.checked) {
          if (state.chart.series.indexOf(col.index) === -1) state.chart.series.push(col.index);
        } else {
          state.chart.series = state.chart.series.filter(function (i) { return i !== col.index; });
        }
        state.chart.hiddenSeries = {};
        if (!state.chart.titleTouched) { state.chart.title = defaultTitle(); if (dom.title) dom.title.value = state.chart.title; }
        renderSeriesControls();
        updateChart();
      });

      label.appendChild(check);
      label.appendChild(make('span', 'cvz-series__name', col.name));

      var swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'cvz-swatch';
      swatch.setAttribute('aria-label', 'Colour for ' + col.name);
      var order = state.chart.series.indexOf(col.index);
      swatch.value = state.chart.colors[col.index] || palette[(order === -1 ? nums.indexOf(col) : order) % palette.length];
      swatch.addEventListener('input', function () {
        state.chart.colors[col.index] = swatch.value;
        updateChart();
      });

      row.appendChild(label);
      row.appendChild(swatch);

      if (active) {
        var remove = make('button', 'cvz-iconbtn cvz-iconbtn--ghost', '✕');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + col.name + ' from the chart');
        remove.addEventListener('click', function () {
          state.chart.series = state.chart.series.filter(function (i) { return i !== col.index; });
          state.chart.hiddenSeries = {};
          if (!state.chart.titleTouched) { state.chart.title = defaultTitle(); if (dom.title) dom.title.value = state.chart.title; }
          renderSeriesControls();
          updateChart();
        });
        row.appendChild(remove);
      }

      dom.seriesList.appendChild(row);
    });

    if (dom.addSeries) {
      var remaining = nums.filter(function (c) { return state.chart.series.indexOf(c.index) === -1; });
      dom.addSeries.disabled = !remaining.length;
      dom.addSeries.textContent = remaining.length ? '+ Add series' : 'All series added';
    }
  }

  function syncChartInputs() {
    var c = state.chart;
    var o = c.options;
    if (dom.title) dom.title.value = c.title;
    if (dom.xTitle) dom.xTitle.value = c.xTitle;
    if (dom.yTitle) dom.yTitle.value = c.yTitle;
    if (dom.palette) dom.palette.value = c.palette;
    if (dom.aggregation) dom.aggregation.value = c.aggregation;
    if (dom.missing) dom.missing.value = c.missing;
    if (dom.legend) dom.legend.checked = o.legend;
    if (dom.legendPos) dom.legendPos.value = o.legendPosition;
    if (dom.gridX) dom.gridX.checked = o.gridX;
    if (dom.gridY) dom.gridY.checked = o.gridY;
    if (dom.tooltips) dom.tooltips.checked = o.tooltips;
    if (dom.zoomToggle) dom.zoomToggle.checked = o.zoom;
    if (dom.markers) dom.markers.checked = o.markers;
    if (dom.showLabels) dom.showLabels.checked = o.showLabels;
    if (dom.showPercent) dom.showPercent.checked = o.showPercent;
    if (dom.curve) dom.curve.value = o.curve;
    setRange(dom.lineWidth, o.lineWidth);
    setRange(dom.pointSize, o.pointSize);
    setRange(dom.fillOpacity, Math.round(o.fillOpacity * 100));
    setRange(dom.barRadius, o.barRadius);
    setRange(dom.innerRatio, Math.round(o.innerRatio * 100));
    setRange(dom.sliceGap, o.sliceGap);
    setRange(dom.height, o.height);
    updateChartTypeButtons();
  }

  function setRange(input, value) {
    if (!input) return;
    input.value = String(value);
    var out = input.parentNode ? input.parentNode.querySelector('output') : null;
    if (out) out.textContent = input.dataset.suffix ? value + input.dataset.suffix : String(value);
  }

  function updateChartTypeButtons() {
    if (!dom.typeButtons) return;
    dom.typeButtons.forEach(function (btn) {
      var active = btn.dataset.charttype === state.chart.type;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  /** Only surface controls that mean something for the current chart type. */
  function applyTypeVisibility() {
    var type = state.chart.type;
    var groups = document.querySelectorAll('[data-when]');
    for (var i = 0; i < groups.length; i++) {
      var list = groups[i].getAttribute('data-when').split(/\s+/);
      groups[i].hidden = list.indexOf(type) === -1;
    }
    var notFor = document.querySelectorAll('[data-not-when]');
    for (var j = 0; j < notFor.length; j++) {
      var skip = notFor[j].getAttribute('data-not-when').split(/\s+/);
      notFor[j].hidden = skip.indexOf(type) !== -1;
    }
  }

  /* ======================================================================
     Chart data assembly
     ====================================================================== */

  function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function readTheme() {
    var host = document.querySelector('.cvz-page') || document.body;
    var cs = getComputedStyle(host);
    function pick(name, fallback) {
      var v = cs.getPropertyValue(name);
      return v && v.trim() ? v.trim() : fallback;
    }
    return {
      background: pick('--cvz-chart-bg', E.DEFAULT_THEME.background),
      text: pick('--cvz-chart-text', E.DEFAULT_THEME.text),
      muted: pick('--cvz-chart-muted', E.DEFAULT_THEME.muted),
      grid: pick('--cvz-chart-grid', E.DEFAULT_THEME.grid),
      axis: pick('--cvz-chart-axis', E.DEFAULT_THEME.axis),
      font: E.DEFAULT_THEME.font
    };
  }

  function seriesColor(columnIndex, order) {
    if (state.chart.colors[columnIndex]) return state.chart.colors[columnIndex];
    var palette = E.paletteColors(state.chart.palette, isDarkTheme());
    return palette[order % palette.length];
  }

  function displayValue(col, rowIndex) {
    var raw = state.dataset.rows[rowIndex][col.index];
    if (col.type === 'date') {
      var t = col.times ? col.times[rowIndex] : E.parseDateValue(raw, col.dateOrder);
      if (t !== null && t !== undefined) return E.formatDate(t, dateGranularity(col));
    }
    return raw === '' ? '(blank)' : String(raw);
  }

  function dateGranularity(col) {
    if (col._gran) return col._gran;
    var times = col.times || [];
    var allFirst = true, allJan = true, seen = 0;
    for (var i = 0; i < times.length && seen < 400; i++) {
      if (times[i] === null || times[i] === undefined) continue;
      seen += 1;
      var d = new Date(times[i]);
      if (d.getUTCDate() !== 1) allFirst = false;
      if (d.getUTCMonth() !== 0) allJan = false;
    }
    col._gran = allFirst && allJan ? 'year' : (allFirst ? 'month' : 'day');
    return col._gran;
  }

  function numberAt(col, rowIndex) {
    if (col.numbers) {
      var v = col.numbers[rowIndex];
      return v === null || v === undefined ? null : v;
    }
    return E.numericValue(state.dataset.rows[rowIndex][col.index]);
  }

  function missingToValue(v) {
    if (v !== null && v !== undefined && isFinite(v)) return v;
    return state.chart.missing === 'zero' ? 0 : null;
  }

  /**
   * Build the renderer spec from state. Returns { spec } or { error }.
   */
  function buildChartSpec() {
    var ds = state.dataset;
    if (!ds) return { error: 'Import a CSV to start charting.' };

    var type = state.chart.type;
    var info = E.chartTypeInfo(type);
    var cols = ds.columns;
    var indices = state.viewIndices;
    var notices = [];

    if (!indices.length) return { error: 'No rows match the current search and filters. Clear them to see a chart.' };

    var chosen = state.chart.series.filter(function (i) { return cols[i] && cols[i].type === 'number'; });
    if (!chosen.length) {
      return {
        error: numericColumns().length
          ? 'Pick at least one numeric column under Data series.'
          : 'No numeric columns were detected. Select another chart type or import a CSV containing numeric data.'
      };
    }

    var theme = readTheme();
    var options = JSON.parse(JSON.stringify(state.chart.options));

    /* ---- scatter ---- */
    if (info.family === 'scatter') {
      var xCol = state.chart.scatterX !== null ? cols[state.chart.scatterX] : null;
      if (!xCol || xCol.type !== 'number') {
        return { error: 'Scatter charts require a numeric X-axis. Choose a numeric column under X axis (numeric).' };
      }
      var labelCol = state.chart.xAxis !== null && cols[state.chart.xAxis] && cols[state.chart.xAxis].type !== 'number'
        ? cols[state.chart.xAxis] : null;

      var capped = indices;
      if (capped.length > MAX_CHART_POINTS) {
        capped = capped.slice(0, MAX_CHART_POINTS);
        notices.push('Plotting the first ' + fmtInt(MAX_CHART_POINTS) + ' of ' + fmtInt(indices.length) + ' rows for performance.');
      }

      var scatterSeries = chosen.map(function (colIndex, order) {
        var yCol = cols[colIndex];
        var points = [];
        for (var i = 0; i < capped.length; i++) {
          var r = capped[i];
          var xv = numberAt(xCol, r);
          var yv = numberAt(yCol, r);
          if (xv === null || yv === null) continue;
          points.push({ x: xv, y: yv, label: labelCol ? displayValue(labelCol, r) : '' });
        }
        return {
          name: yCol.name, color: seriesColor(colIndex, order), points: points, values: [],
          hidden: !!state.chart.hiddenSeries[order]
        };
      });

      var hasPoints = scatterSeries.some(function (s) { return !s.hidden && s.points.length; });
      if (!hasPoints) return { error: 'No rows have numeric values in both the X and Y columns.' };

      return {
        spec: {
          type: type,
          title: state.chart.title,
          xTitle: state.chart.xTitle || xCol.name,
          yTitle: state.chart.yTitle || (chosen.length === 1 ? cols[chosen[0]].name : ''),
          categories: [],
          series: scatterSeries,
          sliceColors: E.paletteColors(state.chart.palette, isDarkTheme()),
          options: options,
          theme: theme,
          valueUnit: cols[chosen[0]].unit || '',
          xUnit: xCol.unit || '',
          ariaLabel: buildAriaLabel(scatterSeries, [])
        },
        notices: notices
      };
    }

    /* ---- category charts ---- */
    var xColumn = state.chart.xAxis !== null && cols[state.chart.xAxis] ? cols[state.chart.xAxis] : null;
    if (!xColumn) return { error: 'Choose a column for the X axis.' };

    var categories = [];
    var seriesValues = chosen.map(function () { return []; });
    var aggregation = state.chart.aggregation;

    if (aggregation === 'none') {
      var rows = indices;
      if (rows.length > MAX_CHART_POINTS) {
        rows = rows.slice(0, MAX_CHART_POINTS);
        notices.push('Plotting the first ' + fmtInt(MAX_CHART_POINTS) + ' of ' + fmtInt(indices.length) + ' rows. Use an aggregation or a filter to summarise instead.');
      }
      for (var r = 0; r < rows.length; r++) {
        categories.push(displayValue(xColumn, rows[r]));
        for (var s = 0; s < chosen.length; s++) {
          seriesValues[s].push(missingToValue(numberAt(cols[chosen[s]], rows[r])));
        }
      }
    } else {
      var order = [];
      var buckets = Object.create(null);
      for (var i2 = 0; i2 < indices.length; i2++) {
        var key = displayValue(xColumn, indices[i2]);
        if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
          buckets[key] = { rows: [], sortKey: sortKeyFor(xColumn, indices[i2]) };
          order.push(key);
        }
        buckets[key].rows.push(indices[i2]);
      }
      if (xColumn.type === 'date' || xColumn.type === 'number') {
        order.sort(function (a, b) {
          var ka = buckets[a].sortKey, kb = buckets[b].sortKey;
          if (ka === null || kb === null) return 0;
          return ka - kb;
        });
      }
      if (order.length > MAX_CHART_POINTS) {
        order = order.slice(0, MAX_CHART_POINTS);
        notices.push('Showing the first ' + fmtInt(MAX_CHART_POINTS) + ' groups.');
      }
      for (var g = 0; g < order.length; g++) {
        categories.push(order[g]);
        var bucketRows = buckets[order[g]].rows;
        for (var s2 = 0; s2 < chosen.length; s2++) {
          var col = cols[chosen[s2]];
          var list = bucketRows.map(function (r2) { return numberAt(col, r2); }).filter(function (v) {
            return state.chart.missing === 'zero' ? true : (v !== null && v !== undefined);
          }).map(function (v) { return v === null || v === undefined ? 0 : v; });
          seriesValues[s2].push(E.aggregateValues(list, aggregation));
        }
      }
    }

    var series = chosen.map(function (colIndex, order2) {
      return {
        name: cols[colIndex].name,
        color: seriesColor(colIndex, order2),
        values: seriesValues[order2],
        points: [],
        hidden: !!state.chart.hiddenSeries[order2]
      };
    });

    /* pie & doughnut take a single series */
    if (info.family === 'radial') {
      var firstVisible = series.filter(function (s) { return !s.hidden; })[0];
      if (!firstVisible) return { error: 'All series are hidden. Show one from the legend to draw the chart.' };
      if (series.length > 1) notices.push('Pie and doughnut charts show one series — currently "' + firstVisible.name + '".');

      var duplicates = categories.length !== uniqueCount(categories);
      if (duplicates && aggregation === 'none') {
        notices.push('The category column repeats values. Set Aggregation to Sum to combine them into single slices.');
      }
      if (categories.length > MAX_PIE_SLICES) {
        var packed = packSlices(categories, firstVisible.values, MAX_PIE_SLICES);
        categories = packed.categories;
        series = [{ name: firstVisible.name, color: firstVisible.color, values: packed.values, points: [], hidden: false }];
        notices.push('Grouped the smallest slices into "Other" — a pie with more than ' + MAX_PIE_SLICES + ' slices is hard to read.');
      }
    }

    if (info.family === 'radar' && categories.length > 14) {
      notices.push('Radar charts stay readable up to about 12 categories. Consider filtering or aggregating.');
    }

    if (!series.some(function (s) { return !s.hidden; })) {
      return { error: 'Every series is hidden. Click a legend entry to bring one back.' };
    }

    return {
      spec: {
        type: type,
        title: state.chart.title,
        xTitle: state.chart.xTitle,
        yTitle: state.chart.yTitle,
        categories: categories,
        series: series,
        sliceColors: E.paletteColors(state.chart.palette, isDarkTheme()),
        options: options,
        theme: theme,
        valueUnit: cols[chosen[0]].unit || '',
        ariaLabel: buildAriaLabel(series, categories)
      },
      notices: notices
    };
  }

  function sortKeyFor(col, rowIndex) {
    if (col.type === 'date') return col.times ? col.times[rowIndex] : null;
    if (col.type === 'number') return col.numbers ? col.numbers[rowIndex] : null;
    return null;
  }

  function uniqueCount(list) {
    var seen = Object.create(null), n = 0;
    for (var i = 0; i < list.length; i++) if (!seen[list[i]]) { seen[list[i]] = true; n += 1; }
    return n;
  }

  function packSlices(categories, values, limit) {
    var pairs = categories.map(function (c, i) { return { label: c, value: values[i] || 0 }; });
    pairs.sort(function (a, b) { return b.value - a.value; });
    var head = pairs.slice(0, limit - 1);
    var tail = pairs.slice(limit - 1);
    var other = tail.reduce(function (sum, p) { return sum + (p.value || 0); }, 0);
    var outCats = head.map(function (p) { return p.label; });
    var outVals = head.map(function (p) { return p.value; });
    if (other > 0) { outCats.push('Other (' + tail.length + ')'); outVals.push(other); }
    return { categories: outCats, values: outVals };
  }

  function buildAriaLabel(series, categories) {
    var visible = series.filter(function (s) { return !s.hidden; });
    var parts = [E.chartTypeInfo(state.chart.type).label + ' chart'];
    if (categories && categories.length) parts.push(categories.length + ' categories');
    parts.push(visible.length + ' data series: ' + visible.map(function (s) { return s.name; }).join(', '));
    return parts.join('. ') + '.';
  }

  /* ======================================================================
     Chart lifecycle
     ====================================================================== */

  function destroyChart() {
    if (state.renderer) {
      state.renderer.destroy();
      state.renderer = null;
    }
  }

  function generateChart(spec) {
    if (!state.renderer) {
      state.renderer = E.createRenderer(dom.chartHost);
      state.renderer.onLegendToggle = function (index) {
        if (state.chart.hiddenSeries[index]) delete state.chart.hiddenSeries[index];
        else state.chart.hiddenSeries[index] = true;
        updateChart();
      };
      state.renderer.onViewChange = function (zoomed) {
        if (dom.resetZoom) dom.resetZoom.disabled = !zoomed;
      };
    }
    state.renderer.update(spec);
  }

  function updateChart() {
    if (!dom.chartHost) return;

    if (!state.dataset) {
      destroyChart();
      showChartMessage('Import a CSV to build your first chart.');
      return;
    }

    var result = buildChartSpec();
    if (result.error) {
      destroyChart();
      showChartMessage(result.error);
      setExportsEnabled(false);
      return;
    }

    hideChartMessage();
    generateChart(result.spec);
    setExportsEnabled(true);

    if (dom.notices) {
      while (dom.notices.firstChild) dom.notices.removeChild(dom.notices.firstChild);
      (result.notices || []).forEach(function (n) {
        dom.notices.appendChild(make('p', 'cvz-notice', n));
      });
      dom.notices.hidden = !(result.notices || []).length;
    }
    if (dom.resetZoom) dom.resetZoom.disabled = !state.renderer.hasZoom();
  }

  function showChartMessage(message) {
    if (!dom.chartEmpty) return;
    dom.chartEmpty.hidden = false;
    setText(dom.chartEmptyText, message);
    if (dom.chartHost) dom.chartHost.setAttribute('aria-hidden', 'true');
    if (dom.notices) dom.notices.hidden = true;
    announce(message);
  }

  function hideChartMessage() {
    if (dom.chartEmpty) dom.chartEmpty.hidden = true;
    if (dom.chartHost) dom.chartHost.removeAttribute('aria-hidden');
  }

  function setExportsEnabled(enabled) {
    ['exportPng', 'exportSvg', 'exportCsv', 'exportConfig', 'copyConfig', 'exportProject', 'printChart'].forEach(function (key) {
      if (dom[key]) dom[key].disabled = !enabled;
    });
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  function safeName() {
    var base = (state.chart.title || 'chart').replace(/[^\w\d\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    return base || 'chart';
  }

  function exportPNG() {
    if (!state.renderer) return;
    state.renderer.toPNGBlob(2).then(function (blob) {
      downloadBlob(blob, safeName() + '.png');
      status('PNG downloaded ✓', 'good');
    }, function (err) {
      status(err && err.message ? err.message : 'PNG export failed.', 'bad');
    });
  }

  function exportSVG() {
    if (!state.renderer) return;
    var svg = state.renderer.getSVGString();
    if (!svg) { status('Nothing to export yet.', 'bad'); return; }
    downloadText(svg, safeName() + '.svg', 'image/svg+xml');
    status('SVG downloaded ✓', 'good');
  }

  function currentCSVText(guard) {
    var cols = state.dataset.columns;
    var header = cols.map(function (c) { return c.name; });
    var rows = state.viewIndices.map(function (i) {
      return cols.map(function (c) { return state.dataset.rows[i][c.index]; });
    });
    return E.rowsToCSV(header, rows, state.delimiter, guard !== false);
  }

  function downloadCSV() {
    if (!state.dataset) return;
    downloadText(currentCSVText(true), safeName() + '-filtered.csv', 'text/csv');
    status('Filtered CSV downloaded ✓', 'good');
  }

  function buildConfig() {
    var cols = state.dataset ? state.dataset.columns : [];
    var o = state.chart.options;
    return {
      tool: 'ToolAdda CSV to Interactive Chart',
      version: 1,
      chart: {
        type: state.chart.type,
        title: state.chart.title,
        xAxis: state.chart.xAxis !== null && cols[state.chart.xAxis] ? cols[state.chart.xAxis].name : null,
        xAxisNumeric: state.chart.scatterX !== null && cols[state.chart.scatterX] ? cols[state.chart.scatterX].name : null,
        series: state.chart.series.map(function (i, order) {
          return { column: cols[i] ? cols[i].name : null, color: seriesColor(i, order) };
        }),
        axisTitles: { x: state.chart.xTitle, y: state.chart.yTitle },
        palette: state.chart.palette,
        aggregation: state.chart.aggregation,
        missingValues: state.chart.missing
      },
      options: {
        legend: o.legend,
        legendPosition: o.legendPosition,
        gridlines: { x: o.gridX, y: o.gridY },
        tooltips: o.tooltips,
        zoom: o.zoom,
        markers: o.markers,
        lineWidth: o.lineWidth,
        pointSize: o.pointSize,
        fillOpacity: o.fillOpacity,
        barRadius: o.barRadius,
        curve: o.curve,
        pie: { labels: o.showLabels, percentages: o.showPercent, sliceGap: o.sliceGap, innerRatio: o.innerRatio },
        height: o.height,
        responsive: true
      }
    };
  }

  function exportConfig() {
    downloadText(JSON.stringify(buildConfig(), null, 2), safeName() + '-config.json', 'application/json');
    status('Chart config downloaded ✓', 'good');
  }

  function exportProject() {
    var project = buildConfig();
    project.data = {
      delimiter: state.delimiter,
      firstRowIsHeader: state.hasHeader,
      rows: state.dataset ? state.dataset.rows.length : 0,
      csv: state.workingCSV
    };
    project.view = {
      search: state.search,
      sort: state.sort.column !== null && state.dataset.columns[state.sort.column]
        ? { column: state.dataset.columns[state.sort.column].name, direction: state.sort.direction } : null,
      filters: state.filters.map(function (f) {
        return {
          column: state.dataset.columns[f.column] ? state.dataset.columns[f.column].name : null,
          operator: f.operator,
          value: f.value
        };
      }),
      hiddenColumns: Object.keys(state.hiddenColumns).map(function (i) {
        return state.dataset.columns[i] ? state.dataset.columns[i].name : null;
      }).filter(Boolean)
    };
    downloadText(JSON.stringify(project, null, 2), safeName() + '-project.json', 'application/json');
    status('Project file downloaded ✓', 'good');
  }

  /* ======================================================================
     Fullscreen & print
     ====================================================================== */

  function toggleFullscreen(force) {
    var next = force === undefined ? !state.fullscreen : force;
    state.fullscreen = next;
    document.body.classList.toggle('cvz-fullscreen-on', next);
    if (dom.chartCard) dom.chartCard.classList.toggle('is-fullscreen', next);
    if (dom.fullscreen) {
      dom.fullscreen.setAttribute('aria-pressed', next ? 'true' : 'false');
      dom.fullscreen.textContent = next ? 'Exit fullscreen' : 'Fullscreen';
    }
    setTimeout(function () { if (state.renderer) state.renderer.draw(); }, 60);
    announce(next ? 'Chart expanded to fullscreen. Press Escape to exit.' : 'Fullscreen closed.');
  }

  /* ======================================================================
     Raw CSV editor
     ====================================================================== */

  function openEditor() {
    if (!dom.editor || !state.dataset) return;
    dom.editor.value = state.workingCSV;
    dom.editorPanel.hidden = false;
    if (dom.editorError) { dom.editorError.hidden = true; dom.editorError.textContent = ''; }
    dom.editor.focus();
    validateEditor();
  }

  function closeEditor() {
    if (dom.editorPanel) dom.editorPanel.hidden = true;
  }

  function validateEditor() {
    if (!dom.editor || !dom.editorStats) return;
    var value = dom.editor.value;
    if (!value.trim()) {
      setText(dom.editorStats, 'Empty — nothing to apply.');
      return;
    }
    var d = E.detectDelimiter(value);
    var parsed = E.parseCSVText(value, d);
    var widths = {};
    parsed.rows.forEach(function (r) { widths[r.length] = (widths[r.length] || 0) + 1; });
    var ragged = Object.keys(widths).length > 1;
    setText(dom.editorStats,
      parsed.rows.length + ' rows · ' + E.delimiterLabel(d) + ' delimiter' +
      (ragged ? ' · rows have different column counts (short rows will be padded)' : '') +
      (parsed.unterminated ? ' · unclosed quote detected' : ''));
  }

  function applyEditor() {
    if (!dom.editor) return;
    var value = dom.editor.value;
    if (!value.trim()) {
      showEditorError('CSV is empty. Add at least a header row and one data row.');
      return;
    }
    var d = E.detectDelimiter(value);
    var parsed = E.parseCSVText(value, d);
    var hasHeader = dom.headerToggle ? dom.headerToggle.checked : true;
    var dataset = E.buildDataset(parsed.rows, hasHeader);

    if (!dataset.columns.length) { showEditorError('Could not detect a valid header row or any columns.'); return; }
    if (!dataset.rows.length) { showEditorError('There are no data rows below the header.'); return; }

    state.workingCSV = value;
    state.delimiter = d;
    state.hasHeader = hasHeader;
    state.dataset = dataset;
    state.filters = [];
    state.sort = { column: null, direction: 'asc' };
    state.hiddenColumns = {};
    state.page = 0;
    if (dom.delimiterSelect) dom.delimiterSelect.value = d;
    autoSelectColumns();
    afterDatasetChange(true);
    closeEditor();
    status('CSV changes applied ✓', 'good');
  }

  function showEditorError(message) {
    if (!dom.editorError) return;
    dom.editorError.textContent = message;
    dom.editorError.hidden = false;
    announce(message);
  }

  /* ======================================================================
     Reset
     ====================================================================== */

  function resetData() {
    if (!state.importedCSV) return;
    state.workingCSV = state.importedCSV;
    var d = E.detectDelimiter(state.workingCSV);
    var parsed = E.parseCSVText(state.workingCSV, d);
    var hasHeader = E.looksLikeHeader(parsed.rows);
    state.delimiter = d;
    state.hasHeader = hasHeader;
    state.dataset = E.buildDataset(parsed.rows, hasHeader);
    state.filters = [];
    state.search = '';
    state.sort = { column: null, direction: 'asc' };
    state.hiddenColumns = {};
    state.page = 0;
    if (dom.search) dom.search.value = '';
    if (dom.headerToggle) dom.headerToggle.checked = hasHeader;
    if (dom.delimiterSelect) dom.delimiterSelect.value = d;
    autoSelectColumns();
    afterDatasetChange(true);
    status('Data restored to the imported CSV ✓', 'good');
  }

  function resetAll() {
    destroyChart();
    state.importedCSV = '';
    state.workingCSV = '';
    state.dataset = null;
    state.viewIndices = [];
    state.filters = [];
    state.search = '';
    state.sort = { column: null, direction: 'asc' };
    state.hiddenColumns = {};
    state.page = 0;
    state.chart.series = [];
    state.chart.colors = {};
    state.chart.hiddenSeries = {};
    state.chart.title = '';
    state.chart.titleTouched = false;
    state.chart.xTitle = '';
    state.chart.yTitle = '';
    state.chart.options = JSON.parse(JSON.stringify(E.DEFAULT_OPTIONS));

    document.body.classList.remove('cvz-has-data');
    if (dom.studio) dom.studio.dataset.state = 'empty';
    if (dom.paste) dom.paste.value = '';
    if (dom.search) dom.search.value = '';
    if (dom.thead) while (dom.thead.firstChild) dom.thead.removeChild(dom.thead.firstChild);
    if (dom.tbody) while (dom.tbody.firstChild) dom.tbody.removeChild(dom.tbody.firstChild);
    if (dom.seriesList) while (dom.seriesList.firstChild) dom.seriesList.removeChild(dom.seriesList.firstChild);
    if (dom.columnList) while (dom.columnList.firstChild) dom.columnList.removeChild(dom.columnList.firstChild);
    if (dom.filterList) while (dom.filterList.firstChild) dom.filterList.removeChild(dom.filterList.firstChild);
    closeEditor();
    importError('');
    syncChartInputs();
    showChartMessage('Import a CSV to build your first chart.');
    setExportsEnabled(false);
    setActivePane('import');
    status('Everything reset.', 'info');
  }

  /* ======================================================================
     Mobile panes
     ====================================================================== */

  /* Gates a convenience only (auto-revealing the chart pane), so a browser
     without matchMedia must fall through to the desktop layout, not throw. */
  function isMobileStudio() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1024px)').matches;
  }

  /** Redraw after the chart pane becomes visible (hidden panels report zero width). */
  function redrawChartPane() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (state.renderer) state.renderer.draw();
        else if (state.dataset) updateChart();
      });
    });
  }

  function setActivePane(name) {
    if (!dom.studio) return;
    dom.studio.dataset.pane = name;
    (dom.paneButtons || []).forEach(function (btn) {
      var active = btn.dataset.paneBtn === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    if (name === 'chart') redrawChartPane();
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('cvzStudio');
    dom.status = $('cvzStatus');
    dom.live = $('cvzLive');

    dom.drop = $('cvzDrop');
    dom.file = $('cvzFile');
    dom.browse = $('cvzBrowse');
    dom.paste = $('cvzPaste');
    dom.parsePaste = $('cvzParsePaste');
    dom.sampleSelect = $('cvzSampleSelect');
    dom.loadSample = $('cvzLoadSample');
    dom.importError = $('cvzImportError');
    dom.sourceName = $('cvzSourceName');
    dom.reimport = $('cvzReimport');
    dom.resetAll = $('cvzResetAll');

    dom.statRows = $('cvzStatRows');
    dom.statCols = $('cvzStatCols');
    dom.statNumeric = $('cvzStatNumeric');
    dom.statDates = $('cvzStatDates');
    dom.statMissing = $('cvzStatMissing');
    dom.statDelimiter = $('cvzStatDelimiter');
    dom.statFiltered = $('cvzStatFiltered');
    dom.headerToggle = $('cvzHeaderToggle');
    dom.delimiterSelect = $('cvzDelimiter');

    dom.search = $('cvzSearch');
    dom.thead = $('cvzThead');
    dom.tbody = $('cvzTbody');
    dom.tableInfo = $('cvzTableInfo');
    dom.pageInfo = $('cvzPageInfo');
    dom.prevPage = $('cvzPrevPage');
    dom.nextPage = $('cvzNextPage');
    dom.columnList = $('cvzColumnList');
    dom.filterList = $('cvzFilterList');
    dom.addFilter = $('cvzAddFilter');
    dom.clearFilters = $('cvzClearFilters');

    dom.editorPanel = $('cvzEditorPanel');
    dom.editor = $('cvzEditor');
    dom.editorStats = $('cvzEditorStats');
    dom.editorError = $('cvzEditorError');
    dom.openEditor = $('cvzOpenEditor');
    dom.applyEditor = $('cvzApplyEditor');
    dom.cancelEditor = $('cvzCancelEditor');
    dom.copyCSV = $('cvzCopyCSV');
    dom.resetDataBtn = $('cvzResetData');

    dom.xAxis = $('cvzXAxis');
    dom.scatterX = $('cvzScatterX');
    dom.seriesList = $('cvzSeriesList');
    dom.addSeries = $('cvzAddSeries');
    dom.aggregation = $('cvzAggregation');
    dom.missing = $('cvzMissing');
    dom.title = $('cvzTitle');
    dom.xTitle = $('cvzXTitle');
    dom.yTitle = $('cvzYTitle');
    dom.palette = $('cvzPalette');
    dom.legend = $('cvzLegend');
    dom.legendPos = $('cvzLegendPos');
    dom.gridX = $('cvzGridX');
    dom.gridY = $('cvzGridY');
    dom.tooltips = $('cvzTooltips');
    dom.zoomToggle = $('cvzZoomToggle');
    dom.markers = $('cvzMarkers');
    dom.showLabels = $('cvzShowLabels');
    dom.showPercent = $('cvzShowPercent');
    dom.curve = $('cvzCurve');
    dom.lineWidth = $('cvzLineWidth');
    dom.pointSize = $('cvzPointSize');
    dom.fillOpacity = $('cvzFillOpacity');
    dom.barRadius = $('cvzBarRadius');
    dom.innerRatio = $('cvzInnerRatio');
    dom.sliceGap = $('cvzSliceGap');
    dom.height = $('cvzHeight');

    dom.chartCard = $('cvzChartCard');
    dom.chartHost = $('cvzChartHost');
    dom.chartEmpty = $('cvzChartEmpty');
    dom.chartEmptyText = $('cvzChartEmptyText');
    dom.notices = $('cvzNotices');
    dom.zoomIn = $('cvzZoomIn');
    dom.zoomOut = $('cvzZoomOut');
    dom.resetZoom = $('cvzResetZoom');
    dom.fullscreen = $('cvzFullscreen');

    dom.exportPng = $('cvzExportPng');
    dom.exportSvg = $('cvzExportSvg');
    dom.exportCsv = $('cvzExportCsv');
    dom.exportConfig = $('cvzExportConfig');
    dom.copyConfig = $('cvzCopyConfig');
    dom.exportProject = $('cvzExportProject');
    dom.printChart = $('cvzPrint');

    dom.typeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-charttype]'));
    dom.paneButtons = Array.prototype.slice.call(document.querySelectorAll('[data-pane-btn]'));
  }

  function wireImport() {
    on(dom.browse, 'click', function () { if (dom.file) dom.file.click(); });
    on(dom.file, 'change', function () {
      handleFileUpload(dom.file.files && dom.file.files[0]);
      dom.file.value = '';
    });

    if (dom.drop) {
      ['dragenter', 'dragover'].forEach(function (evt) {
        dom.drop.addEventListener(evt, function (e) {
          e.preventDefault(); e.stopPropagation();
          dom.drop.classList.add('is-dragging');
        });
      });
      ['dragleave', 'dragend'].forEach(function (evt) {
        dom.drop.addEventListener(evt, function (e) {
          e.preventDefault(); e.stopPropagation();
          if (evt === 'dragleave' && dom.drop.contains(e.relatedTarget)) return;
          dom.drop.classList.remove('is-dragging');
        });
      });
      dom.drop.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        dom.drop.classList.remove('is-dragging');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) { handleFileUpload(files[0]); return; }
        var textData = e.dataTransfer && e.dataTransfer.getData('text/plain');
        if (textData && textData.trim()) ingestCSV(textData, 'Dropped text');
      });
      dom.drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); if (dom.file) dom.file.click(); }
      });
    }

    // Ignore drops outside the zone so the browser does not navigate away.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    on(dom.parsePaste, 'click', function () {
      var value = dom.paste ? dom.paste.value : '';
      if (!value.trim()) { importError('Paste some CSV text first.'); return; }
      if (ingestCSV(value, 'Pasted data')) status('CSV parsed ✓', 'good');
    });

    on(dom.paste, 'paste', function () {
      setTimeout(function () {
        if (!state.dataset && dom.paste.value.trim().length > 12) {
          ingestCSV(dom.paste.value, 'Pasted data');
        }
      }, 30);
    });

    on(dom.loadSample, 'click', loadSampleData);
    on(dom.reimport, 'click', function () {
      setActivePane('import');
      if (dom.drop) { dom.drop.scrollIntoView({ behavior: 'smooth', block: 'center' }); dom.drop.focus(); }
    });
    on(dom.resetAll, 'click', resetAll);
  }

  function loadSampleData() {
    var key = dom.sampleSelect ? dom.sampleSelect.value : 'sales';
    var sample = SAMPLES[key] || SAMPLES.sales;
    if (dom.paste) dom.paste.value = sample.csv;
    if (ingestCSV(sample.csv, sample.label)) status('Loaded sample: ' + sample.label, 'good');
  }

  function wireData() {
    on(dom.headerToggle, 'change', function () {
      if (!state.dataset) return;
      if (!reparseWorking({ hasHeader: dom.headerToggle.checked })) {
        dom.headerToggle.checked = state.hasHeader;
      }
    });

    on(dom.delimiterSelect, 'change', function () {
      if (!state.dataset) return;
      if (!reparseWorking({ delimiter: dom.delimiterSelect.value })) {
        dom.delimiterSelect.value = state.delimiter;
      }
    });

    on(dom.search, 'input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = dom.search.value;
        state.page = 0;
        refreshData();
        renderDataTable();
      }, 200);
    });

    on(dom.prevPage, 'click', function () { if (state.page > 0) { state.page -= 1; renderDataTable(); } });
    on(dom.nextPage, 'click', function () {
      var pages = Math.ceil(state.viewIndices.length / PAGE_SIZE);
      if (state.page < pages - 1) { state.page += 1; renderDataTable(); }
    });

    on(dom.addFilter, 'click', function () {
      if (!state.dataset) return;
      state.filters.push({ column: state.dataset.columns[0].index, operator: 'contains', value: '' });
      renderFilterRows();
    });

    on(dom.clearFilters, 'click', function () {
      state.filters = [];
      state.search = '';
      if (dom.search) dom.search.value = '';
      state.page = 0;
      renderFilterRows();
      refreshData();
      renderDataTable();
      status('Filters cleared — the imported data is untouched.', 'good');
    });

    on(dom.openEditor, 'click', openEditor);
    on(dom.cancelEditor, 'click', closeEditor);
    on(dom.applyEditor, 'click', applyEditor);
    on(dom.editor, 'input', function () {
      if (editorTimer) clearTimeout(editorTimer);
      editorTimer = setTimeout(validateEditor, 250);
    });

    on(dom.copyCSV, 'click', function () {
      if (!state.dataset) return;
      copyText(currentCSVText(false), 'CSV copied');
    });
    on(dom.resetDataBtn, 'click', resetData);
  }

  function wireChartControls() {
    (dom.typeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.chart.type = btn.dataset.charttype;
        state.chart.hiddenSeries = {};
        if (state.renderer) state.renderer.resetZoom();
        updateChartTypeButtons();
        applyTypeVisibility();
        updateChart();
      });
    });

    on(dom.xAxis, 'change', function () {
      state.chart.xAxis = Number(dom.xAxis.value);
      if (!state.chart.titleTouched) { state.chart.title = defaultTitle(); dom.title.value = state.chart.title; }
      if (state.renderer) state.renderer.resetZoom();
      updateChart();
    });

    on(dom.scatterX, 'change', function () {
      state.chart.scatterX = Number(dom.scatterX.value);
      if (state.renderer) state.renderer.resetZoom();
      updateChart();
    });

    on(dom.addSeries, 'click', function () {
      var remaining = numericColumns().filter(function (c) { return state.chart.series.indexOf(c.index) === -1; });
      if (!remaining.length) return;
      state.chart.series.push(remaining[0].index);
      state.chart.hiddenSeries = {};
      if (!state.chart.titleTouched) { state.chart.title = defaultTitle(); dom.title.value = state.chart.title; }
      renderSeriesControls();
      updateChart();
    });

    on(dom.aggregation, 'change', function () {
      state.chart.aggregation = dom.aggregation.value;
      if (state.renderer) state.renderer.resetZoom();
      updateChart();
    });

    on(dom.missing, 'change', function () { state.chart.missing = dom.missing.value; updateChart(); });

    on(dom.title, 'input', function () {
      state.chart.title = dom.title.value;
      state.chart.titleTouched = true;
      updateChart();
    });
    on(dom.xTitle, 'input', function () { state.chart.xTitle = dom.xTitle.value; updateChart(); });
    on(dom.yTitle, 'input', function () { state.chart.yTitle = dom.yTitle.value; updateChart(); });

    on(dom.palette, 'change', function () {
      state.chart.palette = dom.palette.value;
      state.chart.colors = {};
      renderSeriesControls();
      updateChart();
    });

    function bindCheck(node, key) {
      on(node, 'change', function () { state.chart.options[key] = node.checked; updateChart(); });
    }
    bindCheck(dom.legend, 'legend');
    bindCheck(dom.gridX, 'gridX');
    bindCheck(dom.gridY, 'gridY');
    bindCheck(dom.tooltips, 'tooltips');
    bindCheck(dom.zoomToggle, 'zoom');
    bindCheck(dom.markers, 'markers');
    bindCheck(dom.showLabels, 'showLabels');
    bindCheck(dom.showPercent, 'showPercent');

    on(dom.legendPos, 'change', function () { state.chart.options.legendPosition = dom.legendPos.value; updateChart(); });
    on(dom.curve, 'change', function () { state.chart.options.curve = dom.curve.value; updateChart(); });

    function bindRange(node, key, transform) {
      on(node, 'input', function () {
        var raw = Number(node.value);
        state.chart.options[key] = transform ? transform(raw) : raw;
        var out = node.parentNode ? node.parentNode.querySelector('output') : null;
        if (out) out.textContent = node.dataset.suffix ? raw + node.dataset.suffix : String(raw);
        updateChart();
      });
    }
    bindRange(dom.lineWidth, 'lineWidth');
    bindRange(dom.pointSize, 'pointSize');
    bindRange(dom.fillOpacity, 'fillOpacity', function (v) { return v / 100; });
    bindRange(dom.barRadius, 'barRadius');
    bindRange(dom.innerRatio, 'innerRatio', function (v) { return v / 100; });
    bindRange(dom.sliceGap, 'sliceGap');
    bindRange(dom.height, 'height');
  }

  function wireChartActions() {
    on(dom.zoomIn, 'click', function () { if (state.renderer) state.renderer.zoomBy(1.4); });
    on(dom.zoomOut, 'click', function () { if (state.renderer) state.renderer.zoomBy(1 / 1.4); });
    on(dom.resetZoom, 'click', function () {
      if (state.renderer) { state.renderer.resetZoom(); status('Zoom reset.', 'info'); }
    });
    on(dom.fullscreen, 'click', function () { toggleFullscreen(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.fullscreen) { toggleFullscreen(false); return; }
        if (dom.editorPanel && !dom.editorPanel.hidden) closeEditor();
      }
    });

    on(dom.exportPng, 'click', exportPNG);
    on(dom.exportSvg, 'click', exportSVG);
    on(dom.exportCsv, 'click', downloadCSV);
    on(dom.exportConfig, 'click', exportConfig);
    on(dom.exportProject, 'click', exportProject);
    on(dom.copyConfig, 'click', function () { copyText(JSON.stringify(buildConfig(), null, 2), 'Config copied'); });
    on(dom.printChart, 'click', function () { window.print(); });
  }

  function wirePanes() {
    (dom.paneButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () { setActivePane(btn.dataset.paneBtn); });
      btn.addEventListener('keydown', function (e) {
        var keys = ['ArrowLeft', 'ArrowRight'];
        if (keys.indexOf(e.key) === -1) return;
        e.preventDefault();
        var i = dom.paneButtons.indexOf(btn);
        var next = e.key === 'ArrowRight' ? (i + 1) % dom.paneButtons.length : (i - 1 + dom.paneButtons.length) % dom.paneButtons.length;
        dom.paneButtons[next].focus();
        setActivePane(dom.paneButtons[next].dataset.paneBtn);
      });
    });
  }

  function watchTheme() {
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === 'data-theme') {
          if (!state.chart.colors || !Object.keys(state.chart.colors).length) renderSeriesControls();
          updateChart();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeApp() {
    cacheDom();
    if (!dom.studio) return;

    /* populate static selects */
    if (dom.aggregation) {
      E.AGGREGATIONS.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.label;
        dom.aggregation.appendChild(opt);
      });
      dom.aggregation.value = 'none';
    }
    if (dom.palette) {
      Object.keys(E.PALETTES).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key; opt.textContent = E.PALETTE_LABELS[key] || key;
        dom.palette.appendChild(opt);
      });
      dom.palette.value = 'default';
    }
    if (dom.sampleSelect) {
      Object.keys(SAMPLES).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key; opt.textContent = SAMPLES[key].label;
        dom.sampleSelect.appendChild(opt);
      });
    }

    wireImport();
    wireData();
    wireChartControls();
    wireChartActions();
    wirePanes();
    watchTheme();

    syncChartInputs();
    applyTypeVisibility();
    setExportsEnabled(false);
    setActivePane('import');
    showChartMessage('Import a CSV to build your first chart.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeApp);
  else initializeApp();

  /* Exposed for the page's own smoke tests. */
  window.CSVChartStudio = {
    state: state,
    ingestCSV: ingestCSV,
    loadSampleData: loadSampleData,
    updateChart: updateChart,
    resetAll: resetAll,
    SAMPLES: SAMPLES
  };
})();
