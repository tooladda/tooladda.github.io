/*!
 * ToolAdda — Markdown engine
 * -----------------------------------------------------------------------------
 * A dependency-free GitHub-Flavored Markdown renderer that is safe to feed into
 * innerHTML.
 *
 * SECURITY MODEL
 *   1. Raw HTML in the source is ESCAPED, never passed through. A preview can
 *      therefore not execute markup the author pasted in.
 *   2. Every attribute value is built from already-escaped text, so quotes can
 *      never break out of an attribute.
 *   3. Link and image destinations go through an allow-list of URL schemes.
 *      data: is permitted only for raster images — never for SVG, which can
 *      carry script.
 *
 * Exposes window.ToolAddaMarkdown.render(md) -> { html, outline, stats }
 */
(function (global) {
  'use strict';

  /* =========================================================================
   * Escaping and URL safety
   * ====================================================================== */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var SAFE_SCHEMES = { http: 1, https: 1, mailto: 1, tel: 1, ftp: 1 };
  var DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

  /** Undoes the HTML escaping plus numeric character references. */
  function decodeEntities(value) {
    return String(value)
      .replace(/&amp;/gi, '&')
      .replace(/&#(\d+);/g, function (match, dec) { return String.fromCharCode(Number(dec)); })
      .replace(/&#x([0-9a-f]+);/gi, function (match, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  }

  /** 'ok' = allow-listed scheme, 'relative' = no scheme, 'bad' = reject. */
  function schemeVerdict(url) {
    var colon = url.indexOf(':');
    var pathStart = url.search(/[/?#]/);
    if (colon === -1 || (pathStart !== -1 && pathStart < colon)) { return 'relative'; }

    var prefix = url.slice(0, colon);
    // A malformed scheme (entities, spaces, punctuation) is never trusted.
    if (!/^[a-z][a-z0-9+.\-]*$/i.test(prefix)) { return 'bad'; }

    var name = prefix.toLowerCase();
    if (SAFE_SCHEMES[name] === 1) { return 'ok'; }
    // Raster images only. SVG is excluded on purpose: it can contain script.
    if (name === 'data' && DATA_IMAGE_RE.test(url)) { return 'ok'; }
    return 'bad';
  }

  /**
   * Allow-list, not a block-list: anything with an unrecognised scheme becomes
   * "#". Schemeless (relative, anchor) destinations pass through.
   */
  function safeUrl(raw) {
    var url = String(raw == null ? '' : raw).trim();
    if (!url) { return '#'; }
    // Strip control characters that could smuggle a scheme past the test.
    url = url.replace(/[\u0000-\u001F\u007F]/g, '');

    // The literal form and the entity-decoded form must BOTH be acceptable, so
    // an obfuscated scheme such as "java&#115;cript:" cannot slip through by
    // looking like a relative path with a fragment.
    if (schemeVerdict(url) === 'bad') { return '#'; }
    if (schemeVerdict(decodeEntities(url)) === 'bad') { return '#'; }
    return url;
  }

  /** Markdown syntax stripped down to readable text, for slugs and outlines. */
  function plainText(text) {
    return String(text)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<([^>]*)>/g, '$1')
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(text) {
    return plainText(text)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  }

  /* =========================================================================
   * Renderer
   * ====================================================================== */

  // Private-use code points, so a sentinel can never collide with real text.
  var SPAN_A = String.fromCharCode(0xE000);
  var SPAN_B = String.fromCharCode(0xE001);
  var BLOCK_A = String.fromCharCode(0xE002);
  var BLOCK_B = String.fromCharCode(0xE003);
  var BLOCK_RE = new RegExp('^' + BLOCK_A + '\\d+' + BLOCK_B + '$');

  var ALERTS = {
    NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important',
    WARNING: 'Warning', CAUTION: 'Caution'
  };

  function createRenderer(options) {
    var opts = options || {};
    // Defaults match what a live preview wants. The converter turns them off to
    // emit clean, paste-ready HTML.
    var headingIds = opts.headingIds !== false;
    var linkTarget = opts.linkTarget === undefined ? '_blank' : opts.linkTarget;
    var lazyImages = opts.lazyImages !== false;
    var tableWrapper = opts.tableWrapper !== false;
    var linkAttrs = linkTarget ? ' target="' + escapeHtml(linkTarget) + '" rel="noopener noreferrer nofollow ugc"' : '';

    var codeBlocks = [];
    var refs = Object.create(null);
    var outline = [];
    var slugCounts = Object.create(null);
    var stats = {
      headings: 0, links: 0, images: 0, codeBlocks: 0,
      tables: 0, tasksTotal: 0, tasksDone: 0, blockquotes: 0, lists: 0
    };

    function uniqueSlug(text) {
      var base = slugify(text);
      if (slugCounts[base] === undefined) {
        slugCounts[base] = 0;
        return base;
      }
      slugCounts[base] += 1;
      return base + '-' + slugCounts[base];
    }

    /* ---- inline ---------------------------------------------------------- */

    function inline(text) {
      var spans = [];

      // 1. Pull code spans out first — nothing inside them is markup.
      var out = String(text).replace(/(`+)([\s\S]*?)\1/g, function (match, ticks, code) {
        spans.push('<code>' + escapeHtml(code.replace(/^ | $/g, '')) + '</code>');
        return SPAN_A + (spans.length - 1) + SPAN_B;
      });

      // 2. Escape everything else BEFORE any tag is constructed.
      out = escapeHtml(out);

      // 3. Images, then links (image syntax is a superset, so order matters).
      out = out.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
        function (match, alt, url, title) {
          stats.images += 1;
          return '<img src="' + safeUrl(url) + '" alt="' + alt + '"' +
            (title ? ' title="' + title + '"' : '') + (lazyImages ? ' loading="lazy"' : '') + ' />';
        });

      out = out.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
        function (match, label, url, title) {
          stats.links += 1;
          return '<a href="' + safeUrl(url) + '"' + (title ? ' title="' + title + '"' : '') +
            linkAttrs + '>' + label + '</a>';
        });

      // Reference links: [label][id] and the shorthand [label][]
      out = out.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, function (match, label, id) {
        var key = (id || label).toLowerCase();
        var ref = refs[key];
        if (!ref) { return match; }
        stats.links += 1;
        return '<a href="' + safeUrl(ref.url) + '"' + (ref.title ? ' title="' + escapeHtml(ref.title) + '"' : '') +
          linkAttrs + '>' + label + '</a>';
      });

      // Autolinks: <https://…> and bare http(s) URLs.
      out = out.replace(/&lt;(https?:\/\/[^\s&<>]+)&gt;/g, function (match, url) {
        stats.links += 1;
        return '<a href="' + safeUrl(url) + '"' + linkAttrs + '>' + url + '</a>';
      });
      out = out.replace(/(^|[\s(])(https?:\/\/[^\s<>&)]+)/g, function (match, lead, url) {
        stats.links += 1;
        return lead + '<a href="' + safeUrl(url) + '"' + linkAttrs + '>' + url + '</a>';
      });
      out = out.replace(/&lt;([^\s@&<>]+@[^\s@&<>]+\.[a-z]{2,})&gt;/gi, function (match, mail) {
        stats.links += 1;
        return '<a href="mailto:' + mail + '">' + mail + '</a>';
      });

      // 4. Emphasis. Bold-italic first so its markers are consumed.
      out = out
        .replace(/\*\*\*([^*\s][\s\S]*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/___([^_\s][\s\S]*?)___/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*\s][\s\S]*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\s][\s\S]*?)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][\s\S]*?)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s][\s\S]*?)_/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/==([^=]+)==/g, '<mark>$1</mark>');

      // 5. Hard line breaks: two trailing spaces, or a trailing backslash.
      out = out.replace(/ {2,}\n/g, '<br />\n').replace(/\\\n/g, '<br />\n');

      // 6. Put the code spans back.
      return out.replace(new RegExp(SPAN_A + '(\\d+)' + SPAN_B, 'g'), function (match, index) {
        return spans[Number(index)];
      });
    }

    /* ---- block-level helpers -------------------------------------------- */

    var LIST_RE = /^( *)([-*+]|\d+[.)])\s+([\s\S]*)$/;
    var HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
    var HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
    var TABLE_SEP_RE = /^ *\|?[ :]*-{1,}[ :]*(\|[ :]*-{1,}[ :]*)*\|? *$/;

    function isBlockStart(line) {
      return HEADING_RE.test(line) || HR_RE.test(line) ||
        /^ {0,3}>/.test(line) || /^ {0,3}([-*+]|\d+[.)])\s/.test(line) ||
        BLOCK_RE.test(line.trim());
    }

    function parseTable(lines, index) {
      stats.tables += 1;
      var aligns = lines[index + 1].split('|')
        .filter(function (cell) { return cell.trim() !== ''; })
        .map(function (cell) {
          cell = cell.trim();
          var left = cell.charAt(0) === ':';
          var right = cell.charAt(cell.length - 1) === ':';
          if (left && right) { return 'center'; }
          if (right) { return 'right'; }
          if (left) { return 'left'; }
          return '';
        });

      function cells(row) {
        return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
          .split('|').map(function (cell) { return cell.trim(); });
      }

      function align(i) { return aligns[i] ? ' style="text-align:' + aligns[i] + '"' : ''; }

      var html = (tableWrapper ? '<div class="md-tablewrap">' : '') + '<table><thead><tr>' +
        cells(lines[index]).map(function (cell, i) {
          return '<th' + align(i) + '>' + inline(cell) + '</th>';
        }).join('') + '</tr></thead><tbody>';

      var i = index + 2;
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim() !== '') {
        html += '<tr>' + cells(lines[i]).map(function (cell, c) {
          return '<td' + align(c) + '>' + inline(cell) + '</td>';
        }).join('') + '</tr>';
        i += 1;
      }
      return { html: html + '</tbody></table>' + (tableWrapper ? '</div>' : ''), next: i };
    }

    function parseList(lines, start, indent) {
      var first = lines[start].match(LIST_RE);
      var ordered = /\d/.test(first[2]);
      var startAt = ordered ? parseInt(first[2], 10) : 1;
      var hasTask = false;
      var items = [];
      var i = start;

      while (i < lines.length) {
        var match = lines[i].match(LIST_RE);
        if (!match) { break; }
        if (match[1].length !== indent) { break; }
        if (/\d/.test(match[2]) !== ordered) { break; }

        var content = [match[3]];
        var nested = '';
        i += 1;

        while (i < lines.length) {
          if (lines[i].trim() === '') { content.push(''); i += 1; continue; }
          var lead = lines[i].match(/^( *)/)[1].length;
          var isItem = LIST_RE.test(lines[i]);
          if (isItem && lead > indent) {
            var sub = parseList(lines, i, lead);
            nested += sub.html;
            i = sub.next;
            continue;
          }
          if (isItem) { break; }
          if (lead > indent) { content.push(lines[i].slice(indent + 2)); i += 1; continue; }
          break;
        }

        while (content.length && content[content.length - 1] === '') { content.pop(); }
        var text = content.join('\n').trim();
        var task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);

        if (task) {
          hasTask = true;
          stats.tasksTotal += 1;
          var done = task[1].toLowerCase() === 'x';
          if (done) { stats.tasksDone += 1; }
          var taskBody = task[2].indexOf('\n') >= 0 ? parseBlocks(task[2]) : inline(task[2]);
          items.push('<li class="md-task' + (done ? ' is-done' : '') + '">' +
            '<input type="checkbox" disabled' + (done ? ' checked' : '') + ' /> ' +
            taskBody + nested + '</li>');
        } else {
          var body = text.indexOf('\n') >= 0 ? parseBlocks(text) : inline(text);
          items.push('<li>' + body + nested + '</li>');
        }
      }

      stats.lists += 1;
      var tag = ordered ? 'ol' : 'ul';
      var attrs = hasTask ? ' class="md-tasklist"' : '';
      if (ordered && startAt !== 1) { attrs += ' start="' + startAt + '"'; }
      return { html: '<' + tag + attrs + '>' + items.join('') + '</' + tag + '>', next: i };
    }

    function parseQuote(lines, index) {
      var buffer = [];
      var i = index;
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        buffer.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      stats.blockquotes += 1;

      // GitHub alert syntax: > [!NOTE] and friends.
      var alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(buffer[0] || '');
      if (alert) {
        var kind = alert[1].toUpperCase();
        buffer[0] = buffer[0].slice(alert[0].length);
        if (buffer[0].trim() === '') { buffer.shift(); }
        return {
          html: '<blockquote class="md-alert md-alert--' + kind.toLowerCase() + '">' +
            '<p class="md-alert__label">' + ALERTS[kind] + '</p>' +
            parseBlocks(buffer.join('\n')) + '</blockquote>',
          next: i
        };
      }
      return { html: '<blockquote>' + parseBlocks(buffer.join('\n')) + '</blockquote>', next: i };
    }

    function heading(level, rawText) {
      stats.headings += 1;
      var label = plainText(rawText);
      var id = uniqueSlug(rawText);
      outline.push({ level: level, text: label, id: id });
      return '<h' + level + (headingIds ? ' id="' + escapeHtml(id) + '"' : '') + '>' + inline(rawText) + '</h' + level + '>';
    }

    function parseBlocks(markdown) {
      var lines = String(markdown).split('\n');
      var out = [];
      var i = 0;

      while (i < lines.length) {
        var line = lines[i];

        if (line.trim() === '') { i += 1; continue; }
        if (BLOCK_RE.test(line.trim())) { out.push(line.trim()); i += 1; continue; }
        if (HR_RE.test(line)) { out.push('<hr />'); i += 1; continue; }

        var atx = line.match(HEADING_RE);
        if (atx) { out.push(heading(atx[1].length, atx[2])); i += 1; continue; }

        // Setext headings: text underlined with === or ---
        if (i + 1 < lines.length && line.trim() !== '' && !isBlockStart(line) &&
            /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1]) && lines[i + 1].trim().length >= 2) {
          out.push(heading(lines[i + 1].indexOf('=') >= 0 ? 1 : 2, line.trim()));
          i += 2;
          continue;
        }

        if (/^ {0,3}>/.test(line)) {
          var quote = parseQuote(lines, i);
          out.push(quote.html);
          i = quote.next;
          continue;
        }

        if (line.indexOf('|') >= 0 && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
          var table = parseTable(lines, i);
          out.push(table.html);
          i = table.next;
          continue;
        }

        if (/^ *([-*+]|\d+[.)])\s+/.test(line)) {
          var list = parseList(lines, i, line.match(/^( *)/)[1].length);
          out.push(list.html);
          i = list.next;
          continue;
        }

        var paragraph = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i]) &&
               !(i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i].indexOf('|') >= 0)) {
          paragraph.push(lines[i]);
          i += 1;
        }
        out.push('<p>' + inline(paragraph.join('\n')) + '</p>');
      }

      return out.join('\n');
    }

    /* ---- entry point ----------------------------------------------------- */

    function run(markdown) {
      var source = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');

      // Fenced code is lifted out before anything else touches the text.
      source = source.replace(/^( {0,3})(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1\2[^\n]*$/gm,
        function (match, indent, fence, info, code) {
          stats.codeBlocks += 1;
          var lang = info.trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, '');
          codeBlocks.push('<pre data-lang="' + escapeHtml(lang) + '"><code' +
            (lang ? ' class="language-' + escapeHtml(lang) + '"' : '') + '>' +
            escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
          return BLOCK_A + (codeBlocks.length - 1) + BLOCK_B;
        });

      // Link reference definitions are collected, then removed from the flow.
      source = source.replace(/^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+["'(]([^"')]*)["')])?\s*$/gm,
        function (match, id, url, title) {
          refs[id.toLowerCase()] = { url: url, title: title || '' };
          return '';
        });

      var html = parseBlocks(source);

      // Restore the code blocks last so nothing reinterpreted their contents.
      html = html.replace(new RegExp(BLOCK_A + '(\\d+)' + BLOCK_B, 'g'), function (match, index) {
        return codeBlocks[Number(index)];
      });

      var plain = plainText(String(markdown || '').replace(/```[\s\S]*?```/g, ' '));
      var words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;

      stats.words = words;
      stats.characters = String(markdown || '').length;
      stats.charactersNoSpaces = String(markdown || '').replace(/\s/g, '').length;
      stats.lines = markdown ? String(markdown).split('\n').length : 0;
      // 220 words per minute, rounded up, floored at one minute for real text.
      stats.readingMinutes = words ? Math.max(1, Math.round(words / 220)) : 0;

      return { html: html, outline: outline, stats: stats };
    }

    return run;
  }

  /** Renders Markdown once. Every call gets a fresh, isolated state. */
  function render(markdown, options) {
    return createRenderer(options)(markdown);
  }

  var api = {
    render: render,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    slugify: slugify,
    plainText: plainText
  };

  global.ToolAddaMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof window !== 'undefined' ? window : this));
