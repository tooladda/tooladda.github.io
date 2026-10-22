/* ============================================================================
   ToolAdda — OMR Sheet Generator
   Rewritten rendering layer; every setting from the previous version is kept.

   ---------------------------------------------------------------------------
   WHY THIS IS BUILT THE WAY IT IS
   ---------------------------------------------------------------------------
   The previous version drew the on-screen preview with HTML/CSS and the PDF
   with a completely separate set of jsPDF calls. Two renderers for one sheet
   means they drift: a header tweak lands in one and not the other, and the
   paper the teacher prints stops matching the preview they approved.

   So there is now exactly one layout engine. `computeLayout()` is a pure
   function that turns the settings into a list of drawing operations in
   millimetres — the real, physical page. Nothing else decides position.

       computeLayout(settings) -> { pages: [ { ops: [...] } ] }
                                        |
                    +-------------------+-------------------+
                    |                   |                   |
                 renderSVG          renderPDF           (PNG via SVG)
                 preview/print       jsPDF vector        canvas raster

   Because the preview is that same SVG at the same millimetre coordinates,
   what you see is what prints, and PNG/SVG export come almost for free.
   ============================================================================ */

(function () {
  "use strict";

  /* ==========================================================================
     CONSTANTS
     ========================================================================== */

  var STORAGE_KEY = "tooladda-omr-settings";
  var MM = 1;                       // the unit everything is expressed in

  var PAGE_SIZES = {
    a4:     { w: 210,   h: 297,   label: "A4" },
    letter: { w: 215.9, h: 279.4, label: "Letter" },
    legal:  { w: 215.9, h: 355.6, label: "Legal" },
    a5:     { w: 148,   h: 210,   label: "A5" }
  };

  var MARGINS = { top: 10, bottom: 10, left: 12, right: 12 };

  /* Bubble geometry in mm. rowH is the height of one question row before the
     spacing multiplier is applied. */
  var BUBBLE_SIZES = {
    small:  { r: 1.3, rowH: 5.0, labelFs: 2.4, numFs: 2.5 },
    medium: { r: 1.6, rowH: 6.0, labelFs: 2.7, numFs: 2.8 },
    large:  { r: 2.0, rowH: 7.2, labelFs: 3.1, numFs: 3.2 }
  };

  var SPACING = { compact: 0.86, normal: 1, spacious: 1.22 };

  var PRESETS = {
    standard50: { label: "Standard 50 MCQ", questionCount: 50, optionsCount: 4, columns: 2, rollDigits: 6, startQuestion: 1, optionLabels: "" },
    neet:       { label: "NEET Style", questionCount: 180, optionsCount: 4, columns: 4, rollDigits: 10, startQuestion: 1, optionLabels: "", bubbleSize: "small" },
    jee:        { label: "JEE Main", questionCount: 75, optionsCount: 4, columns: 3, rollDigits: 10, startQuestion: 1, optionLabels: "" },
    school40:   { label: "School Exam 40", questionCount: 40, optionsCount: 4, columns: 2, rollDigits: 4, startQuestion: 1, optionLabels: "" },
    tf30:       { label: "True / False 30", questionCount: 30, optionsCount: 2, columns: 2, rollDigits: 6, startQuestion: 1, optionLabels: "T,F" }
  };

  var DEFAULTS = {
    examTitle: "Mid-Term Examination",
    organization: "Sample Public School",
    examDate: "", subjectCode: "", formId: "",
    questionCount: 50, startQuestion: 1, optionsCount: 4, columns: 2,
    autoLayout: true, optionLabels: "",
    bubbleSize: "medium", bubbleStyle: "circle", bubbleSpacing: "normal",
    pageSize: "a4", orientation: "portrait", copies: 1,
    rollDigits: 6,
    showRoll: true, showName: true, showSet: false, showDateField: true,
    showSignature: true, showInstructions: true, showPhoto: false,
    showPageNumbers: true, showRegMarks: false, scannerMode: false,
    instructions: "• Use BLACK or BLUE ballpoint pen only.\n" +
      "• Fill the bubble completely — do not tick (✓) or cross (×).\n" +
      "• Erase completely if you change an answer.\n" +
      "• Each question has only ONE correct answer.\n" +
      "• Do not fold, tear, or make stray marks on the sheet.",
    showAnswerKey: false
  };

  var LIMITS = {
    questionCount: [1, 300], startQuestion: [1, 1000], optionsCount: [2, 6],
    columns: [1, 5], copies: [1, 100], rollDigits: [4, 12]
  };

  /* ==========================================================================
     STATE
     ========================================================================== */

  var state = {
    previewIdx: 0,
    pages: [],
    answerKey: {},
    zoom: 0,            // 0 = fit to viewport
    currentScale: 1,
    logo: null,         // { dataUrl, w, h }
    errors: {}
  };

  var els = {};
  var $ = function (id) { return document.getElementById(id); };

  /* ==========================================================================
     SMALL HELPERS
     ========================================================================== */

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function num(v, fallback, lo, hi) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = fallback;
    return clamp(n, lo, hi);
  }

  function defaultLabels(count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(String.fromCharCode(65 + i));
    return out;
  }

  function parseLabels(str, count) {
    var raw = String(str || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    return raw.length === count ? raw : defaultLabels(count);
  }

  function toast(msg) {
    var el = els.toast;
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ==========================================================================
     SETTINGS  (read from / written to the form)
     ========================================================================== */

  function getSettings() {
    var v = function (id) { var e = $(id); return e ? e.value : ""; };
    var c = function (id) { var e = $(id); return e ? e.checked : false; };

    var s = {
      examTitle: v("omrExamTitle").trim(),
      organization: v("omrOrganization").trim(),
      examDate: v("omrExamDate").trim(),
      subjectCode: v("omrSubjectCode").trim(),
      formId: v("omrFormId").trim(),

      questionCount: num(v("omrQuestionCount"), 50, LIMITS.questionCount[0], LIMITS.questionCount[1]),
      startQuestion: num(v("omrStartQuestion"), 1, LIMITS.startQuestion[0], LIMITS.startQuestion[1]),
      optionsCount: num(v("omrOptionsCount"), 4, LIMITS.optionsCount[0], LIMITS.optionsCount[1]),
      columns: num(v("omrColumns"), 2, LIMITS.columns[0], LIMITS.columns[1]),
      autoLayout: c("omrAutoLayout"),
      optionLabels: v("omrOptionLabels").trim(),

      bubbleSize: v("omrBubbleSize") || "medium",
      bubbleStyle: v("omrBubbleStyle") || "circle",
      bubbleSpacing: v("omrBubbleSpacing") || "normal",

      pageSize: v("omrPageSize") || "a4",
      orientation: v("omrOrientation") || "portrait",
      copies: num(v("omrCopies"), 1, LIMITS.copies[0], LIMITS.copies[1]),

      rollDigits: num(v("omrRollDigits"), 6, LIMITS.rollDigits[0], LIMITS.rollDigits[1]),
      showRoll: c("omrShowRoll"),
      showName: c("omrShowName"),
      showSet: c("omrShowSet"),
      showDateField: c("omrShowDateField"),
      showSignature: c("omrShowSignature"),
      showInstructions: c("omrShowInstructions"),
      showPhoto: c("omrShowPhoto"),
      showPageNumbers: c("omrShowPageNumbers"),
      showRegMarks: c("omrShowRegMarks"),
      scannerMode: c("omrScannerMode"),

      instructions: v("omrInstructions"),
      showAnswerKey: c("omrShowAnswerKey"),
      answerKey: Object.assign({}, state.answerKey),
      logo: state.logo
    };

    return normalizeSettings(s);
  }

  /** Rules that must hold however the settings arrived — from the form, from
      localStorage, from an imported JSON file, or from a direct call. Keeping
      them here rather than in the form reader means the layout engine cannot
      be handed a configuration it would draw incorrectly. */
  function normalizeSettings(s) {
    if (s.scannerMode) {
      s.bubbleStyle = "circle";     // decorative shapes hurt mark detection
      s.showPhoto = false;
      s.showRegMarks = true;
    }
    return s;
  }

  function applySettings(s) {
    if (!s) return;
    var set = function (id, val) { var e = $(id); if (e != null && val != null) e.value = val; };
    var chk = function (id, val) { var e = $(id); if (e) e.checked = !!val; };

    set("omrExamTitle", s.examTitle);
    set("omrOrganization", s.organization);
    set("omrExamDate", s.examDate);
    set("omrSubjectCode", s.subjectCode);
    set("omrFormId", s.formId);
    set("omrQuestionCount", s.questionCount);
    set("omrStartQuestion", s.startQuestion);
    set("omrOptionsCount", s.optionsCount);
    set("omrColumns", s.columns);
    set("omrOptionLabels", s.optionLabels);
    set("omrBubbleSize", s.bubbleSize);
    set("omrBubbleStyle", s.bubbleStyle);
    set("omrBubbleSpacing", s.bubbleSpacing);
    set("omrPageSize", s.pageSize);
    set("omrOrientation", s.orientation);
    set("omrCopies", s.copies);
    set("omrRollDigits", s.rollDigits);
    if (s.instructions != null) set("omrInstructions", s.instructions);

    chk("omrAutoLayout", s.autoLayout !== false);
    chk("omrShowRoll", s.showRoll !== false);
    chk("omrShowName", s.showName !== false);
    chk("omrShowSet", s.showSet);
    chk("omrShowDateField", s.showDateField !== false);
    chk("omrShowSignature", s.showSignature !== false);
    chk("omrShowInstructions", s.showInstructions !== false);
    chk("omrShowPhoto", s.showPhoto);
    chk("omrShowPageNumbers", s.showPageNumbers !== false);
    chk("omrShowRegMarks", s.showRegMarks);
    chk("omrScannerMode", s.scannerMode);
    chk("omrShowAnswerKey", s.showAnswerKey);

    if (s.answerKey) state.answerKey = Object.assign({}, s.answerKey);
    if (s.logo && s.logo.dataUrl) { state.logo = s.logo; showLogoPreview(); }
    buildAnswerKeyUI();
    syncColumnsDisabled();
  }

  /* ==========================================================================
     LAYOUT ENGINE
     The only place that decides where anything sits on the paper.
     Everything below returns / consumes millimetres.
     ========================================================================== */

  function pageDims(s) {
    var base = PAGE_SIZES[s.pageSize] || PAGE_SIZES.a4;
    return s.orientation === "landscape"
      ? { w: base.h, h: base.w }
      : { w: base.w, h: base.h };
  }

  function bubbleMetrics(s) {
    var b = BUBBLE_SIZES[s.bubbleSize] || BUBBLE_SIZES.medium;
    var mult = SPACING[s.bubbleSpacing] || 1;
    return {
      r: b.r,
      rowH: b.rowH * mult,
      /* Derived from the radius rather than fixed, so a letter can never be
         wider than the bubble it sits in at any bubble size. 1.15r keeps the
         cap height near 80% of the diameter, which reads clearly and still
         leaves a margin inside the outline. */
      labelFs: b.r * 1.15,
      numFs: b.numFs,
      optGap: (b.r * 2 + 1.6) * (s.bubbleSpacing === "compact" ? 0.9 : s.bubbleSpacing === "spacious" ? 1.12 : 1)
    };
  }

  /** Space reserved for the question number before the first bubble.

      This was a fixed 7-8mm, which collided with the bubbles as soon as the
      numbering reached three digits and overlapped badly at four. It has to be
      derived from the widest number that will actually be printed and from the
      font size in use. 0.58em is a safe per-character advance for Helvetica
      digits; the trailing term is the gap to the first bubble. */
  function numberGutter(s, bub) {
    var widest = String(s.startQuestion + s.questionCount - 1).length + 1;  // digits + "."
    return widest * (bub.numFs * TYPE_EM) * 0.58 + 1.8;
  }

  /** Width one question row needs: number gutter + all option bubbles. */
  function rowWidth(s, bub) {
    return numberGutter(s, bub) + s.optionsCount * bub.optGap;
  }

  /** Header height, obtained by actually building the header rather than by
      a parallel estimate. An estimator that lives apart from the drawing code
      is exactly what drifts, and here a drift of a few millimetres silently
      changes the page count. Built once, measured, then reused. */
  function headerHeight(s) {
    return buildHeader(s, bubbleMetrics(s), pageDims(s)).height;
  }

  /** How many columns actually fit across the usable width. */
  function maxColumnsThatFit(s, bub) {
    var dim = pageDims(s);
    var usable = dim.w - MARGINS.left - MARGINS.right;
    return Math.max(1, Math.floor(usable / rowWidth(s, bub)));
  }

  /** Auto layout: the widest column count that still fits, capped so rows do
      not become uncomfortably short, then reduced if it would leave the last
      page nearly empty. */
  function chooseColumns(s, bub) {
    var fit = maxColumnsThatFit(s, bub);
    var wanted = s.questionCount <= 20 ? 1
      : s.questionCount <= 60 ? 2
      : s.questionCount <= 120 ? 3
      : 4;
    return clamp(Math.min(wanted, fit), 1, LIMITS.columns[1]);
  }

  /** Split the questions across pages using real millimetre capacity. */
  function paginate(s) {
    var dim = pageDims(s);
    var bub = bubbleMetrics(s);
    var cols = s.autoLayout ? chooseColumns(s, bub) : clamp(s.columns, 1, maxColumnsThatFit(s, bub));

    var contentH = dim.h - MARGINS.top - MARGINS.bottom;
    var footerH = (s.showSignature ? 12 : 0) + (s.showPageNumbers ? 5 : 2);
    var hFirst = headerHeight(s);
    var hRest = 10;                                    // continuation strip

    var perColFirst = Math.max(1, Math.floor((contentH - hFirst - footerH) / bub.rowH));
    var perColRest = Math.max(1, Math.floor((contentH - hRest - footerH) / bub.rowH));

    var pages = [];
    var remaining = s.questionCount;
    var qIndex = 0;
    var pageNum = 1;
    var guard = 0;

    while (remaining > 0 && guard++ < 400) {
      var perCol = pageNum === 1 ? perColFirst : perColRest;
      var capacity = perCol * cols;
      var take = Math.min(remaining, capacity);
      var qs = [];
      for (var i = 0; i < take; i++) qs.push(s.startQuestion + qIndex + i);
      pages.push({ pageNum: pageNum, questions: qs, perCol: perCol, cols: cols, first: pageNum === 1 });
      qIndex += take;
      remaining -= take;
      pageNum++;
    }
    if (!pages.length) pages.push({ pageNum: 1, questions: [], perCol: perColFirst, cols: cols, first: true });

    return { pages: pages, cols: cols, perColFirst: perColFirst, perColRest: perColRest, bub: bub, dim: dim };
  }

  /* ---- drawing-op helpers -------------------------------------------------
     Each op is a plain object so both renderers can consume it.

     Sizes are written at the call sites as approximate cap heights, which is
     the intuitive way to pick them against a millimetre layout. TYPE_EM turns
     one into the em size the renderers actually need. Converting here, once,
     is what keeps the SVG preview and the PDF at identical type sizes. */
  var TYPE_EM = 1.34;

  function opText(x, y, str, size, opts) {
    opts = opts || {};
    return { t: "text", x: x, y: y, s: String(str), size: size * TYPE_EM,
      align: opts.align || "left", bold: !!opts.bold, color: opts.color || "#000" };
  }
  function opRect(x, y, w, h, opts) {
    opts = opts || {};
    return { t: "rect", x: x, y: y, w: w, h: h, fill: opts.fill || null,
      stroke: opts.stroke === undefined ? "#000" : opts.stroke, lw: opts.lw || 0.25, rx: opts.rx || 0 };
  }
  function opLine(x1, y1, x2, y2, lw) {
    return { t: "line", x1: x1, y1: y1, x2: x2, y2: y2, lw: lw || 0.25 };
  }
  function opBubble(cx, cy, r, style, filled, label, fs) {
    return { t: "bubble", x: cx, y: cy, r: r, style: style, filled: !!filled,
      label: label == null ? "" : String(label), size: fs * TYPE_EM };
  }
  function opImage(x, y, w, h, dataUrl) {
    return { t: "image", x: x, y: y, w: w, h: h, src: dataUrl };
  }

  /** The first-page header, built once and reused by both the paginator and
      the page renderer so the two can never disagree about its height. */
  function buildHeader(s, bub, dim) {
    var ops = [];
    var ml = MARGINS.left, mr = MARGINS.right, mt = MARGINS.top;
    var innerW = dim.w - ml - mr;
    var y = mt;

    /* ---- masthead ---- */
    if (s.logo && s.logo.dataUrl && !s.scannerMode) {
      var lh = 12;
      var lw = Math.min(26, lh * (s.logo.w / s.logo.h || 1));
      ops.push(opImage(ml, y, lw, lh, s.logo.dataUrl));
    }
    if (s.examTitle) {
      ops.push(opText(dim.w / 2, y + 5, s.examTitle, 4.6, { align: "center", bold: true }));
      y += 7;
    }
    if (s.organization && !s.scannerMode) {
      ops.push(opText(dim.w / 2, y + 3.4, s.organization, 3.1, { align: "center" }));
      y += 5.5;
    }
    var metaBits = [];
    if (s.examDate) metaBits.push("Date: " + s.examDate);
    if (s.subjectCode) metaBits.push("Subject: " + s.subjectCode);
    if (s.formId) metaBits.push("Form: " + s.formId);
    if (metaBits.length && !s.scannerMode) {
      ops.push(opText(dim.w / 2, y + 3, metaBits.join("   |   "), 2.8, { align: "center", color: "#333" }));
      y += 5;
    }
    y += 2;
    ops.push(opLine(ml, y, dim.w - mr, y, 0.4));
    y += 4;

    /* ---- identity band ----------------------------------------------
       The roll grid sits beside the candidate lines rather than under
       them. Stacking them wastes the whole width to the right of the
       grid and pushed a 50-question sheet onto a second page; side by
       side is also how a real OMR sheet is laid out. */
    var bandTop = y;
    var photoW = 22, photoH = 26, photoX = dim.w - mr - photoW;
    if (s.showPhoto) {
      ops.push(opRect(photoX, bandTop, photoW, photoH));
      ops.push(opText(photoX + photoW / 2, bandTop + photoH / 2, "Affix", 2.5, { align: "center", color: "#666" }));
      ops.push(opText(photoX + photoW / 2, bandTop + photoH / 2 + 3.4, "Photo", 2.5, { align: "center", color: "#666" }));
    }
    var bandRight = s.showPhoto ? photoX - 4 : dim.w - mr;

    var rollW = 0, rollBottom = bandTop;
    if (s.showRoll) {
      var cell = bub.r * 2 + 1.0;
      var gridW = s.rollDigits * cell + 3;
      var gridH = 10 * cell + 5.2;
      ops.push(opText(ml, bandTop + 2.4, "Roll Number", 2.6, { bold: true }));
      var gy = bandTop + 3.6;
      ops.push(opRect(ml, gy, gridW, gridH, { lw: 0.3 }));
      for (var d = 0; d < s.rollDigits; d++) {
        var cx = ml + 1.5 + d * cell + cell / 2;
        for (var digit = 0; digit <= 9; digit++) {
          var cyD = gy + 5.0 + digit * cell + cell / 2 - 0.4;
          ops.push(opBubble(cx, cyD, bub.r, "circle", false, String(digit), bub.labelFs));
        }
      }
      ops.push(opLine(ml, gy + 4.4, ml + gridW, gy + 4.4, 0.25));
      ops.push(opText(ml + gridW / 2, gy + 3.2, "fill one per column", 2.1, { align: "center", color: "#555" }));
      rollW = gridW;
      rollBottom = gy + gridH;
    }

    /* candidate lines run down the space beside the grid */
    var fx = s.showRoll ? ml + rollW + 5 : ml;
    var fy = bandTop;
    if (s.showName) {
      ops.push(opText(fx, fy + 3, "Name:", 3));
      ops.push(opLine(fx + 14, fy + 3.6, bandRight, fy + 3.6, 0.3));
      fy += 8.5;
      ops.push(opText(fx, fy + 3, "Class / Sec:", 3));
      ops.push(opLine(fx + 22, fy + 3.6, bandRight, fy + 3.6, 0.3));
      fy += 8.5;
    }
    if (s.showDateField) {
      ops.push(opText(fx, fy + 3, "Date:", 3));
      ops.push(opLine(fx + 12, fy + 3.6, bandRight, fy + 3.6, 0.3));
      fy += 8.5;
    }

    y = Math.max(rollBottom, fy, bandTop + (s.showPhoto ? photoH : 0)) + 4;

    /* ---- set / booklet code ---- */
    if (s.showSet) {
      ops.push(opText(ml, y + 2.8, "Set / Booklet Code:", 2.9, { bold: true }));
      var sx = ml + 32;
      ["A", "B", "C", "D", "E"].forEach(function (lab, i) {
        ops.push(opBubble(sx + i * (bub.r * 2 + 5), y + 2.2, bub.r, s.bubbleStyle, false, lab, bub.labelFs));
      });
      y += 8;
    }

    /* ---- instructions ---- */
    if (s.showInstructions && !s.scannerMode) {
      var lines = String(s.instructions || "").split("\n")
        .map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length) {
        ops.push(opText(ml, y + 2.6, "Instructions", 2.9, { bold: true }));
        y += 4;
        var boxH = lines.length * 3.6 + 2.6;
        ops.push(opRect(ml, y, innerW, boxH, { lw: 0.2 }));
        lines.forEach(function (line, i) {
          ops.push(opText(ml + 2, y + 3.4 + i * 3.6, line.replace(/^[•\-]\s*/, "• "), 2.5));
        });
        y += boxH + 3;
      }
    }

    return { ops: ops, height: y - mt };
  }

  /** Build the complete op list for one sheet page. */
  function buildSheetPage(s, page, plan, totalPages, copyLabel) {
    var dim = plan.dim, bub = plan.bub;
    var ops = [];
    var ml = MARGINS.left, mr = MARGINS.right, mt = MARGINS.top;
    var innerW = dim.w - ml - mr;
    var y = mt;

    if (s.showRegMarks) ops = ops.concat(registrationMarks(dim));

    if (copyLabel) {
      ops.push(opText(dim.w - mr, mt - 3.5, copyLabel, 2.4, { align: "right", color: "#444" }));
    }

    if (page.first) {
      var hdr = buildHeader(s, bub, dim);
      ops = ops.concat(hdr.ops);
      y = mt + hdr.height;
    } else {
      /* continuation strip on pages 2+ */
      ops.push(opText(dim.w / 2, y + 3.2, (s.examTitle || "OMR Answer Sheet") + " — continued", 3, { align: "center" }));
      y += 5;
      ops.push(opLine(ml, y, dim.w - mr, y, 0.3));
      y += 4;
    }

    /* ---- question grid ---- */
    ops = ops.concat(questionOps(s, page, plan, ml, y, innerW));

    /* ---- footer ---- */
    var footY = dim.h - MARGINS.bottom;
    if (s.showSignature) {
      ops.push(opText(dim.w - mr - 56, footY - 6, "Candidate Signature:", 2.8));
      ops.push(opLine(dim.w - mr - 26, footY - 5.4, dim.w - mr, footY - 5.4, 0.3));
    }
    if (s.showPageNumbers) {
      ops.push(opText(dim.w / 2, footY - 1, "Page " + page.pageNum + " of " + totalPages, 2.5,
        { align: "center", color: "#444" }));
    }
    if (s.formId && !page.first) {
      ops.push(opText(ml, footY - 1, "Form: " + s.formId, 2.4, { color: "#444" }));
    }

    return { ops: ops, w: dim.w, h: dim.h, pageNum: page.pageNum, type: "sheet" };
  }

  /** Question rows, laid out column by column. */
  function questionOps(s, page, plan, ml, top, innerW) {
    var bub = plan.bub;
    var ops = [];
    var cols = page.cols;
    var colW = innerW / cols;
    var perCol = Math.ceil(page.questions.length / cols);
    var labels = parseLabels(s.optionLabels, s.optionsCount);

    /* one gutter for the whole sheet keeps every column's bubbles aligned,
       which matters both visually and for anything reading the sheet back */
    var gutter = numberGutter(s, bub);

    for (var c = 0; c < cols; c++) {
      var slice = page.questions.slice(c * perCol, (c + 1) * perCol);
      var colX = ml + c * colW;
      for (var i = 0; i < slice.length; i++) {
        var qNum = slice[i];
        var rowY = top + i * bub.rowH + bub.rowH / 2;
        ops.push(opText(colX, rowY + bub.numFs * 0.36, String(qNum) + ".", bub.numFs, { bold: false }));
        for (var o = 0; o < s.optionsCount; o++) {
          var bx = colX + gutter + o * bub.optGap + bub.r;
          ops.push(opBubble(bx, rowY, bub.r, s.bubbleStyle, false, labels[o], bub.labelFs));
        }
      }
    }
    return ops;
  }

  /** Corner registration marks for scanner alignment. */
  function registrationMarks(dim) {
    var m = 6, sz = 4;
    var pts = [[m, m], [dim.w - m - sz, m], [m, dim.h - m - sz], [dim.w - m - sz, dim.h - m - sz]];
    return pts.map(function (p) {
      return opRect(p[0], p[1], sz, sz, { fill: "#000", stroke: null });
    });
  }

  /** The teacher's answer key page — never part of the student sheet. */
  function buildAnswerKeyPage(s, plan, pageNum, totalPages) {
    var dim = plan.dim, bub = plan.bub;
    var ops = [];
    var ml = MARGINS.left, mr = MARGINS.right;
    var innerW = dim.w - ml - mr;
    var y = MARGINS.top;

    ops.push(opText(dim.w / 2, y + 5, "Answer Key — " + (s.examTitle || "Exam"), 4.6,
      { align: "center", bold: true }));
    y += 8;
    if (s.organization) { ops.push(opText(dim.w / 2, y + 3, s.organization, 3, { align: "center" })); y += 5; }
    ops.push(opText(dim.w / 2, y + 3, "For teacher use only — do not distribute with the answer sheet", 2.6,
      { align: "center", color: "#444" }));
    y += 6;
    ops.push(opLine(ml, y, dim.w - mr, y, 0.4));
    y += 5;

    var labels = parseLabels(s.optionLabels, s.optionsCount);
    var cols = Math.max(1, Math.min(5, plan.cols + 1));
    var colW = innerW / cols;
    var perCol = Math.ceil(s.questionCount / cols);
    var keyGutter = numberGutter(s, bub);

    for (var c = 0; c < cols; c++) {
      for (var i = 0; i < perCol; i++) {
        var idx = c * perCol + i;
        if (idx >= s.questionCount) break;
        var qNum = s.startQuestion + idx;
        var rowY = y + i * bub.rowH + bub.rowH / 2;
        var colX = ml + c * colW;
        ops.push(opText(colX, rowY + bub.numFs * 0.36, String(qNum) + ".", bub.numFs));
        var ans = s.answerKey[qNum];
        for (var o = 0; o < s.optionsCount; o++) {
          var bx = colX + keyGutter + o * bub.optGap + bub.r;
          ops.push(opBubble(bx, rowY, bub.r, s.bubbleStyle, ans === labels[o], labels[o], bub.labelFs));
        }
      }
    }

    if (s.showPageNumbers) {
      ops.push(opText(dim.w / 2, dim.h - MARGINS.bottom - 1, "Answer Key — page " + pageNum + " of " + totalPages,
        2.5, { align: "center", color: "#444" }));
    }
    return { ops: ops, w: dim.w, h: dim.h, pageNum: pageNum, type: "answerkey" };
  }

  /** Top-level: settings in, complete page models out. */
  function computeLayout(settings) {
    var s = normalizeSettings(Object.assign({}, settings));
    var plan = paginate(s);
    var sheetCount = plan.pages.length;
    var out = plan.pages.map(function (p) {
      return buildSheetPage(s, p, plan, sheetCount, null);
    });
    if (s.showAnswerKey) {
      out.push(buildAnswerKeyPage(s, plan, 1, 1));
    }
    return { pages: out, plan: plan, sheetCount: sheetCount };
  }

  /* ==========================================================================
     RENDERER 1 — SVG  (drives preview, print, PNG and SVG export)
     ========================================================================== */

  function renderSVG(page, opts) {
    opts = opts || {};
    var parts = [];
    /* The viewBox is in millimetres, so a font-size is already in millimetres —
       no conversion. An earlier 1.34 factor here made every preview glyph 34%
       larger than the PDF, which is what pushed the option letters outside
       their bubbles. Preview and print must use the same number. */
    var fs = function (mm) { return mm.toFixed(2); };

    page.ops.forEach(function (op) {
      if (op.t === "text") {
        var anchor = op.align === "center" ? "middle" : op.align === "right" ? "end" : "start";
        parts.push('<text x="' + op.x.toFixed(2) + '" y="' + op.y.toFixed(2) +
          '" font-size="' + fs(op.size) + '" text-anchor="' + anchor +
          '" fill="' + op.color + '"' + (op.bold ? ' font-weight="700"' : "") +
          ' font-family="Helvetica, Arial, sans-serif">' + esc(op.s) + "</text>");
      } else if (op.t === "line") {
        parts.push('<line x1="' + op.x1.toFixed(2) + '" y1="' + op.y1.toFixed(2) +
          '" x2="' + op.x2.toFixed(2) + '" y2="' + op.y2.toFixed(2) +
          '" stroke="#000" stroke-width="' + op.lw + '"/>');
      } else if (op.t === "rect") {
        parts.push('<rect x="' + op.x.toFixed(2) + '" y="' + op.y.toFixed(2) +
          '" width="' + op.w.toFixed(2) + '" height="' + op.h.toFixed(2) +
          (op.rx ? '" rx="' + op.rx : "") +
          '" fill="' + (op.fill || "none") + '"' +
          (op.stroke ? ' stroke="' + op.stroke + '" stroke-width="' + op.lw + '"' : "") + "/>");
      } else if (op.t === "bubble") {
        parts.push(bubbleSVG(op, fs));
      } else if (op.t === "image" && op.src) {
        parts.push('<image x="' + op.x.toFixed(2) + '" y="' + op.y.toFixed(2) +
          '" width="' + op.w.toFixed(2) + '" height="' + op.h.toFixed(2) +
          '" href="' + op.src + '" preserveAspectRatio="xMidYMid meet"/>');
      }
    });

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + page.w + " " + page.h +
      '" width="' + page.w + 'mm" height="' + page.h + 'mm"' +
      (opts.class ? ' class="' + opts.class + '"' : "") +
      ' role="img" aria-label="OMR answer sheet page ' + page.pageNum + '">' +
      '<rect width="' + page.w + '" height="' + page.h + '" fill="#fff"/>' +
      parts.join("") + "</svg>";
  }

  function bubbleSVG(op, fs) {
    var shape;
    var fill = op.filled ? "#000" : "#fff";
    if (op.style === "square") {
      shape = '<rect x="' + (op.x - op.r).toFixed(2) + '" y="' + (op.y - op.r).toFixed(2) +
        '" width="' + (op.r * 2).toFixed(2) + '" height="' + (op.r * 2).toFixed(2) +
        '" fill="' + fill + '" stroke="#000" stroke-width="0.22"/>';
    } else if (op.style === "rounded") {
      shape = '<rect x="' + (op.x - op.r).toFixed(2) + '" y="' + (op.y - op.r).toFixed(2) +
        '" width="' + (op.r * 2).toFixed(2) + '" height="' + (op.r * 2).toFixed(2) +
        '" rx="' + (op.r * 0.45).toFixed(2) + '" fill="' + fill + '" stroke="#000" stroke-width="0.22"/>';
    } else if (op.style === "oval") {
      shape = '<ellipse cx="' + op.x.toFixed(2) + '" cy="' + op.y.toFixed(2) +
        '" rx="' + (op.r * 1.28).toFixed(2) + '" ry="' + op.r.toFixed(2) +
        '" fill="' + fill + '" stroke="#000" stroke-width="0.22"/>';
    } else {
      shape = '<circle cx="' + op.x.toFixed(2) + '" cy="' + op.y.toFixed(2) + '" r="' + op.r.toFixed(2) +
        '" fill="' + fill + '" stroke="#000" stroke-width="0.22"/>';
    }
    var label = "";
    if (op.label) {
      label = '<text x="' + op.x.toFixed(2) + '" y="' + (op.y + capHalf(op.size)).toFixed(2) +
        '" font-size="' + fs(op.size) + '" text-anchor="middle" fill="' +
        (op.filled ? "#fff" : "#333") + '" font-family="Helvetica, Arial, sans-serif">' +
        esc(op.label) + "</text>";
    }
    return shape + label;
  }

  /** Half the cap height of a Helvetica glyph at this em size.

      Text sits on its baseline, so to optically centre a capital inside a
      bubble the baseline has to drop by half the cap height. Helvetica's cap
      height is 0.717em; using a flat fraction of the radius instead left the
      letters measurably high — 0.22mm above centre in a 3.2mm bubble. Both
      renderers call this so the preview and the PDF centre identically. */
  function capHalf(em) {
    return em * 0.717 / 2;
  }

  /* ==========================================================================
     RENDERER 2 — jsPDF  (same ops, vector output)
     ========================================================================== */

  function renderPDF(doc, page) {
    page.ops.forEach(function (op) {
      if (op.t === "text") {
        doc.setFontSize(op.size * 2.83);                 // mm -> pt
        doc.setFont("helvetica", op.bold ? "bold" : "normal");
        doc.setTextColor(op.color === "#000" ? 0 : op.color === "#fff" ? 255 : 68);
        doc.text(op.s, op.x, op.y, { align: op.align });
      } else if (op.t === "line") {
        doc.setLineWidth(op.lw);
        doc.setDrawColor(0);
        doc.line(op.x1, op.y1, op.x2, op.y2);
      } else if (op.t === "rect") {
        doc.setLineWidth(op.lw);
        doc.setDrawColor(0);
        if (op.fill) {
          doc.setFillColor(0);
          doc.rect(op.x, op.y, op.w, op.h, op.stroke ? "FD" : "F");
        } else {
          doc.rect(op.x, op.y, op.w, op.h, "S");
        }
      } else if (op.t === "bubble") {
        drawBubblePDF(doc, op);
      } else if (op.t === "image" && op.src) {
        try { doc.addImage(op.src, "PNG", op.x, op.y, op.w, op.h); } catch (e) { /* unsupported image */ }
      }
    });
  }

  function drawBubblePDF(doc, op) {
    doc.setLineWidth(0.22);
    doc.setDrawColor(0);
    doc.setFillColor(op.filled ? 0 : 255);
    var mode = "FD";
    if (op.style === "square" || op.style === "rounded") {
      if (op.style === "rounded" && doc.roundedRect) {
        doc.roundedRect(op.x - op.r, op.y - op.r, op.r * 2, op.r * 2, op.r * 0.45, op.r * 0.45, mode);
      } else {
        doc.rect(op.x - op.r, op.y - op.r, op.r * 2, op.r * 2, mode);
      }
    } else if (op.style === "oval" && doc.ellipse) {
      doc.ellipse(op.x, op.y, op.r * 1.28, op.r, mode);
    } else {
      doc.circle(op.x, op.y, op.r, mode);
    }
    if (op.label) {
      doc.setFontSize(op.size * 2.83);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(op.filled ? 255 : 51);
      doc.text(String(op.label), op.x, op.y + capHalf(op.size), { align: "center" });
    }
  }

  /* ==========================================================================
     VALIDATION  (inline, never alert())
     ========================================================================== */

  var VALIDATORS = [
    { id: "omrQuestionCount", test: function (v) { return v >= 1 && v <= 300; },
      msg: "Enter between 1 and 300 questions." },
    { id: "omrStartQuestion", test: function (v) { return v >= 1 && v <= 1000; },
      msg: "Starting number must be between 1 and 1000." },
    { id: "omrCopies", test: function (v) { return v >= 1 && v <= 100; },
      msg: "Choose between 1 and 100 copies." },
    { id: "omrRollDigits", test: function (v) { return v >= 4 && v <= 12; },
      msg: "Roll number needs 4 to 12 digits." }
  ];

  function validate() {
    var ok = true;
    VALIDATORS.forEach(function (v) {
      var el = $(v.id);
      if (!el) return;
      var raw = el.value.trim();
      var n = parseInt(raw, 10);
      var bad = raw !== "" && (isNaN(n) || !v.test(n));
      setFieldError(v.id, bad ? v.msg : null);
      if (bad) ok = false;
    });

    var s = getSettings();
    var lbl = $("omrOptionLabels");
    if (lbl && lbl.value.trim()) {
      var parts = lbl.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      var bad2 = parts.length !== s.optionsCount;
      setFieldError("omrOptionLabels", bad2
        ? "Enter exactly " + s.optionsCount + " labels to match the option count."
        : null);
      if (bad2) ok = false;
    } else {
      setFieldError("omrOptionLabels", null);
    }
    return ok;
  }

  function setFieldError(id, msg) {
    var el = $(id);
    if (!el) return;
    var holder = el.closest(".omr-field");
    if (!holder) return;
    var err = holder.querySelector(".omr-err");
    if (msg) {
      if (!err) {
        err = document.createElement("p");
        err.className = "omr-err";
        err.id = id + "-err";
        holder.appendChild(err);
      }
      err.textContent = msg;
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", err.id);
    } else if (err) {
      err.remove();
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    }
  }

  /* ==========================================================================
     WARNINGS  (advisory, never blocking)
     ========================================================================== */

  function buildWarnings(s, layout) {
    var out = [];
    var bub = bubbleMetrics(s);
    var fit = maxColumnsThatFit(s, bub);

    if (layout.sheetCount > 1) {
      out.push({ tone: "info", text: "This sheet spans " + layout.sheetCount + " pages." });
    }
    if (!s.autoLayout && s.columns > fit) {
      out.push({ tone: "warn", text: "Only " + fit + " column" + (fit === 1 ? "" : "s") +
        " fit at this bubble size and page width, so " + fit + " " +
        (fit === 1 ? "was" : "were") + " used. Turn on Auto layout, reduce the bubble size, or switch to landscape." });
    }
    if (s.bubbleSize === "large" && s.questionCount > 60) {
      out.push({ tone: "info", text: "Large bubbles use more space, which increases the page count." });
    }
    if (s.orientation === "portrait" && s.optionsCount >= 5 && layout.plan.cols < 2) {
      out.push({ tone: "info", text: "Landscape gives more horizontal room for extra columns." });
    }
    if (s.copies > 20) {
      out.push({ tone: "info", text: s.copies + " copies will make a large PDF and may take a moment." });
    }
    if (s.scannerMode) {
      out.push({ tone: "info", text: "Scanner-friendly mode is on: decoration is removed, bubbles are plain circles and registration marks are added." });
    }
    return out;
  }

  /* ==========================================================================
     PREVIEW
     ========================================================================== */

  var render = function () {
    var s = getSettings();
    validate();

    var layout;
    try {
      layout = computeLayout(s);
    } catch (e) {
      if (window.console) console.error("[omr] layout failed", e);
      els.stage.innerHTML = '<p class="omr-stage-error">This configuration could not be laid out. ' +
        'Try enabling Auto layout, using fewer columns, or a smaller bubble size.</p>';
      return;
    }

    state.pages = layout.pages;
    if (state.previewIdx >= state.pages.length) state.previewIdx = state.pages.length - 1;
    if (state.previewIdx < 0) state.previewIdx = 0;

    drawPreview();
    renderThumbnails();
    updateSummary(s, layout);
    renderWarnings(buildWarnings(s, layout));
    autoSave(s);
  };

  function drawPreview() {
    var page = state.pages[state.previewIdx];
    if (!page) { els.stage.innerHTML = ""; return; }
    var svg = renderSVG(page, { class: "omr-sheet-svg" });
    els.stage.innerHTML = '<div class="omr-paper" id="omrPaper">' + svg + "</div>";
    applyZoom();

    els.pageMeta.textContent = page.type === "answerkey"
      ? "Answer key"
      : "Page " + page.pageNum + " of " + state.pages.filter(function (p) { return p.type === "sheet"; }).length;
    els.prev.disabled = state.previewIdx === 0;
    els.next.disabled = state.previewIdx === state.pages.length - 1;
  }

  function pxPerMm() {
    if (!els.mmProbe) return 3.7795;
    var w = els.mmProbe.getBoundingClientRect().width;
    return w > 0 ? w / 100 : 3.7795;
  }

  function applyZoom() {
    var paper = $("omrPaper");
    if (!paper || !els.scaler || !els.viewport) return;
    var page = state.pages[state.previewIdx];
    if (!page) return;

    var ppm = pxPerMm();
    var naturalW = page.w * ppm;
    var naturalH = page.h * ppm;
    var pad = 16;
    var availW = Math.max(120, els.viewport.clientWidth - pad);
    /* Match worksheet generator: fit to column width so the sheet stays readable.
       The viewport grows vertically to show the full page at that scale. */
    var fit = Math.min(1.5, availW / naturalW);
    var scale = state.zoom === 0 ? fit : state.zoom;
    scale = clamp(scale, 0.2, 2.5);

    els.stage.style.width = page.w + "mm";
    els.stage.style.height = page.h + "mm";
    els.stage.style.transform = "scale(" + scale + ")";
    els.stage.style.transformOrigin = "top left";
    els.scaler.style.width = (naturalW * scale) + "px";
    els.scaler.style.height = (naturalH * scale) + "px";

    var panX = els.viewport.scrollWidth > els.viewport.clientWidth + 2;
    var panY = els.viewport.scrollHeight > els.viewport.clientHeight + 2;
    els.viewport.classList.toggle("is-pannable", panX || panY);

    state.currentScale = scale;
    els.zoomLabel.textContent = state.zoom === 0 ? "Fit" : Math.round(scale * 100) + "%";
  }

  function renderThumbnails() {
    if (!els.thumbs) return;
    if (state.pages.length < 2) { els.thumbs.innerHTML = ""; els.thumbs.hidden = true; return; }
    els.thumbs.hidden = false;
    els.thumbs.innerHTML = state.pages.map(function (p, i) {
      var name = p.type === "answerkey" ? "Key" : "P" + p.pageNum;
      return '<button type="button" class="omr-thumb" data-page="' + i + '"' +
        (i === state.previewIdx ? ' aria-current="true"' : "") +
        ' aria-label="Show ' + (p.type === "answerkey" ? "answer key page" : "page " + p.pageNum) + '">' +
        name + "</button>";
    }).join("");
  }

  function updateSummary(s, layout) {
    var sheets = layout.sheetCount;
    var total = sheets + (s.showAnswerKey ? 1 : 0);
    var dim = pageDims(s);
    var set = function (id, val) { var e = $(id); if (e) e.textContent = val; };

    set("omrSumQuestions", s.questionCount);
    set("omrSumOptions", s.optionsCount);
    set("omrSumPages", sheets);
    set("omrSumLayout", layout.plan.cols + (layout.plan.cols === 1 ? " column" : " columns"));
    set("omrSumPaper", (PAGE_SIZES[s.pageSize] || PAGE_SIZES.a4).label + " " +
      (s.orientation === "landscape" ? "Landscape" : "Portrait"));
    set("omrSumSize", Math.round(dim.w) + " × " + Math.round(dim.h) + " mm");

    els.status.textContent = "✓ Ready to print — " + total + " page" + (total === 1 ? "" : "s");
    els.status.className = "omr-status is-ready";
  }

  function renderWarnings(list) {
    if (!els.warnings) return;
    if (!list.length) { els.warnings.innerHTML = ""; els.warnings.hidden = true; return; }
    els.warnings.hidden = false;
    els.warnings.innerHTML = list.map(function (w) {
      return '<li class="omr-warn is-' + w.tone + '">' + esc(w.text) + "</li>";
    }).join("");
  }

  /* ==========================================================================
     ANSWER KEY UI
     ========================================================================== */

  function buildAnswerKeyUI() {
    var panel = els.answerKeyPanel;
    if (!panel) return;
    var on = $("omrShowAnswerKey") && $("omrShowAnswerKey").checked;
    panel.hidden = !on;
    if (!on) return;

    var s = getSettings();
    var labels = parseLabels(s.optionLabels, s.optionsCount);
    var rows = [];
    for (var i = 0; i < s.questionCount; i++) {
      var q = s.startQuestion + i;
      var opts = labels.map(function (l) {
        var sel = state.answerKey[q] === l;
        return '<button type="button" class="omr-key-opt" data-q="' + q + '" data-a="' + esc(l) + '"' +
          (sel ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">" + esc(l) + "</button>";
      }).join("");
      rows.push('<div class="omr-key-row"><span class="omr-key-q">' + q + "</span>" + opts + "</div>");
    }
    panel.innerHTML =
      '<div class="omr-key-tools">' +
        '<button type="button" class="omr-mini" id="omrKeyClear">Clear all</button>' +
        '<span class="omr-key-count" id="omrKeyCount"></span>' +
      "</div>" +
      '<div class="omr-key-grid">' + rows.join("") + "</div>";
    updateKeyCount(s);
  }

  function updateKeyCount(s) {
    var el = $("omrKeyCount");
    if (!el) return;
    var n = 0;
    for (var i = 0; i < s.questionCount; i++) if (state.answerKey[s.startQuestion + i]) n++;
    el.textContent = n + " of " + s.questionCount + " set";
  }

  /* ==========================================================================
     EXPORT
     ========================================================================== */

  function downloadPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast("PDF library did not load — check your connection."); return; }
    if (!validate()) { toast("Fix the highlighted fields first."); return; }

    var s = getSettings();
    var layout = computeLayout(s);
    var dim = pageDims(s);
    var JsPDF = window.jspdf.jsPDF;
    var doc = new JsPDF({
      orientation: s.orientation === "landscape" ? "landscape" : "portrait",
      unit: "mm",
      format: [dim.w, dim.h]
    });

    var sheets = layout.pages.filter(function (p) { return p.type === "sheet"; });
    var keys = layout.pages.filter(function (p) { return p.type === "answerkey"; });
    var first = true;

    for (var copy = 0; copy < s.copies; copy++) {
      for (var i = 0; i < sheets.length; i++) {
        if (!first) doc.addPage([dim.w, dim.h], s.orientation === "landscape" ? "landscape" : "portrait");
        first = false;
        var page = sheets[i];
        if (s.copies > 1) {
          page = { ops: page.ops.concat([
            opText(dim.w - MARGINS.right, MARGINS.top - 3.5, "Copy " + (copy + 1) + " of " + s.copies,
              2.4, { align: "right", color: "#444" })
          ]), w: page.w, h: page.h, pageNum: page.pageNum, type: page.type };
        }
        renderPDF(doc, page);
      }
    }
    keys.forEach(function (p) {
      doc.addPage([dim.w, dim.h], s.orientation === "landscape" ? "landscape" : "portrait");
      renderPDF(doc, p);
    });

    doc.save(fileBase(s) + ".pdf");
    toast("PDF downloaded.");
  }

  function fileBase(s) {
    var base = (s.examTitle || "omr-sheet").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    return base || "omr-sheet";
  }

  function downloadSVG() {
    var page = state.pages[state.previewIdx];
    if (!page) return;
    var svg = renderSVG(page);
    var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(URL.createObjectURL(blob), fileBase(getSettings()) + "-page" + page.pageNum + ".svg", true);
    toast("SVG downloaded.");
  }

  function downloadPNG() {
    var page = state.pages[state.previewIdx];
    if (!page) return;
    var scale = 4;                                    // ~300 dpi at A4
    var svg = renderSVG(page);
    var img = new Image();
    var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(page.w * scale);
      canvas.height = Math.round(page.h * scale);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (b) {
        triggerDownload(URL.createObjectURL(b), fileBase(getSettings()) + "-page" + page.pageNum + ".png", true);
        toast("PNG downloaded.");
      }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast("Could not render PNG."); };
    img.src = url;
  }

  function triggerDownload(href, name, revoke) {
    var a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 1500);
  }

  /** Print uses the same SVG, one page per sheet, sized by @page. */
  function printSheet() {
    var s = getSettings();
    var layout = computeLayout(s);
    var host = $("omrPrintRoot");
    if (!host) return;

    var dim = pageDims(s);
    var style = document.getElementById("omrPrintPageRule");
    if (!style) {
      style = document.createElement("style");
      style.id = "omrPrintPageRule";
      document.head.appendChild(style);
    }
    style.textContent = "@page { size: " + dim.w + "mm " + dim.h + "mm; margin: 0; }";

    host.innerHTML = layout.pages.map(function (p) {
      return '<div class="omr-print-page">' + renderSVG(p) + "</div>";
    }).join("");

    window.print();
  }

  /* ==========================================================================
     PERSISTENCE
     ========================================================================== */

  var autoSave = debounce(function (s) {
    try {
      var copy = Object.assign({}, s);
      delete copy.logo;                       // images can blow past the quota
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
      if (els.savedStatus) els.savedStatus.textContent = "Settings saved on this device";
    } catch (e) { /* private mode / quota */ }
  }, 600);

  function loadSaved(showToast) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { if (showToast) toast("No saved settings found."); return false; }
      applySettings(JSON.parse(raw));
      render();
      if (showToast) toast("Saved settings restored.");
      return true;
    } catch (e) {
      if (showToast) toast("Saved settings could not be read.");
      return false;
    }
  }

  function exportJson() {
    var s = getSettings();
    delete s.logo;
    var blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    triggerDownload(URL.createObjectURL(blob), fileBase(s) + "-settings.json", true);
    toast("Settings exported.");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applySettings(JSON.parse(String(reader.result)));
        render();
        toast("Settings imported.");
      } catch (e) { toast("That file is not valid settings JSON."); }
    };
    reader.onerror = function () { toast("Could not read that file."); };
    reader.readAsText(file);
  }

  function resetAll() {
    state.answerKey = {};
    removeLogo();
    applySettings(DEFAULTS);
    state.previewIdx = 0;
    state.zoom = 0;
    render();
    toast("Reset to defaults.");
  }

  /* ==========================================================================
     LOGO  (client-side only)
     ========================================================================== */

  function handleLogo(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { toast("Logo must be under 2 MB."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        state.logo = { dataUrl: String(reader.result), w: img.naturalWidth, h: img.naturalHeight };
        showLogoPreview();
        render();
      };
      img.onerror = function () { toast("That image could not be read."); };
      img.src = String(reader.result);
    };
    reader.onerror = function () { toast("That image could not be read."); };
    reader.readAsDataURL(file);
  }

  function showLogoPreview() {
    if (!els.logoPreview) return;
    if (state.logo && state.logo.dataUrl) {
      els.logoPreview.innerHTML = '<img src="' + state.logo.dataUrl + '" alt="Selected logo preview" />';
      els.logoPreview.hidden = false;
      if (els.logoRemove) els.logoRemove.hidden = false;
    } else {
      els.logoPreview.innerHTML = "";
      els.logoPreview.hidden = true;
      if (els.logoRemove) els.logoRemove.hidden = true;
    }
  }

  function removeLogo() {
    state.logo = null;
    if (els.logoInput) els.logoInput.value = "";
    showLogoPreview();
  }

  /* ==========================================================================
     PRESETS
     ========================================================================== */

  function renderPresets() {
    if (!els.presets) return;
    els.presets.innerHTML = Object.keys(PRESETS).map(function (k) {
      return '<button type="button" class="omr-preset" data-preset="' + k + '">' +
        esc(PRESETS[k].label) + "</button>";
    }).join("");
  }

  function applyPreset(key) {
    var p = PRESETS[key];
    if (!p) return;
    var merged = Object.assign({}, getSettings(), p);
    delete merged.label;
    merged.autoLayout = false;            // a preset states its own column count
    applySettings(merged);
    render();
    toast(p.label + " applied.");
  }

  function syncColumnsDisabled() {
    var auto = $("omrAutoLayout");
    var cols = $("omrColumns");
    if (!auto || !cols) return;
    cols.disabled = auto.checked;
    var wrap = cols.closest(".omr-field");
    if (wrap) wrap.classList.toggle("is-disabled", auto.checked);
  }

  /* ==========================================================================
     EVENTS
     ========================================================================== */

  function bindEvents() {
    var live = debounce(render, 140);

    /* every control re-renders the preview */
    document.querySelectorAll("[data-omr-input]").forEach(function (el) {
      var evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
      el.addEventListener(evt, function () {
        if (el.id === "omrAutoLayout") syncColumnsDisabled();
        if (el.id === "omrShowAnswerKey" || el.id === "omrQuestionCount" ||
            el.id === "omrOptionsCount" || el.id === "omrStartQuestion" || el.id === "omrOptionLabels") {
          buildAnswerKeyUI();
        }
        if (el.id === "omrScannerMode") reflectScannerMode();
        live();
      });
    });

    /* question-count quick presets */
    document.querySelectorAll("[data-qcount]").forEach(function (b) {
      b.addEventListener("click", function () {
        $("omrQuestionCount").value = b.dataset.qcount;
        buildAnswerKeyUI();
        render();
      });
    });

    els.presets.addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset]");
      if (b) applyPreset(b.dataset.preset);
    });

    /* preview navigation */
    els.prev.addEventListener("click", function () {
      if (state.previewIdx > 0) { state.previewIdx--; drawPreview(); renderThumbnails(); }
    });
    els.next.addEventListener("click", function () {
      if (state.previewIdx < state.pages.length - 1) { state.previewIdx++; drawPreview(); renderThumbnails(); }
    });
    els.thumbs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-page]");
      if (b) { state.previewIdx = +b.dataset.page; drawPreview(); renderThumbnails(); }
    });

    /* zoom */
    $("omrZoomIn").addEventListener("click", function () { stepZoom(1.25); });
    $("omrZoomOut").addEventListener("click", function () { stepZoom(0.8); });
    $("omrZoomFit").addEventListener("click", function () { state.zoom = 0; applyZoom(); });

    /* actions */
    $("omrDownloadPdf").addEventListener("click", downloadPdf);
    $("omrPrint").addEventListener("click", printSheet);
    $("omrDownloadPng").addEventListener("click", downloadPNG);
    $("omrDownloadSvg").addEventListener("click", downloadSVG);
    $("omrReset").addEventListener("click", resetAll);

    $("omrSaveLocal").addEventListener("click", function () { autoSave(getSettings()); toast("Settings saved."); });
    $("omrLoadLocal").addEventListener("click", function () { loadSaved(true); });
    $("omrExportJson").addEventListener("click", exportJson);
    $("omrImportJson").addEventListener("click", function () { els.importFile.click(); });
    els.importFile.addEventListener("change", function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = "";
    });

    /* logo */
    if (els.logoInput) {
      els.logoInput.addEventListener("change", function () {
        if (this.files && this.files[0]) handleLogo(this.files[0]);
      });
    }
    if (els.logoRemove) els.logoRemove.addEventListener("click", function () { removeLogo(); render(); });

    /* answer key */
    els.answerKeyPanel.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-a]");
      if (opt) {
        var q = +opt.dataset.q;
        state.answerKey[q] = state.answerKey[q] === opt.dataset.a ? undefined : opt.dataset.a;
        if (!state.answerKey[q]) delete state.answerKey[q];
        buildAnswerKeyUI();
        render();
        return;
      }
      if (e.target.id === "omrKeyClear") {
        state.answerKey = {};
        buildAnswerKeyUI();
        render();
      }
    });

    /* accordion sections */
    document.querySelectorAll("[data-omr-acc]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        var body = document.getElementById(btn.getAttribute("aria-controls"));
        if (body) body.hidden = open;
      });
    });

    window.addEventListener("resize", debounce(function () {
      if (state.zoom === 0) applyZoom();
    }, 150));

    if (els.viewport && window.ResizeObserver) {
      new ResizeObserver(function () {
        if (state.zoom === 0) applyZoom();
      }).observe(els.viewport);
    }

    if (els.viewport) {
      var panDown = false, panSx = 0, panSy = 0, panSl = 0, panSt = 0;
      els.viewport.addEventListener("pointerdown", function (e) {
        if (e.target.closest("button, a, input, select")) return;
        if (els.viewport.scrollWidth <= els.viewport.clientWidth + 2 &&
            els.viewport.scrollHeight <= els.viewport.clientHeight + 2) return;
        panDown = true;
        panSx = e.clientX; panSy = e.clientY;
        panSl = els.viewport.scrollLeft; panSt = els.viewport.scrollTop;
        els.viewport.classList.add("is-grabbing");
      });
      window.addEventListener("pointermove", function (e) {
        if (!panDown) return;
        els.viewport.scrollLeft = panSl - (e.clientX - panSx);
        els.viewport.scrollTop = panSt - (e.clientY - panSy);
      });
      window.addEventListener("pointerup", function () {
        panDown = false;
        els.viewport.classList.remove("is-grabbing");
      });
    }
    window.addEventListener("afterprint", function () {
      var host = $("omrPrintRoot");
      if (host) host.innerHTML = "";
    });
  }

  function stepZoom(factor) {
    if (!state.pages[state.previewIdx]) return;
    var base = state.zoom === 0 ? (state.currentScale || 1) : state.zoom;
    state.zoom = clamp(base * factor, 0.2, 2.5);
    applyZoom();
  }

  function reflectScannerMode() {
    var on = $("omrScannerMode") && $("omrScannerMode").checked;
    ["omrBubbleStyle", "omrShowPhoto"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.disabled = on;
      var w = el.closest(".omr-field") || el.closest(".omr-check");
      if (w) w.classList.toggle("is-disabled", on);
    });
  }

  /* ==========================================================================
     INIT
     ========================================================================== */

  function cacheDom() {
    els.stage = $("omrPreviewStage");
    els.viewport = $("omrViewport");
    els.scaler = $("omrScaler");
    els.pageMeta = $("omrPageMeta");
    els.prev = $("omrPrev");
    els.next = $("omrNext");
    els.thumbs = $("omrThumbs");
    els.presets = $("omrPresets");
    els.answerKeyPanel = $("omrAnswerKeyPanel");
    els.toast = $("omrToast");
    els.savedStatus = $("omrSavedStatus");
    els.importFile = $("omrImportFile");
    els.status = $("omrStatus");
    els.warnings = $("omrWarnings");
    els.zoomLabel = $("omrZoomLabel");
    els.logoInput = $("omrLogoInput");
    els.logoPreview = $("omrLogoPreview");
    els.logoRemove = $("omrLogoRemove");
  }

  function init() {
    if (!document.body.hasAttribute("data-omr-page")) return;
    cacheDom();
    if (!els.stage) return;

    els.mmProbe = document.createElement("div");
    els.mmProbe.setAttribute("aria-hidden", "true");
    els.mmProbe.style.cssText = "position:absolute;width:100mm;height:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(els.mmProbe);

    renderPresets();
    applySettings(DEFAULTS);
    loadSaved(false);
    bindEvents();
    syncColumnsDisabled();
    reflectScannerMode();
    buildAnswerKeyUI();
    render();
  }

  /* exposed for the test suite */
  window.OMRGenerator = {
    computeLayout: computeLayout,
    getSettings: getSettings,
    applySettings: applySettings,
    renderSVG: renderSVG,
    paginate: paginate,
    pageDims: pageDims,
    bubbleMetrics: bubbleMetrics,
    maxColumnsThatFit: maxColumnsThatFit,
    validate: validate,
    render: render,
    state: state,
    PAGE_SIZES: PAGE_SIZES,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
