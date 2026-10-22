(function () {
  'use strict';
  var root = document.querySelector('[data-subnet-page]');
  if (!root) return;

  /* ============================================================
     Utilities
     ============================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  /* ============================================================
     Core IPv4 / CIDR math — all bitwise results normalized to
     unsigned 32-bit via `>>> 0` since JS bitwise ops are signed.
     ============================================================ */
  function ipToInt(ip) {
    if (typeof ip !== 'string') return null;
    var parts = ip.trim().split('.');
    if (parts.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return null;
      var v = Number(parts[i]);
      if (v < 0 || v > 255) return null;
      n = n * 256 + v;
    }
    return n >>> 0;
  }
  function intToIp(n) {
    n = n >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  function cidrToMaskInt(prefix) {
    if (prefix <= 0) return 0;
    if (prefix >= 32) return 0xffffffff >>> 0;
    return (0xffffffff << (32 - prefix)) >>> 0;
  }
  function popcount32(n) {
    n = n >>> 0;
    var c = 0;
    while (n) { c += n & 1; n = n >>> 1; }
    return c;
  }
  function toBinary32(n) {
    n = n >>> 0;
    var s = n.toString(2);
    while (s.length < 32) s = '0' + s;
    return s;
  }
  function isValidMaskInt(n) { return /^1*0*$/.test(toBinary32(n)); }
  function toHex32(n) {
    n = n >>> 0;
    var s = n.toString(16).toUpperCase();
    while (s.length < 8) s = '0' + s;
    return s;
  }
  function ipToHexOctets(ip) {
    return ip.split('.').map(function (o) { var h = Number(o).toString(16).toUpperCase(); return h.length === 1 ? '0' + h : h; }).join('.');
  }
  function ipToBinaryOctets(ip) {
    return ip.split('.').map(function (o) { var b = Number(o).toString(2); while (b.length < 8) b = '0' + b; return b; }).join('.');
  }

  function usableHostsForPrefix(prefix) {
    if (prefix === 32) return 1;
    if (prefix === 31) return 2;
    var total = Math.pow(2, 32 - prefix);
    return Math.max(total - 2, 0);
  }
  function neededPrefixForHosts(hosts) {
    hosts = Math.max(1, Math.ceil(hosts));
    for (var p = 32; p >= 0; p--) {
      if (usableHostsForPrefix(p) >= hosts) return p;
    }
    return 0;
  }

  var CLASS_RANGES = [
    { max: 127, label: 'A' }, { max: 191, label: 'B' }, { max: 223, label: 'C' },
    { max: 239, label: 'D (Multicast)' }, { max: 255, label: 'E (Reserved/Experimental)' }
  ];
  function networkClass(firstOctet) {
    for (var i = 0; i < CLASS_RANGES.length; i++) if (firstOctet <= CLASS_RANGES[i].max) return CLASS_RANGES[i].label;
    return 'Unknown';
  }

  // Ordered most-specific first so the correct label wins when ranges nest.
  var SPECIAL_RANGES = [
    { cidr: '255.255.255.255/32', label: 'Limited broadcast', tag: 'special' },
    { cidr: '192.0.0.0/24', label: 'IETF protocol assignments (RFC 6890)', tag: 'special' },
    { cidr: '192.0.2.0/24', label: 'Documentation — TEST-NET-1 (RFC 5737)', tag: 'doc' },
    { cidr: '192.88.99.0/24', label: '6to4 relay anycast (RFC 3068, historic)', tag: 'special' },
    { cidr: '198.51.100.0/24', label: 'Documentation — TEST-NET-2 (RFC 5737)', tag: 'doc' },
    { cidr: '203.0.113.0/24', label: 'Documentation — TEST-NET-3 (RFC 5737)', tag: 'doc' },
    { cidr: '169.254.0.0/16', label: 'Link-local / APIPA (RFC 3927)', tag: 'special' },
    { cidr: '192.168.0.0/16', label: 'Private (RFC 1918)', tag: 'private' },
    { cidr: '198.18.0.0/15', label: 'Benchmarking (RFC 2544)', tag: 'special' },
    { cidr: '172.16.0.0/12', label: 'Private (RFC 1918)', tag: 'private' },
    { cidr: '100.64.0.0/10', label: 'Shared address space / CGNAT (RFC 6598)', tag: 'special' },
    { cidr: '10.0.0.0/8', label: 'Private (RFC 1918)', tag: 'private' },
    { cidr: '127.0.0.0/8', label: 'Loopback (RFC 990)', tag: 'loopback' },
    { cidr: '0.0.0.0/8', label: '"This network" (RFC 791)', tag: 'special' },
    { cidr: '224.0.0.0/4', label: 'Multicast (RFC 5771)', tag: 'multicast' },
    { cidr: '240.0.0.0/4', label: 'Reserved for future use (RFC 1112)', tag: 'special' }
  ].map(function (r) {
    var parts = r.cidr.split('/');
    var netInt = ipToInt(parts[0]);
    var prefix = parseInt(parts[1], 10);
    var maskInt = cidrToMaskInt(prefix);
    var broadcastInt = (netInt | (~maskInt >>> 0)) >>> 0;
    return { start: netInt, end: broadcastInt, label: r.label, tag: r.tag };
  });
  function classifySpecial(ipInt) {
    for (var i = 0; i < SPECIAL_RANGES.length; i++) {
      var r = SPECIAL_RANGES[i];
      if (ipInt >= r.start && ipInt <= r.end) return r;
    }
    return null;
  }

  function reverseDnsPointer(ipInt) {
    var o = [(ipInt >>> 24) & 255, (ipInt >>> 16) & 255, (ipInt >>> 8) & 255, ipInt & 255];
    return o.reverse().join('.') + '.in-addr.arpa';
  }

  /* ============================================================
     Full subnet calculation for one IP + prefix
     ============================================================ */
  function calculateSubnet(ipStr, prefix) {
    var ipInt = ipToInt(ipStr);
    if (ipInt === null) return { error: 'Enter a valid IPv4 address (e.g. 192.168.1.0).' };
    if (!(prefix >= 0 && prefix <= 32)) return { error: 'CIDR prefix must be between 0 and 32.' };

    var maskInt = cidrToMaskInt(prefix);
    var wildcardInt = (~maskInt) >>> 0;
    var networkInt = (ipInt & maskInt) >>> 0;
    var broadcastInt = (networkInt | wildcardInt) >>> 0;
    var total = Math.pow(2, 32 - prefix);
    var usable = usableHostsForPrefix(prefix);
    var firstUsableInt, lastUsableInt;
    if (prefix === 32) { firstUsableInt = networkInt; lastUsableInt = networkInt; }
    else if (prefix === 31) { firstUsableInt = networkInt; lastUsableInt = broadcastInt; }
    else { firstUsableInt = networkInt + 1; lastUsableInt = broadcastInt - 1; }

    var firstOctet = (ipInt >>> 24) & 255;
    var special = classifySpecial(ipInt);
    var isPrivate = special && special.tag === 'private';

    return {
      ip: ipStr, ipInt: ipInt, prefix: prefix,
      mask: intToIp(maskInt), maskInt: maskInt,
      wildcard: intToIp(wildcardInt),
      network: intToIp(networkInt), networkInt: networkInt,
      broadcast: intToIp(broadcastInt), broadcastInt: broadcastInt,
      firstUsable: intToIp(firstUsableInt >>> 0), lastUsable: intToIp(lastUsableInt >>> 0),
      total: total, usable: usable,
      networkClass: networkClass(firstOctet),
      special: special, isPrivate: !!isPrivate, isPublic: !special,
      binary: ipToBinaryOctets(ipStr),
      hexOctets: ipToHexOctets(ipStr), hex32: '0x' + toHex32(ipInt),
      reverseDns: reverseDnsPointer(networkInt),
      gatewaySuggestion: intToIp(firstUsableInt >>> 0)
    };
  }

  /* ============================================================
     Subnet list generation (base network split into new prefix)
     ============================================================ */
  var MAX_LISTED_SUBNETS = 512;
  function generateSubnetList(baseNetworkInt, basePrefix, newPrefix) {
    if (newPrefix < basePrefix) return { error: 'New prefix must be equal to or larger than the base prefix.' };
    if (newPrefix > 32) return { error: 'New prefix cannot exceed /32.' };
    var borrowedBits = newPrefix - basePrefix;
    var count = Math.pow(2, borrowedBits);
    var blockSize = Math.pow(2, 32 - newPrefix);
    var shown = Math.min(count, MAX_LISTED_SUBNETS);
    var list = [];
    for (var i = 0; i < shown; i++) {
      var netInt = (baseNetworkInt + i * blockSize) >>> 0;
      list.push(calculateSubnet(intToIp(netInt), newPrefix));
    }
    return { list: list, total: count, shown: shown, blockSize: blockSize };
  }

  /* ============================================================
     VLSM planner — largest-first greedy allocation
     ============================================================ */
  function planVlsm(baseNetworkInt, basePrefix, requirements) {
    var baseBlockSize = Math.pow(2, 32 - basePrefix);
    var baseEnd = baseNetworkInt + baseBlockSize - 1;
    var order = requirements.map(function (r, i) { return { name: r.name, hosts: r.hosts, idx: i }; });
    var sorted = order.slice().sort(function (a, b) { return b.hosts - a.hosts; });
    var cursor = baseNetworkInt;
    var results = [];
    sorted.forEach(function (req) {
      var prefix = neededPrefixForHosts(req.hosts);
      var blockSize = Math.pow(2, 32 - prefix);
      var aligned = Math.ceil(cursor / blockSize) * blockSize;
      if (aligned + blockSize - 1 > baseEnd) {
        results.push({ name: req.name, hosts: req.hosts, idx: req.idx, error: 'Does not fit in remaining address space' });
        return;
      }
      var calc = calculateSubnet(intToIp(aligned), prefix);
      results.push({ name: req.name, hosts: req.hosts, idx: req.idx, prefix: prefix, calc: calc });
      cursor = aligned + blockSize;
    });
    results.sort(function (a, b) { return a.idx - b.idx; });
    return results;
  }

  /* ============================================================
     DOM refs — Basic mode
     ============================================================ */
  var ipInput = $('[data-ip-input]', root);
  var cidrInput = $('[data-cidr-input]', root);
  var cidrSlider = $('[data-cidr-slider]', root);
  var sliderLabel = $('[data-slider-label]', root);
  var cidrLabel = $('[data-cidr-label]', root);
  var errorBox = $('[data-sn-error]', root);
  var bitGrid = $('[data-bit-grid]', root);
  var badgeRow = $('[data-badge-row]', root);
  var summaryGrid = $('[data-summary-grid]', root);
  var detailTable = $('[data-detail-table]', root);
  var supernetTable = $('[data-supernet-table]', root);
  var maskModeButtons = $all('[data-mask-mode]', root);
  var state = { maskMode: 'cidr', lastCalc: null };

  /* ============================================================
     Mode tabs (Basic / Hosts / Subnets / VLSM)
     ============================================================ */
  $all('[data-sn-mode]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.getAttribute('data-sn-mode');
      $all('[data-sn-mode]', root).forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      $all('[data-sn-panel]', root).forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-sn-panel') === mode); });
    });
  });

  /* ============================================================
     CIDR / mask mode toggle
     ============================================================ */
  maskModeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.maskMode = btn.getAttribute('data-mask-mode');
      maskModeButtons.forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      if (state.maskMode === 'mask') {
        cidrLabel.textContent = 'Subnet mask';
        cidrInput.value = intToIp(cidrToMaskInt(clampPrefixFromInput()));
      } else {
        cidrLabel.textContent = 'CIDR prefix';
        var p = state.lastCalc && !state.lastCalc.error ? state.lastCalc.prefix : 24;
        cidrInput.value = String(p);
      }
      runBasicCalculation();
    });
  });
  function clampPrefixFromInput() {
    var n = parseInt(cidrInput.value.replace('/', ''), 10);
    return isNaN(n) ? 24 : Math.max(0, Math.min(32, n));
  }

  /* ============================================================
     Presets
     ============================================================ */
  $all('[data-preset]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var parts = btn.getAttribute('data-preset').split('/');
      ipInput.value = parts[0];
      state.maskMode = 'cidr';
      maskModeButtons.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-mask-mode') === 'cidr'); b.setAttribute('aria-pressed', b.getAttribute('data-mask-mode') === 'cidr' ? 'true' : 'false'); });
      cidrLabel.textContent = 'CIDR prefix';
      cidrInput.value = parts[1];
      cidrSlider.value = parts[1];
      runBasicCalculation();
    });
  });

  /* ============================================================
     Live input wiring
     ============================================================ */
  ipInput.addEventListener('input', runBasicCalculation);
  cidrInput.addEventListener('input', function () {
    if (state.maskMode === 'cidr') {
      var n = parseInt(cidrInput.value, 10);
      if (!isNaN(n) && n >= 0 && n <= 32) cidrSlider.value = n;
    }
    runBasicCalculation();
  });
  cidrSlider.addEventListener('input', function () {
    sliderLabel.textContent = '/' + cidrSlider.value;
    if (state.maskMode === 'cidr') cidrInput.value = cidrSlider.value;
    else cidrInput.value = intToIp(cidrToMaskInt(parseInt(cidrSlider.value, 10)));
    runBasicCalculation();
  });

  function getPrefixFromInputs() {
    if (state.maskMode === 'cidr') {
      var raw = cidrInput.value.trim().replace(/^\//, '');
      if (!/^\d{1,2}$/.test(raw)) return { error: 'CIDR prefix must be a number between 0 and 32.' };
      var n = parseInt(raw, 10);
      if (n < 0 || n > 32) return { error: 'CIDR prefix must be between 0 and 32.' };
      return { prefix: n };
    }
    var maskInt = ipToInt(cidrInput.value.trim());
    if (maskInt === null) return { error: 'Enter a valid subnet mask (e.g. 255.255.255.0).' };
    if (!isValidMaskInt(maskInt)) return { error: 'Subnet mask bits must be contiguous 1s followed by 0s (e.g. 255.255.255.0, not 255.255.0.255).' };
    return { prefix: popcount32(maskInt) };
  }

  function runBasicCalculation() {
    errorBox.textContent = '';
    ipInput.classList.remove('is-invalid');
    cidrInput.classList.remove('is-invalid');

    var prefixResult = getPrefixFromInputs();
    if (prefixResult.error) {
      errorBox.textContent = prefixResult.error;
      cidrInput.classList.add('is-invalid');
      return;
    }
    var calc = calculateSubnet(ipInput.value.trim(), prefixResult.prefix);
    if (calc.error) {
      errorBox.textContent = calc.error;
      ipInput.classList.add('is-invalid');
      return;
    }
    state.lastCalc = calc;
    cidrSlider.value = calc.prefix;
    sliderLabel.textContent = '/' + calc.prefix;
    renderBitGrid(calc.prefix);
    renderBadges(calc);
    renderSummary(calc);
    renderDetailTable(calc);
    renderSupernet(calc);
    updateSubnetListHint();
  }

  /* ============================================================
     Rendering — bit grid, badges, summary, detail table
     ============================================================ */
  function renderBitGrid(prefix) {
    bitGrid.innerHTML = '';
    for (var i = 0; i < 32; i++) {
      var b = document.createElement('span');
      b.className = 'sn-bit ' + (i < prefix ? 'net' : 'host');
      b.textContent = i < prefix ? '1' : '0';
      bitGrid.appendChild(b);
      if ((i + 1) % 8 === 0 && i !== 31) {
        var gap = document.createElement('span');
        gap.style.width = '.3rem';
        bitGrid.appendChild(gap);
      }
    }
  }

  function renderBadges(calc) {
    var pills = [];
    if (calc.special) {
      var tagClass = calc.special.tag === 'private' ? 'priv' : 'special';
      pills.push('<span class="sn-pill ' + tagClass + '">' + escapeHtml(calc.special.label) + '</span>');
    } else {
      pills.push('<span class="sn-pill pub">Public</span>');
    }
    pills.push('<span class="sn-pill special">Class ' + escapeHtml(calc.networkClass) + '</span>');
    pills.push('<span class="sn-pill special">IPv4</span>');
    badgeRow.innerHTML = pills.join('');
  }

  function renderSummary(calc) {
    var cards = [
      { lbl: 'Network address', val: calc.network },
      { lbl: 'Broadcast address', val: calc.broadcast },
      { lbl: 'Usable host range', val: calc.usable > 0 ? calc.firstUsable + ' – ' + calc.lastUsable : '—' },
      { lbl: 'Usable / total hosts', val: calc.usable.toLocaleString() + ' / ' + calc.total.toLocaleString() }
    ];
    summaryGrid.innerHTML = cards.map(function (c) {
      return '<div class="sn-summary-card"><div class="lbl">' + c.lbl + '</div><div class="val">' + escapeHtml(c.val) + '</div></div>';
    }).join('');
  }

  function copyRow(label, value) {
    return '<tr><td>' + escapeHtml(label) + '</td><td><span class="sn-copy-cell"><span>' + escapeHtml(value) + '</span><button type="button" data-copy-value="' + escapeHtml(value) + '">Copy</button></span></td></tr>';
  }
  function renderDetailTable(calc) {
    var rows = [
      copyRow('IP address', calc.ip),
      copyRow('CIDR notation', calc.ip + '/' + calc.prefix),
      copyRow('Subnet mask', calc.mask),
      copyRow('Wildcard mask', calc.wildcard),
      copyRow('Network address', calc.network),
      copyRow('Broadcast address', calc.broadcast),
      copyRow('First usable IP', calc.firstUsable),
      copyRow('Last usable IP', calc.lastUsable),
      copyRow('Total addresses', calc.total.toLocaleString()),
      copyRow('Usable hosts', calc.usable.toLocaleString()),
      copyRow('Network bits', String(calc.prefix)),
      copyRow('Host bits', String(32 - calc.prefix)),
      copyRow('Network class (legacy)', calc.networkClass),
      copyRow('IP type', calc.special ? calc.special.label : 'Public'),
      copyRow('Binary', calc.binary),
      copyRow('Hex (octets)', calc.hexOctets),
      copyRow('Hex (32-bit)', calc.hex32),
      copyRow('Suggested default gateway', calc.gatewaySuggestion + ' (common convention — first usable address)'),
      copyRow('Reverse DNS pointer', calc.reverseDns)
    ];
    detailTable.innerHTML = rows.join('');
    wireCopyButtons(detailTable);
  }
  function renderSupernet(calc) {
    if (calc.prefix === 0) {
      supernetTable.innerHTML = copyRow('Supernet', 'Already the largest possible block (/0)');
      return;
    }
    var superPrefix = calc.prefix - 1;
    var superMask = cidrToMaskInt(superPrefix);
    var superNetInt = (calc.networkInt & superMask) >>> 0;
    var superCalc = calculateSubnet(intToIp(superNetInt), superPrefix);
    supernetTable.innerHTML =
      copyRow('Supernet CIDR', superCalc.network + '/' + superPrefix) +
      copyRow('Supernet range', superCalc.network + ' – ' + superCalc.broadcast) +
      copyRow('Supernet total addresses', superCalc.total.toLocaleString());
    wireCopyButtons(supernetTable);
  }

  function wireCopyButtons(container) {
    $all('[data-copy-value]', container).forEach(function (btn) {
      btn.addEventListener('click', function () { copyText(btn.getAttribute('data-copy-value')); });
    });
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); flashHint('Copied: ' + text, false); }
    catch (e) { flashHint('Could not copy — select and copy manually.', true); }
  }
  var hintTimer = null;
  function flashHint(msg, isError) {
    errorBox.classList.toggle('sn-hint-success', !isError);
    errorBox.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { if (errorBox.textContent === msg) { errorBox.textContent = ''; errorBox.classList.remove('sn-hint-success'); } }, 2200);
  }

  /* ============================================================
     Subnet list generator
     ============================================================ */
  var newPrefixInput = $('[data-new-prefix]', root);
  var subnetListHint = $('[data-subnet-list-hint]', root);
  var subnetListWrap = $('[data-subnet-list-wrap]', root);
  var subnetListBody = $('[data-subnet-list-body]', root);
  var subnetListNote = $('[data-subnet-list-note]', root);

  function updateSubnetListHint() {
    if (!state.lastCalc || state.lastCalc.error) return;
    var newPrefix = parseInt(newPrefixInput.value, 10);
    if (isNaN(newPrefix) || newPrefix < state.lastCalc.prefix || newPrefix > 32) {
      subnetListHint.textContent = 'Enter a new prefix between /' + state.lastCalc.prefix + ' and /32.';
      return;
    }
    var count = Math.pow(2, newPrefix - state.lastCalc.prefix);
    var blockSize = Math.pow(2, 32 - newPrefix);
    subnetListHint.textContent = 'Splitting /' + state.lastCalc.prefix + ' into /' + newPrefix + ' creates ' + count.toLocaleString() + ' subnet' + (count === 1 ? '' : 's') + ' of ' + blockSize.toLocaleString() + ' addresses each.';
  }
  newPrefixInput.addEventListener('input', updateSubnetListHint);

  $('[data-generate-subnets]', root).addEventListener('click', function () {
    if (!state.lastCalc || state.lastCalc.error) { errorBox.textContent = 'Fix the calculator inputs above first.'; return; }
    var newPrefix = parseInt(newPrefixInput.value, 10);
    if (isNaN(newPrefix)) { subnetListHint.textContent = 'Enter a valid new prefix.'; return; }
    var result = generateSubnetList(state.lastCalc.networkInt, state.lastCalc.prefix, newPrefix);
    if (result.error) { subnetListHint.textContent = result.error; subnetListWrap.classList.add('hidden'); return; }
    subnetListBody.innerHTML = result.list.map(function (c, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + c.network + '</td><td>/' + c.prefix + '</td><td>' + c.firstUsable + '</td><td>' + c.lastUsable + '</td><td>' + c.broadcast + '</td></tr>';
    }).join('');
    subnetListWrap.classList.remove('hidden');
    if (result.total > result.shown) {
      subnetListNote.textContent = 'Showing the first ' + result.shown.toLocaleString() + ' of ' + result.total.toLocaleString() + ' subnets — narrow the prefix range to see the rest.';
      subnetListNote.classList.remove('hidden');
    } else {
      subnetListNote.classList.add('hidden');
    }
  });

  /* ============================================================
     Export: copy report / CSV / JSON / print / share
     ============================================================ */
  function reportLines(calc) {
    return [
      ['Field', 'Value'],
      ['IP address', calc.ip],
      ['CIDR notation', calc.ip + '/' + calc.prefix],
      ['Subnet mask', calc.mask],
      ['Wildcard mask', calc.wildcard],
      ['Network address', calc.network],
      ['Broadcast address', calc.broadcast],
      ['First usable IP', calc.firstUsable],
      ['Last usable IP', calc.lastUsable],
      ['Total addresses', String(calc.total)],
      ['Usable hosts', String(calc.usable)],
      ['Network bits', String(calc.prefix)],
      ['Host bits', String(32 - calc.prefix)],
      ['Network class', calc.networkClass],
      ['IP type', calc.special ? calc.special.label : 'Public'],
      ['Binary', calc.binary],
      ['Hex (octets)', calc.hexOctets],
      ['Hex (32-bit)', calc.hex32],
      ['Suggested default gateway', calc.gatewaySuggestion],
      ['Reverse DNS pointer', calc.reverseDns]
    ];
  }
  function downloadBlob(content, filename, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  $('[data-copy-report]', root).addEventListener('click', function () {
    if (!state.lastCalc || state.lastCalc.error) return;
    var text = reportLines(state.lastCalc).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
    copyText('\n' + text);
    flashHint('Full report copied to clipboard.');
  });
  $('[data-download-csv]', root).addEventListener('click', function () {
    if (!state.lastCalc || state.lastCalc.error) return;
    var csv = reportLines(state.lastCalc).map(function (r) { return '"' + r[0].replace(/"/g, '""') + '","' + r[1].replace(/"/g, '""') + '"'; }).join('\n');
    downloadBlob(csv, 'subnet-' + state.lastCalc.network.replace(/\./g, '-') + '-' + state.lastCalc.prefix + '.csv', 'text/csv');
  });
  $('[data-download-json]', root).addEventListener('click', function () {
    if (!state.lastCalc || state.lastCalc.error) return;
    var obj = {};
    reportLines(state.lastCalc).slice(1).forEach(function (r) { obj[r[0]] = r[1]; });
    downloadBlob(JSON.stringify(obj, null, 2), 'subnet-' + state.lastCalc.network.replace(/\./g, '-') + '-' + state.lastCalc.prefix + '.json', 'application/json');
  });
  $('[data-print-report]', root).addEventListener('click', function () { window.print(); });
  $('[data-share-link]', root).addEventListener('click', function () {
    if (!state.lastCalc || state.lastCalc.error) return;
    var url = window.location.origin + window.location.pathname + '?ip=' + encodeURIComponent(state.lastCalc.ip) + '&cidr=' + state.lastCalc.prefix;
    copyText(url);
    flashHint('Shareable link copied to clipboard.');
  });

  /* ============================================================
     CIDR reference table
     ============================================================ */
  var cidrRefBody = $('[data-cidr-ref-body]'); // lives in a section outside `root` — search the whole document
  (function buildCidrReference() {
    var rows = [];
    for (var p = 0; p <= 32; p++) {
      var maskInt = cidrToMaskInt(p);
      var wildcardInt = (~maskInt) >>> 0;
      var total = Math.pow(2, 32 - p);
      var usable = usableHostsForPrefix(p);
      rows.push('<tr data-ref-cidr="' + p + '"><td>/' + p + '</td><td>' + intToIp(maskInt) + '</td><td>' + intToIp(wildcardInt) + '</td><td>' + total.toLocaleString() + '</td><td>' + usable.toLocaleString() + '</td></tr>');
    }
    cidrRefBody.innerHTML = rows.join('');
    $all('[data-ref-cidr]', cidrRefBody).forEach(function (tr) {
      tr.addEventListener('click', function () {
        var p = tr.getAttribute('data-ref-cidr');
        state.maskMode = 'cidr';
        maskModeButtons.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-mask-mode') === 'cidr'); b.setAttribute('aria-pressed', b.getAttribute('data-mask-mode') === 'cidr' ? 'true' : 'false'); });
        cidrLabel.textContent = 'CIDR prefix';
        cidrInput.value = p;
        cidrSlider.value = p;
        runBasicCalculation();
        var tool = document.getElementById('subnet-tool');
        if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  })();

  /* ============================================================
     Required Hosts mode
     ============================================================ */
  $('[data-calc-hosts]', root).addEventListener('click', function () {
    var errEl = $('[data-hosts-error]', root);
    var summaryEl = $('[data-hosts-summary]', root);
    var tableEl = $('[data-hosts-table]', root);
    errEl.textContent = '';
    var ip = $('[data-hosts-ip]', root).value.trim();
    var hosts = parseInt($('[data-hosts-count]', root).value, 10);
    if (ipToInt(ip) === null) { errEl.textContent = 'Enter a valid IPv4 address.'; return; }
    if (isNaN(hosts) || hosts < 1) { errEl.textContent = 'Enter the number of hosts needed (1 or more).'; return; }
    var prefix = neededPrefixForHosts(hosts);
    var calc = calculateSubnet(ip, prefix);
    summaryEl.innerHTML = [
      { lbl: 'Recommended CIDR', val: '/' + prefix },
      { lbl: 'Subnet mask', val: calc.mask },
      { lbl: 'Usable hosts', val: calc.usable.toLocaleString() + ' (needed ' + hosts.toLocaleString() + ')' },
      { lbl: 'Total addresses', val: calc.total.toLocaleString() }
    ].map(function (c) { return '<div class="sn-summary-card"><div class="lbl">' + c.lbl + '</div><div class="val">' + escapeHtml(c.val) + '</div></div>'; }).join('');
    tableEl.innerHTML =
      copyRow('Example network (from your base IP)', calc.network + '/' + prefix) +
      copyRow('Usable range', calc.firstUsable + ' – ' + calc.lastUsable) +
      copyRow('Broadcast address', calc.broadcast);
    wireCopyButtons(tableEl);
  });

  /* ============================================================
     Required Subnets mode
     ============================================================ */
  $('[data-calc-subnets]', root).addEventListener('click', function () {
    var errEl = $('[data-subnets-error]', root);
    var hintEl = $('[data-subnets-hint]', root);
    var wrapEl = $('[data-subnets-result-wrap]', root);
    var bodyEl = $('[data-subnets-result-body]', root);
    errEl.textContent = ''; hintEl.textContent = ''; wrapEl.classList.add('hidden');

    var ip = $('[data-subnets-ip]', root).value.trim();
    var basePrefix = parseInt($('[data-subnets-base-cidr]', root).value, 10);
    var subnetsNeeded = parseInt($('[data-subnets-count]', root).value, 10);
    var ipInt = ipToInt(ip);
    if (ipInt === null) { errEl.textContent = 'Enter a valid base IPv4 address.'; return; }
    if (isNaN(basePrefix) || basePrefix < 0 || basePrefix > 32) { errEl.textContent = 'Base CIDR must be between 0 and 32.'; return; }
    if (isNaN(subnetsNeeded) || subnetsNeeded < 1) { errEl.textContent = 'Enter the number of subnets needed (1 or more).'; return; }

    var borrowBits = Math.ceil(Math.log2(subnetsNeeded));
    var newPrefix = basePrefix + borrowBits;
    if (newPrefix > 32) { errEl.textContent = 'That many subnets would require a prefix longer than /32 — reduce the count or use a larger base network.'; return; }

    var baseNetworkInt = (ipInt & cidrToMaskInt(basePrefix)) >>> 0;
    var result = generateSubnetList(baseNetworkInt, basePrefix, newPrefix);
    hintEl.textContent = 'Borrowing ' + borrowBits + ' bit' + (borrowBits === 1 ? '' : 's') + ' from /' + basePrefix + ' gives /' + newPrefix + ', creating ' + result.total.toLocaleString() + ' subnets (you asked for ' + subnetsNeeded + ').';
    bodyEl.innerHTML = result.list.map(function (c, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + c.network + '</td><td>/' + c.prefix + '</td><td>' + c.firstUsable + '</td><td>' + c.lastUsable + '</td><td>' + c.broadcast + '</td></tr>';
    }).join('');
    wrapEl.classList.remove('hidden');
  });

  /* ============================================================
     VLSM planner mode
     ============================================================ */
  var vlsmRowsWrap = $('[data-vlsm-rows]', root);
  function wireVlsmRow(row) {
    row.querySelector('[data-vlsm-remove]').addEventListener('click', function () {
      if (vlsmRowsWrap.children.length > 1) row.remove();
    });
  }
  wireVlsmRow($('[data-vlsm-row]', root));
  $('[data-vlsm-add]', root).addEventListener('click', function () {
    var template = $('[data-vlsm-row]', root);
    var clone = template.cloneNode(true);
    clone.querySelector('[data-vlsm-name]').value = '';
    clone.querySelector('[data-vlsm-hosts]').value = '';
    vlsmRowsWrap.appendChild(clone);
    wireVlsmRow(clone);
    clone.querySelector('[data-vlsm-name]').focus();
  });

  $('[data-vlsm-calc]', root).addEventListener('click', function () {
    var errEl = $('[data-vlsm-error]', root);
    var wrapEl = $('[data-vlsm-result-wrap]', root);
    var bodyEl = $('[data-vlsm-result-body]', root);
    errEl.textContent = '';
    wrapEl.classList.add('hidden');

    var ip = $('[data-vlsm-ip]', root).value.trim();
    var basePrefix = parseInt($('[data-vlsm-cidr]', root).value, 10);
    var ipInt = ipToInt(ip);
    if (ipInt === null) { errEl.textContent = 'Enter a valid base IPv4 address.'; return; }
    if (isNaN(basePrefix) || basePrefix < 0 || basePrefix > 32) { errEl.textContent = 'Base CIDR must be between 0 and 32.'; return; }

    var requirements = [];
    var rowError = '';
    $all('[data-vlsm-row]', vlsmRowsWrap).forEach(function (row) {
      var name = row.querySelector('[data-vlsm-name]').value.trim() || 'Subnet';
      var hosts = parseInt(row.querySelector('[data-vlsm-hosts]').value, 10);
      if (isNaN(hosts) || hosts < 1) { rowError = 'Every requirement needs a valid host count (1 or more).'; return; }
      requirements.push({ name: name, hosts: hosts });
    });
    if (rowError) { errEl.textContent = rowError; return; }
    if (!requirements.length) { errEl.textContent = 'Add at least one requirement.'; return; }

    var baseNetworkInt = (ipInt & cidrToMaskInt(basePrefix)) >>> 0;
    var results = planVlsm(baseNetworkInt, basePrefix, requirements);
    var hasError = results.some(function (r) { return r.error; });
    bodyEl.innerHTML = results.map(function (r) {
      if (r.error) return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + r.hosts + '</td><td colspan="4" style="color:#dc2626">' + r.error + '</td></tr>';
      var c = r.calc;
      return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + r.hosts + '</td><td>/' + r.prefix + '</td><td>' + c.network + '</td><td>' + c.firstUsable + ' – ' + c.lastUsable + '</td><td>' + c.broadcast + '</td></tr>';
    }).join('');
    wrapEl.classList.remove('hidden');
    if (hasError) errEl.textContent = 'Some requirements did not fit in the base network — shrink the list or use a larger base CIDR.';
  });

  /* ============================================================
     Sticky CTA + init
     ============================================================ */
  var stickyCta = $('[data-sticky-subnet-cta]');
  if (stickyCta) {
    stickyCta.addEventListener('click', function () {
      var tool = document.getElementById('subnet-tool');
      if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ipInput.focus();
    });
  }

  (function initFromQueryString() {
    try {
      var params = new URLSearchParams(window.location.search);
      var qIp = params.get('ip'), qCidr = params.get('cidr');
      if (qIp && ipToInt(qIp) !== null) ipInput.value = qIp;
      if (qCidr && /^\d{1,2}$/.test(qCidr)) { cidrInput.value = qCidr; cidrSlider.value = qCidr; }
    } catch (e) { /* URLSearchParams unsupported — ignore, defaults apply */ }
  })();

  runBasicCalculation();
  updateSubnetListHint();
})();
