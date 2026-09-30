/* ToolAdda — Markdown to Notion Converter engine.
   Pure parsing/mapping logic (no DOM) lives in MarkdownToNotion so it can be
   reasoned about independently of the UI. Runs entirely client-side — nothing
   here ever makes a network request.

   Pipeline: Markdown text -> intermediate block AST -> either
     (a) Notion Block API JSON (toNotionBlocks), or
     (b) live-preview HTML (toHtml)
   so both outputs stay in sync from a single parse. */
(function (global) {
  'use strict';

  // ---------- small utilities ----------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    return /^(https?:|mailto:|tel:|#|\/|data:image\/)/i.test(url || '') ? url : '#';
  }

  function uuidStub() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function chunkText(str, max) {
    if (str.length <= max) return [str];
    const chunks = [];
    for (let i = 0; i < str.length; i += max) chunks.push(str.slice(i, i + max));
    return chunks;
  }

  // ---------- inline parsing: markdown text -> formatted "runs" ----------
  // Each run: { text?, equation?, bold?, italic?, strike?, code?, href? }

  function parseInlineToRuns(text) {
    const runs = [];
    let buf = '';
    let i = 0;
    const n = text.length;

    function flush() {
      if (buf) { runs.push({ text: buf }); buf = ''; }
    }

    while (i < n) {
      const ch = text[i];

      // inline code span — literal, highest precedence
      if (ch === '`') {
        const close = text.indexOf('`', i + 1);
        if (close !== -1) {
          flush();
          runs.push({ text: text.slice(i + 1, close), code: true });
          i = close + 1;
          continue;
        }
      }

      // inline equation $...$  (not $$ block markers)
      if (ch === '$' && text[i + 1] !== '$') {
        const close = text.indexOf('$', i + 1);
        if (close !== -1 && close > i + 1) {
          flush();
          runs.push({ equation: text.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }

      // link [text](url "title")
      if (ch === '[') {
        const m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(text.slice(i));
        if (m) {
          flush();
          const inner = parseInlineToRuns(m[1]);
          inner.forEach((r) => runs.push(Object.assign({}, r, { href: m[2] })));
          i += m[0].length;
          continue;
        }
      }

      // bold+italic ***text*** or ___text___
      if (text.slice(i, i + 3) === '***' || text.slice(i, i + 3) === '___') {
        const delim = text.slice(i, i + 3);
        const close = text.indexOf(delim, i + 3);
        if (close !== -1) {
          flush();
          const inner = parseInlineToRuns(text.slice(i + 3, close));
          inner.forEach((r) => runs.push(Object.assign({}, r, { bold: true, italic: true })));
          i = close + 3;
          continue;
        }
      }

      // bold **text** or __text__
      if (text.slice(i, i + 2) === '**' || text.slice(i, i + 2) === '__') {
        const delim = text.slice(i, i + 2);
        const close = text.indexOf(delim, i + 2);
        if (close !== -1 && close > i + 2) {
          flush();
          const inner = parseInlineToRuns(text.slice(i + 2, close));
          inner.forEach((r) => runs.push(Object.assign({}, r, { bold: true })));
          i = close + 2;
          continue;
        }
      }

      // strikethrough ~~text~~
      if (text.slice(i, i + 2) === '~~') {
        const close = text.indexOf('~~', i + 2);
        if (close !== -1 && close > i + 2) {
          flush();
          const inner = parseInlineToRuns(text.slice(i + 2, close));
          inner.forEach((r) => runs.push(Object.assign({}, r, { strike: true })));
          i = close + 2;
          continue;
        }
      }

      // italic *text* or _text_ (single char, no nested marks — mirrors the
      // pragmatic single-pass approach used by the site's other Markdown tool)
      if ((ch === '*' || ch === '_') && text[i + 1] && text[i + 1] !== ' ') {
        const close = text.indexOf(ch, i + 1);
        if (close !== -1 && close > i + 1 && text[close - 1] !== ' ') {
          flush();
          runs.push({ text: text.slice(i + 1, close), italic: true });
          i = close + 1;
          continue;
        }
      }

      buf += ch;
      i += 1;
    }
    flush();
    return runs;
  }

  // ---------- block-level parsing: markdown text -> AST ----------

  const LIST_RE = /^( *)([-*+]|\d+[.)])\s+(.*)$/;
  const HR_RE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
  const FENCE_RE = /^ {0,3}```(.*)$/;
  const ALERT_TYPES = {
    NOTE: { emoji: 'ℹ️', color: 'blue_background' },
    TIP: { emoji: '💡', color: 'green_background' },
    IMPORTANT: { emoji: '❗', color: 'purple_background' },
    WARNING: { emoji: '⚠️', color: 'yellow_background' },
    CAUTION: { emoji: '🚨', color: 'red_background' },
  };

  function isBlockStart(line) {
    return /^ {0,3}#{1,6}\s/.test(line)
      || /^ {0,3}>/.test(line)
      || /^ {0,3}([-*+]|\d+[.)])\s/.test(line)
      || HR_RE.test(line)
      || FENCE_RE.test(line)
      || /^ {0,3}<details/i.test(line)
      || /^ {0,3}\$\$/.test(line);
  }

  function parseTable(lines, i) {
    const aligns = lines[i + 1].split('|').filter((c) => c.trim() !== '').map((c) => {
      c = c.trim();
      const l = c.charAt(0) === ':';
      const r = c.charAt(c.length - 1) === ':';
      return (l && r) ? 'center' : r ? 'right' : l ? 'left' : 'none';
    });
    const parseRow = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    const header = parseRow(lines[i]).map(parseInlineToRuns);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim() !== '') {
      rows.push(parseRow(lines[j]).map(parseInlineToRuns));
      j += 1;
    }
    return { block: { type: 'table', header, rows, aligns }, next: j };
  }

  function parseList(lines, start, indent) {
    const first = lines[start].match(LIST_RE);
    const ordered = /\d/.test(first[2]);
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m) break;
      const ind = m[1].length;
      if (ind !== indent) break;
      if (/\d/.test(m[2]) !== ordered) break;

      const contentLines = [m[3]];
      i += 1;
      let children = [];
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          const next = lines[i + 1];
          const leadNext = next != null ? (next.match(/^( *)/) || ['', ''])[1].length : -1;
          if (next != null && leadNext > indent) { i += 1; continue; }
          break;
        }
        const lead = (lines[i].match(/^( *)/))[1].length;
        const isItem = LIST_RE.test(lines[i]);
        if (isItem && lead > indent) {
          const sub = parseList(lines, i, lead);
          children = children.concat(sub.blocks);
          i = sub.next;
          continue;
        }
        if (isItem && lead <= indent) break;
        if (!isItem && lead > indent) {
          contentLines.push(lines[i].slice(indent + 2));
          i += 1;
          continue;
        }
        break;
      }

      const text = contentLines.join('\n').trim();
      const taskM = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);
      let block;
      if (taskM) {
        block = { type: 'to_do', checked: taskM[1].toLowerCase() === 'x', runs: parseInlineToRuns(taskM[2]), children };
      } else {
        block = { type: ordered ? 'numbered_list_item' : 'bulleted_list_item', runs: parseInlineToRuns(text), children };
      }
      items.push(block);
    }
    return { blocks: items, next: i };
  }

  function classifyBareUrl(url) {
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return 'image';
    if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return 'video';
    return 'bookmark';
  }

  function parseBlockquote(lines, start) {
    const buf = [];
    let i = start;
    while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
      buf.push(lines[i].replace(/^ {0,3}>\s?/, ''));
      i += 1;
    }
    let content = buf.join('\n');
    const alertM = /^\s*\[!(\w+)\]\s*\n?/.exec(content);
    if (alertM && ALERT_TYPES[alertM[1].toUpperCase()]) {
      const meta = ALERT_TYPES[alertM[1].toUpperCase()];
      content = content.slice(alertM[0].length);
      return {
        block: { type: 'callout', emoji: meta.emoji, color: meta.color, children: parseBlocks(content) },
        next: i,
      };
    }
    return { block: { type: 'quote', children: parseBlocks(content) }, next: i };
  }

  function parseDetails(lines, start) {
    let i = start;
    const buf = [];
    while (i < lines.length && !/^\s*<\/details>/i.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    if (i < lines.length) i += 1; // consume closing tag
    let raw = buf.join('\n');
    const summaryM = /<summary>([\s\S]*?)<\/summary>/i.exec(raw);
    const summaryText = summaryM ? summaryM[1].trim() : 'Toggle';
    raw = raw.replace(/^\s*<details[^>]*>\s*/i, '').replace(/<summary>[\s\S]*?<\/summary>/i, '');
    return {
      block: { type: 'toggle', summaryRuns: parseInlineToRuns(summaryText), children: parseBlocks(raw) },
      next: i,
    };
  }

  function parseBlocks(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { i += 1; continue; }

      if (HR_RE.test(line)) { out.push({ type: 'divider' }); i += 1; continue; }

      const fenceM = FENCE_RE.exec(line);
      if (fenceM) {
        const lang = fenceM[1].trim();
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^ {0,3}```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i += 1; }
        if (i < lines.length) i += 1;
        out.push({ type: 'code', code: codeLines.join('\n'), language: lang || 'plain text' });
        continue;
      }

      if (/^ {0,3}\$\$/.test(line)) {
        if (/\$\$.*\$\$\s*$/.test(line) && line.trim().length > 4) {
          out.push({ type: 'equation', expression: line.trim().replace(/^\$\$/, '').replace(/\$\$$/, '').trim() });
          i += 1;
          continue;
        }
        const exprLines = [];
        i += 1;
        while (i < lines.length && lines[i].trim() !== '$$') { exprLines.push(lines[i]); i += 1; }
        if (i < lines.length) i += 1;
        out.push({ type: 'equation', expression: exprLines.join('\n').trim() });
        continue;
      }

      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        out.push({ type: 'heading', level: Math.min(3, h[1].length), runs: parseInlineToRuns(h[2]) });
        i += 1;
        continue;
      }

      if (/^ {0,3}<details/i.test(line)) {
        const d = parseDetails(lines, i);
        out.push(d.block);
        i = d.next;
        continue;
      }

      if (/^ {0,3}>/.test(line)) {
        const q = parseBlockquote(lines, i);
        out.push(q.block);
        i = q.next;
        continue;
      }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length
        && /^ *\|?[ :]*-{1,}[ :]*(\|[ :]*-{1,}[ :]*)*\|? *$/.test(lines[i + 1])) {
        const t = parseTable(lines, i);
        out.push(t.block);
        i = t.next;
        continue;
      }

      if (/^ *([-*+]|\d+[.)])\s+/.test(line)) {
        const indent = (line.match(/^( *)/))[1].length;
        const l = parseList(lines, i, indent);
        out.push.apply(out, l.blocks);
        i = l.next;
        continue;
      }

      // paragraph — collect contiguous lines
      const buf = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) { buf.push(lines[i]); i += 1; }
      const text = buf.join('\n').trim();

      const soleImage = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(text);
      if (soleImage) {
        out.push({ type: 'image', url: soleImage[2], alt: soleImage[1], title: soleImage[3] || '' });
        continue;
      }
      const bareUrl = /^<?(https?:\/\/\S+?)>?$/.exec(text);
      if (bareUrl) {
        out.push({ type: classifyBareUrl(bareUrl[1]), url: bareUrl[1] });
        continue;
      }

      out.push({ type: 'paragraph', runs: parseInlineToRuns(text) });
    }
    return out;
  }

  function parseMarkdown(md) {
    return parseBlocks(String(md == null ? '' : md));
  }

  // ---------- AST -> Notion Block API JSON ----------

  function defaultAnnotations() {
    return { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  }

  function toRichText(runs) {
    const out = [];
    (runs || []).forEach((r) => {
      if (r.equation) {
        out.push({
          type: 'equation',
          equation: { expression: r.equation },
          annotations: defaultAnnotations(),
          plain_text: r.equation,
        });
        return;
      }
      if (!r.text) return;
      chunkText(r.text, 1900).forEach((chunk) => {
        out.push({
          type: 'text',
          text: { content: chunk, link: r.href ? { url: r.href } : null },
          annotations: {
            bold: !!r.bold, italic: !!r.italic, strikethrough: !!r.strike,
            underline: false, code: !!r.code, color: 'default',
          },
          plain_text: chunk,
          href: r.href || null,
        });
      });
    });
    return out;
  }

  function generateBlocks(astBlocks, opts, warnings) {
    return astBlocks.map((b) => convertBlock(b, opts, warnings)).filter(Boolean);
  }

  function withId(block, opts) {
    if (opts.includeIds) block.id = uuidStub();
    return block;
  }

  function convertBlock(b, opts, warnings) {
    switch (b.type) {
      case 'heading': {
        const key = 'heading_' + b.level;
        return withId({
          object: 'block', type: key,
          [key]: { rich_text: toRichText(b.runs), color: 'default', is_toggleable: false },
        }, opts);
      }
      case 'paragraph':
        return withId({ object: 'block', type: 'paragraph', paragraph: { rich_text: toRichText(b.runs), color: 'default' } }, opts);
      case 'divider':
        return withId({ object: 'block', type: 'divider', divider: {} }, opts);
      case 'code':
        return withId({
          object: 'block', type: 'code',
          code: { rich_text: toRichText([{ text: b.code }]), language: normalizeLanguage(b.language), caption: [] },
        }, opts);
      case 'equation':
        return withId({ object: 'block', type: 'equation', equation: { expression: b.expression } }, opts);
      case 'image':
        return withId({
          object: 'block', type: 'image',
          image: { type: 'external', external: { url: b.url }, caption: b.alt ? toRichText([{ text: b.alt }]) : [] },
        }, opts);
      case 'video':
        return withId({ object: 'block', type: 'video', video: { type: 'external', external: { url: b.url }, caption: [] } }, opts);
      case 'bookmark':
        return withId({ object: 'block', type: 'bookmark', bookmark: { url: b.url, caption: [] } }, opts);
      case 'quote':
        return withId({
          object: 'block', type: 'quote',
          quote: withChildren({ rich_text: toRichText(firstParagraphRuns(b.children)), color: 'default' }, remainderBlocks(b.children), opts, warnings),
        }, opts);
      case 'callout':
        return withId({
          object: 'block', type: 'callout',
          callout: withChildren({ rich_text: toRichText(firstParagraphRuns(b.children)), icon: { type: 'emoji', emoji: b.emoji }, color: b.color }, remainderBlocks(b.children), opts, warnings),
        }, opts);
      case 'toggle':
        return withId({
          object: 'block', type: 'toggle',
          toggle: withChildren({ rich_text: toRichText(b.summaryRuns), color: 'default' }, b.children, opts, warnings),
        }, opts);
      case 'bulleted_list_item':
      case 'numbered_list_item':
        return withId({
          object: 'block', type: b.type,
          [b.type]: withChildren({ rich_text: toRichText(b.runs), color: 'default' }, b.children, opts, warnings),
        }, opts);
      case 'to_do':
        return withId({
          object: 'block', type: 'to_do',
          to_do: withChildren({ rich_text: toRichText(b.runs), checked: !!b.checked, color: 'default' }, b.children, opts, warnings),
        }, opts);
      case 'table': {
        const width = Math.max(b.header.length, ...(b.rows.length ? b.rows.map((r) => r.length) : [0]));
        const rowBlocks = [b.header].concat(b.rows).map((row) => withId({
          object: 'block', type: 'table_row',
          table_row: { cells: padCells(row, width).map(toRichText) },
        }, opts));
        return withId({
          object: 'block', type: 'table',
          table: { table_width: width, has_column_header: true, has_row_header: false, children: rowBlocks },
        }, opts);
      }
      default:
        warnings.push(`Unsupported element "${b.type}" was skipped or simplified.`);
        return null;
    }
  }

  function padCells(row, width) {
    const cells = row.slice(0, width);
    while (cells.length < width) cells.push([]);
    return cells;
  }

  function firstParagraphRuns(children) {
    if (children && children[0] && children[0].type === 'paragraph') return children[0].runs;
    return [];
  }

  function remainderBlocks(children) {
    if (children && children[0] && children[0].type === 'paragraph') return children.slice(1);
    return children || [];
  }

  function withChildren(obj, childAst, opts, warnings) {
    if (childAst && childAst.length) obj.children = generateBlocks(childAst, opts, warnings);
    return obj;
  }

  function normalizeLanguage(lang) {
    const known = ['javascript', 'typescript', 'python', 'java', 'c', 'c++', 'c#', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'sql', 'json', 'yaml', 'html', 'css', 'shell', 'bash', 'markdown', 'plain text'];
    const l = (lang || '').toLowerCase();
    const map = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', yml: 'yaml', 'c++': 'c++', cpp: 'c++', 'c#': 'c#', cs: 'c#' };
    const norm = map[l] || l;
    return known.includes(norm) ? norm : (norm || 'plain text');
  }

  function toNotionBlocks(astBlocks, userOptions) {
    const opts = Object.assign({ includeIds: false }, userOptions || {});
    const warnings = [];
    const blocks = generateBlocks(astBlocks, opts, warnings);
    return { blocks, warnings };
  }

  // ---------- AST -> live preview HTML ----------

  function runsToHtml(runs) {
    return (runs || []).map((r) => {
      if (r.equation) return '<code class="mtn-eq">' + escapeHtml(r.equation) + '</code>';
      let t = escapeHtml(r.text || '');
      if (r.code) t = '<code>' + t + '</code>';
      if (r.bold) t = '<strong>' + t + '</strong>';
      if (r.italic) t = '<em>' + t + '</em>';
      if (r.strike) t = '<del>' + t + '</del>';
      if (r.href) t = '<a href="' + safeUrl(r.href) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
      return t;
    }).join('');
  }

  function blocksToHtml(blocks) {
    let html = '';
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
        const tag = b.type === 'numbered_list_item' ? 'ol' : 'ul';
        let items = '';
        while (i < blocks.length && blocks[i].type === b.type) {
          items += '<li>' + runsToHtml(blocks[i].runs) + (blocks[i].children && blocks[i].children.length ? blocksToHtml(blocks[i].children) : '') + '</li>';
          i += 1;
        }
        html += '<' + tag + '>' + items + '</' + tag + '>';
        continue;
      }
      if (b.type === 'to_do') {
        let items = '';
        while (i < blocks.length && blocks[i].type === 'to_do') {
          const cur = blocks[i];
          items += '<li class="mtn-todo"><input type="checkbox" disabled' + (cur.checked ? ' checked' : '') + '> ' + runsToHtml(cur.runs) + '</li>';
          i += 1;
        }
        html += '<ul class="mtn-todo-list">' + items + '</ul>';
        continue;
      }
      html += renderSingleBlockHtml(b);
      i += 1;
    }
    return html;
  }

  function renderSingleBlockHtml(b) {
    switch (b.type) {
      case 'heading': return '<h' + (b.level + 1) + '>' + runsToHtml(b.runs) + '</h' + (b.level + 1) + '>';
      case 'paragraph': return '<p>' + runsToHtml(b.runs) + '</p>';
      case 'divider': return '<hr>';
      case 'code': return '<pre><code>' + escapeHtml(b.code) + '</code></pre>';
      case 'equation': return '<pre class="mtn-eq-block">' + escapeHtml(b.expression) + '</pre>';
      case 'image': return '<figure><img src="' + safeUrl(b.url) + '" alt="' + escapeHtml(b.alt || '') + '" loading="lazy">' + (b.alt ? '<figcaption>' + escapeHtml(b.alt) + '</figcaption>' : '') + '</figure>';
      case 'video': return '<div class="mtn-embed">🎬 Video: <a href="' + safeUrl(b.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(b.url) + '</a></div>';
      case 'bookmark': return '<div class="mtn-embed">🔖 Bookmark: <a href="' + safeUrl(b.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(b.url) + '</a></div>';
      case 'quote': return '<blockquote>' + blocksToHtml(b.children) + '</blockquote>';
      case 'callout': return '<div class="mtn-callout"><span class="mtn-callout-icon">' + b.emoji + '</span><div>' + blocksToHtml(b.children) + '</div></div>';
      case 'toggle': return '<details><summary>' + runsToHtml(b.summaryRuns) + '</summary>' + blocksToHtml(b.children) + '</details>';
      case 'table': {
        const head = '<tr>' + b.header.map((r) => '<th>' + runsToHtml(r) + '</th>').join('') + '</tr>';
        const body = b.rows.map((row) => '<tr>' + row.map((r) => '<td>' + runsToHtml(r) + '</td>').join('') + '</tr>').join('');
        return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
      }
      default: return '';
    }
  }

  function toHtml(blocks) {
    return blocksToHtml(blocks);
  }

  // ---------- JSON syntax highlighter for the output preview ----------

  function highlightJson(json) {
    const escaped = escapeHtml(json);
    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
        else if (/true|false/.test(match)) cls = 'json-boolean';
        else if (/null/.test(match)) cls = 'json-null';
        return '<span class="' + cls + '">' + match + '</span>';
      },
    );
  }

  // ---------- stats ----------

  function countBlocksDeep(blocks) {
    let count = 0;
    (blocks || []).forEach((b) => {
      count += 1;
      const payload = b && b.type && b[b.type];
      if (payload && payload.children) count += countBlocksDeep(payload.children);
    });
    return count;
  }

  global.MarkdownToNotion = {
    parseMarkdown,
    toNotionBlocks,
    toHtml,
    highlightJson,
    escapeHtml,
    countBlocksDeep,
  };
})(window);
