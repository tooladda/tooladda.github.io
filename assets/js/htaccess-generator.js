/* ToolAdda — .htaccess Generator engine.
   Pure text-generation logic (no DOM) lives here so it can be reasoned about
   and tested independently of the UI. Builds a production-ready Apache
   .htaccess file from a plain options object. Runs entirely client-side. */
(function (global) {
  'use strict';

  const DEFAULT_OPTIONS = {
    // redirects
    httpsRedirect: 'to-https', // off | to-https | to-http
    wwwRedirect: 'off', // off | to-www | to-non-www
    trailingSlash: 'off', // off | add | remove
    removeIndexPhp: false,
    removeHtmlExt: false,
    customRedirects: [], // [{ code: 301|302|307|308, from, to, wildcard: bool }]

    // rewrite / framework
    rewritePreset: 'none', // none | wordpress | laravel | codeigniter | spa | static-pretty

    // security
    disableDirectoryListing: true,
    protectSensitiveFiles: true,
    protectBackupFiles: true,
    disableTrace: true,
    hideServerSignature: true,
    blockHotlinking: false,
    hotlinkDomains: '',
    blockBadBots: false,
    blockIps: '',
    allowOnlyIps: '',
    headerXContentTypeOptions: true,
    headerXFrameOptions: true,
    headerXssProtection: false,
    headerReferrerPolicy: true,
    headerPermissionsPolicy: false,
    headerHsts: false,
    headerCsp: '',

    // caching / performance
    browserCaching: false,
    gzipCompression: false,
    removeETags: false,

    // SEO
    custom404: '',
    custom500: '',

    // CORS
    enableCors: false,
    corsOrigin: '*',
    corsMethods: 'GET, POST, OPTIONS, PUT, DELETE',
    corsHeaders: 'Content-Type, Authorization',

    // PHP
    phpMemoryLimit: '',
    phpUploadMaxFilesize: '',
    phpMaxExecutionTime: '',
    phpTimezone: '',
    phpDisplayErrors: 'unset', // unset | on | off
  };

  const PRESETS = {
    wordpress: {
      httpsRedirect: 'to-https', wwwRedirect: 'off', rewritePreset: 'wordpress',
      protectSensitiveFiles: true, disableDirectoryListing: true, browserCaching: true, gzipCompression: true,
    },
    laravel: {
      httpsRedirect: 'to-https', rewritePreset: 'laravel',
      protectSensitiveFiles: true, disableDirectoryListing: true, gzipCompression: true,
    },
    'react-spa': {
      httpsRedirect: 'to-https', rewritePreset: 'spa',
      browserCaching: true, gzipCompression: true, disableDirectoryListing: true,
    },
    'vue-spa': {
      httpsRedirect: 'to-https', rewritePreset: 'spa',
      browserCaching: true, gzipCompression: true, disableDirectoryListing: true,
    },
    'angular-spa': {
      httpsRedirect: 'to-https', rewritePreset: 'spa',
      browserCaching: true, gzipCompression: true, disableDirectoryListing: true,
    },
    'static-site': {
      httpsRedirect: 'to-https', wwwRedirect: 'to-non-www', rewritePreset: 'static-pretty', removeHtmlExt: true,
      browserCaching: true, gzipCompression: true, disableDirectoryListing: true,
    },
    'api-server': {
      httpsRedirect: 'to-https', enableCors: true, disableDirectoryListing: true,
      headerXContentTypeOptions: true, protectSensitiveFiles: true,
    },
    ecommerce: {
      httpsRedirect: 'to-https', wwwRedirect: 'to-non-www', trailingSlash: 'remove',
      protectSensitiveFiles: true, disableDirectoryListing: true, browserCaching: true, gzipCompression: true,
      headerXFrameOptions: true, headerReferrerPolicy: true, headerHsts: true,
    },
  };

  function mergeOptions(overrides) {
    return Object.assign({}, DEFAULT_OPTIONS, overrides || {});
  }

  function applyPreset(presetId, base) {
    const preset = PRESETS[presetId];
    if (!preset) return mergeOptions(base);
    return Object.assign({}, DEFAULT_OPTIONS, base || {}, preset);
  }

  // ---------- small helpers ----------

  function block(lines) {
    return lines.filter((l) => l != null);
  }

  function ifModule(moduleName, innerLines) {
    if (!innerLines.length) return [];
    return [`<IfModule ${moduleName}>`, ...innerLines.map((l) => (l ? '    ' + l : l)), '</IfModule>'];
  }

  function isValidPath(p) {
    return typeof p === 'string' && p.trim().length > 0;
  }

  // ---------- redirect / rewrite section ----------

  function buildRedirectRules(opts, warnings) {
    const lines = [];

    if (opts.httpsRedirect === 'to-https') {
      lines.push('# Force HTTPS');
      lines.push('RewriteCond %{HTTPS} off');
      lines.push('RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]');
      lines.push('');
    } else if (opts.httpsRedirect === 'to-http') {
      lines.push('# Force HTTP (not recommended — only for local/legacy setups)');
      lines.push('RewriteCond %{HTTPS} on');
      lines.push('RewriteRule ^ http://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]');
      lines.push('');
    }
    if (opts.wwwRedirect === 'to-www') {
      lines.push('# Redirect non-www to www');
      lines.push('RewriteCond %{HTTP_HOST} !^www\\. [NC]');
      lines.push('RewriteCond %{HTTP_HOST} !^$');
      lines.push('RewriteRule ^ https://www.%{HTTP_HOST}%{REQUEST_URI} [L,R=301]');
      lines.push('');
    } else if (opts.wwwRedirect === 'to-non-www') {
      lines.push('# Redirect www to non-www');
      lines.push('RewriteCond %{HTTP_HOST} ^www\\.(.+)$ [NC]');
      lines.push('RewriteRule ^ https://%1%{REQUEST_URI} [L,R=301]');
      lines.push('');
    }
    if (opts.httpsRedirect === 'to-https' && opts.wwwRedirect !== 'off') {
      warnings.push('HTTPS and www-canonicalization are both enabled as separate rules — a request that needs both (e.g. http://www... when the target is https://non-www) takes two redirect hops. This is safe, just not maximally efficient; combining them into one rule is possible but was intentionally left out here to avoid fragile edge cases with Apache\'s RewriteCond backreferences.');
    }

    if (opts.trailingSlash === 'add') {
      lines.push('# Add a trailing slash to directory-style URLs');
      lines.push('RewriteCond %{REQUEST_FILENAME} !-f');
      lines.push('RewriteCond %{REQUEST_URI} !(.*)/$');
      lines.push('RewriteRule ^(.*)$ /$1/ [L,R=301]');
      lines.push('');
    } else if (opts.trailingSlash === 'remove') {
      lines.push('# Remove trailing slash');
      lines.push('RewriteCond %{REQUEST_FILENAME} !-d');
      lines.push('RewriteRule ^(.*)/$ /$1 [L,R=301]');
      lines.push('');
    }

    if (opts.removeIndexPhp) {
      lines.push('# Remove index.php from the URL');
      lines.push('RewriteCond %{THE_REQUEST} \\s/+index\\.php[\\s?] [NC]');
      lines.push('RewriteRule ^index\\.php(/(.*))?$ /$2 [L,R=301]');
      lines.push('');
    }

    if (opts.removeHtmlExt) {
      lines.push('# Serve .html files without the extension, and redirect away from explicit .html URLs');
      lines.push('RewriteCond %{THE_REQUEST} \\s/+(.+?)\\.html[\\s?] [NC]');
      lines.push('RewriteRule ^ /%1 [R=301,L]');
      lines.push('RewriteCond %{REQUEST_FILENAME} !-d');
      lines.push('RewriteCond %{REQUEST_FILENAME}\\.html -f');
      lines.push('RewriteRule ^(.*)$ $1.html [L]');
      lines.push('');
    }

    (opts.customRedirects || []).forEach((r) => {
      if (!isValidPath(r.from) || !isValidPath(r.to)) return;
      const code = [301, 302, 307, 308].includes(Number(r.code)) ? Number(r.code) : 301;
      if (r.wildcard) {
        lines.push(`# Custom redirect (pattern): ${r.from} -> ${r.to}`);
        lines.push(`RewriteRule ${r.from} ${r.to} [R=${code},L]`);
      } else {
        lines.push(`# Custom redirect: ${r.from} -> ${r.to}`);
        lines.push(`Redirect ${code} ${r.from} ${r.to}`);
      }
      lines.push('');
    });

    return lines;
  }

  const REWRITE_PRESET_RULES = {
    wordpress: [
      'RewriteRule ^index\\.php$ - [L]',
      'RewriteCond %{REQUEST_FILENAME} !-f',
      'RewriteCond %{REQUEST_FILENAME} !-d',
      'RewriteRule . /index.php [L]',
    ],
    laravel: [
      'RewriteCond %{HTTP:Authorization} .',
      'RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]',
      'RewriteCond %{REQUEST_FILENAME} !-d',
      'RewriteCond %{REQUEST_FILENAME} !-f',
      'RewriteRule ^ index.php [L]',
    ],
    codeigniter: [
      'RewriteCond %{REQUEST_FILENAME} !-f',
      'RewriteCond %{REQUEST_FILENAME} !-d',
      'RewriteRule ^(.*)$ index.php/$1 [L]',
    ],
    spa: [
      'RewriteRule ^index\\.html$ - [L]',
      'RewriteCond %{REQUEST_FILENAME} !-f',
      'RewriteCond %{REQUEST_FILENAME} !-d',
      'RewriteCond %{REQUEST_FILENAME} !-l',
      'RewriteRule . /index.html [L]',
    ],
  };

  function buildFrameworkRewrite(opts) {
    const preset = opts.rewritePreset;
    if (preset === 'none' || preset === 'static-pretty' || !REWRITE_PRESET_RULES[preset]) return [];
    const label = { wordpress: 'WordPress', laravel: 'Laravel', codeigniter: 'CodeIgniter', spa: 'Single Page Application (React/Vue/Angular)' }[preset];
    return [`# ${label} front-controller rewrite`, ...REWRITE_PRESET_RULES[preset], ''];
  }

  // ---------- security section ----------

  function buildSecurity(opts, warnings) {
    const lines = [];

    if (opts.disableDirectoryListing) {
      lines.push('# Disable directory listing', 'Options -Indexes', '');
    }

    if (opts.disableTrace) {
      lines.push('# Block the TRACE HTTP method (TraceEnable is server-config-only, so this uses RewriteRule instead)');
      lines.push('RewriteCond %{REQUEST_METHOD} ^TRACE');
      lines.push('RewriteRule .* - [F]');
      lines.push('');
    }

    if (opts.hideServerSignature) {
      lines.push('# Hide the Apache version in error pages');
      lines.push('# Note: if this causes a 500 error, your host restricts it — move it to the main server config instead.');
      lines.push('ServerSignature Off');
      lines.push('');
    }

    if (opts.blockHotlinking) {
      if (!isValidPath(opts.hotlinkDomains)) {
        warnings.push('Hotlink protection is enabled but no allowed domain was entered — add your domain(s) so your own site can still load its images.');
      }
      const domains = (opts.hotlinkDomains || 'yourdomain.com').split(',').map((d) => d.trim()).filter(Boolean);
      lines.push('# Block image hotlinking from other sites');
      lines.push('RewriteCond %{HTTP_REFERER} !^$');
      domains.forEach((d) => lines.push(`RewriteCond %{HTTP_REFERER} !^https?://(www\\.)?${d.replace(/\./g, '\\.')} [NC]`));
      lines.push('RewriteRule \\.(jpg|jpeg|png|gif|webp|svg)$ - [F,NC,L]');
      lines.push('');
    }

    if (opts.blockBadBots) {
      lines.push('# Block common aggressive/low-value crawler bots');
      lines.push('RewriteCond %{HTTP_USER_AGENT} (AhrefsBot|MJ12bot|DotBot|SemrushBot|MauiBot|PetalBot|serpstatbot) [NC]');
      lines.push('RewriteRule .* - [F,L]');
      lines.push('');
    }

    const blockIpList = (opts.blockIps || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const allowIpList = (opts.allowOnlyIps || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (blockIpList.length && allowIpList.length) {
      warnings.push('Both an IP block list and an IP allow-list are configured — the allow-list already restricts access to only those IPs, making the block list redundant. Consider using only one.');
    }
    if (allowIpList.length) {
      lines.push('# Restrict access to specific IP addresses only');
      lines.push('<RequireAll>');
      allowIpList.forEach((ip) => lines.push(`    Require ip ${ip}`));
      lines.push('</RequireAll>');
      lines.push('');
    } else if (blockIpList.length) {
      lines.push('# Block specific IP addresses');
      lines.push('<RequireAll>');
      lines.push('    Require all granted');
      blockIpList.forEach((ip) => lines.push(`    Require not ip ${ip}`));
      lines.push('</RequireAll>');
      lines.push('');
    }

    if (opts.protectSensitiveFiles) {
      lines.push('# Deny access to sensitive dotfiles and project metadata');
      lines.push('<FilesMatch "^\\.(env|git|htaccess|htpasswd|gitignore)">');
      lines.push('    Require all denied');
      lines.push('</FilesMatch>');
      lines.push('<FilesMatch "^(composer\\.(json|lock)|package(-lock)?\\.json|webpack\\.config\\.js)$">');
      lines.push('    Require all denied');
      lines.push('</FilesMatch>');
      lines.push('');
    }

    if (opts.protectBackupFiles) {
      lines.push('# Deny access to backup, config, and log files');
      lines.push('<FilesMatch "\\.(bak|backup|old|orig|save|swp|dist|sql|log|ini|conf)$">');
      lines.push('    Require all denied');
      lines.push('</FilesMatch>');
      lines.push('');
    }

    const headerLines = [];
    if (opts.headerXContentTypeOptions) headerLines.push('Header always set X-Content-Type-Options "nosniff"');
    if (opts.headerXFrameOptions) headerLines.push('Header always set X-Frame-Options "SAMEORIGIN"');
    if (opts.headerXssProtection) headerLines.push('Header always set X-XSS-Protection "1; mode=block"  # legacy header, ignored by modern browsers but harmless');
    if (opts.headerReferrerPolicy) headerLines.push('Header always set Referrer-Policy "strict-origin-when-cross-origin"');
    if (opts.headerPermissionsPolicy) headerLines.push('Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"');
    if (opts.headerHsts) headerLines.push('Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"');
    if (isValidPath(opts.headerCsp)) headerLines.push(`Header always set Content-Security-Policy "${opts.headerCsp.trim()}"`);
    if (headerLines.length) {
      if (opts.headerHsts && opts.httpsRedirect !== 'to-https') {
        warnings.push('HSTS is enabled without forcing HTTPS — HSTS tells browsers to only ever use HTTPS for this domain, so make sure HTTPS actually works site-wide before relying on it (it can lock out HTTP-only setups).');
      }
      lines.push('# Security headers', ...ifModule('mod_headers.c', headerLines), '');
    }

    return lines;
  }

  // ---------- caching / performance ----------

  function buildCaching(opts) {
    const lines = [];
    if (opts.browserCaching) {
      const expiresLines = [
        'ExpiresActive On',
        'ExpiresByType image/jpg "access plus 1 year"',
        'ExpiresByType image/jpeg "access plus 1 year"',
        'ExpiresByType image/png "access plus 1 year"',
        'ExpiresByType image/webp "access plus 1 year"',
        'ExpiresByType image/svg+xml "access plus 1 year"',
        'ExpiresByType image/x-icon "access plus 1 year"',
        'ExpiresByType font/woff "access plus 1 year"',
        'ExpiresByType font/woff2 "access plus 1 year"',
        'ExpiresByType text/css "access plus 1 month"',
        'ExpiresByType application/javascript "access plus 1 month"',
        'ExpiresByType text/javascript "access plus 1 month"',
        'ExpiresByType application/pdf "access plus 1 month"',
        'ExpiresByType text/html "access plus 1 hour"',
      ];
      lines.push('# Browser caching (Expires headers)', ...ifModule('mod_expires.c', expiresLines), '');
    }
    if (opts.gzipCompression) {
      const deflateLines = [
        'AddOutputFilterByType DEFLATE text/plain',
        'AddOutputFilterByType DEFLATE text/html',
        'AddOutputFilterByType DEFLATE text/css',
        'AddOutputFilterByType DEFLATE text/javascript',
        'AddOutputFilterByType DEFLATE application/javascript',
        'AddOutputFilterByType DEFLATE application/json',
        'AddOutputFilterByType DEFLATE application/xml',
        'AddOutputFilterByType DEFLATE image/svg+xml',
      ];
      lines.push('# Gzip compression', ...ifModule('mod_deflate.c', deflateLines), '');
    }
    if (opts.removeETags) {
      lines.push('# Remove ETags (recommended when using far-future Expires headers or multiple servers)');
      lines.push(...ifModule('mod_headers.c', ['Header unset ETag']));
      lines.push('FileETag None');
      lines.push('');
    }
    return lines;
  }

  // ---------- SEO / errors ----------

  function buildErrorPages(opts) {
    const lines = [];
    if (isValidPath(opts.custom404)) lines.push(`ErrorDocument 404 ${opts.custom404.trim()}`);
    if (isValidPath(opts.custom500)) lines.push(`ErrorDocument 500 ${opts.custom500.trim()}`);
    if (lines.length) return ['# Custom error pages', ...lines, ''];
    return [];
  }

  // ---------- CORS ----------

  function buildCors(opts) {
    if (!opts.enableCors) return [];
    const lines = [
      `Header always set Access-Control-Allow-Origin "${(opts.corsOrigin || '*').trim()}"`,
      `Header always set Access-Control-Allow-Methods "${(opts.corsMethods || 'GET, POST, OPTIONS').trim()}"`,
      `Header always set Access-Control-Allow-Headers "${(opts.corsHeaders || 'Content-Type').trim()}"`,
    ];
    return ['# CORS headers', ...ifModule('mod_headers.c', lines), ''];
  }

  // ---------- PHP ----------

  function buildPhp(opts, warnings) {
    const lines = [];
    if (isValidPath(opts.phpMemoryLimit)) lines.push(`php_value memory_limit ${opts.phpMemoryLimit.trim()}`);
    if (isValidPath(opts.phpUploadMaxFilesize)) {
      lines.push(`php_value upload_max_filesize ${opts.phpUploadMaxFilesize.trim()}`);
      lines.push(`php_value post_max_size ${opts.phpUploadMaxFilesize.trim()}`);
    }
    if (isValidPath(opts.phpMaxExecutionTime)) lines.push(`php_value max_execution_time ${opts.phpMaxExecutionTime.trim()}`);
    if (isValidPath(opts.phpTimezone)) lines.push(`php_value date.timezone "${opts.phpTimezone.trim()}"`);
    if (opts.phpDisplayErrors === 'on') lines.push('php_flag display_errors on');
    if (opts.phpDisplayErrors === 'off') lines.push('php_flag display_errors off');
    if (!lines.length) return [];
    warnings.push('php_value/php_flag directives only work with mod_php. If your host uses PHP-FPM (common on modern shared/cloud hosting), these will cause a 500 error — use a .user.ini file or your host\'s PHP settings panel instead.');
    return ['# PHP configuration (requires mod_php — see warning)', ...lines, ''];
  }

  // ---------- top-level orchestration ----------

  function generateHtaccess(userOptions) {
    const opts = mergeOptions(userOptions);
    const warnings = [];
    const sections = [];

    const rewriteLines = block([
      ...buildRedirectRules(opts, warnings),
      ...buildFrameworkRewrite(opts),
    ]).filter((l) => l !== undefined);
    if (rewriteLines.length) {
      // strip a single trailing blank line for cleanliness, RewriteEngine On goes once at the top
      while (rewriteLines.length && rewriteLines[rewriteLines.length - 1] === '') rewriteLines.pop();
      sections.push(['# ---- URL rewriting & redirects ----', ...ifModule('mod_rewrite.c', ['RewriteEngine On', 'RewriteBase /', '', ...rewriteLines])].join('\n'));
    }

    const securityLines = buildSecurity(opts, warnings);
    if (securityLines.length) {
      while (securityLines.length && securityLines[securityLines.length - 1] === '') securityLines.pop();
      sections.push(['# ---- Security ----', ...securityLines].join('\n'));
    }

    const cachingLines = buildCaching(opts);
    if (cachingLines.length) {
      while (cachingLines.length && cachingLines[cachingLines.length - 1] === '') cachingLines.pop();
      sections.push(['# ---- Caching & performance ----', ...cachingLines].join('\n'));
    }

    const errorLines = buildErrorPages(opts);
    if (errorLines.length) {
      while (errorLines.length && errorLines[errorLines.length - 1] === '') errorLines.pop();
      sections.push(errorLines.join('\n'));
    }

    const corsLines = buildCors(opts);
    if (corsLines.length) {
      while (corsLines.length && corsLines[corsLines.length - 1] === '') corsLines.pop();
      sections.push(corsLines.join('\n'));
    }

    const phpLines = buildPhp(opts, warnings);
    if (phpLines.length) {
      while (phpLines.length && phpLines[phpLines.length - 1] === '') phpLines.pop();
      sections.push(phpLines.join('\n'));
    }

    const header = '# Generated by ToolAdda — .htaccess Generator (tooladda.online)\n# Review before deploying to production. Apache 2.4+ syntax.\n';
    const code = sections.length ? header + '\n' + sections.join('\n\n') + '\n' : header + '\n# No rules selected yet — enable options above to generate your .htaccess file.\n';

    return { code, warnings, ruleCount: sections.length };
  }

  global.HtaccessGen = {
    DEFAULT_OPTIONS,
    PRESETS,
    mergeOptions,
    applyPreset,
    generateHtaccess,
  };
})(typeof window !== 'undefined' ? window : global);
