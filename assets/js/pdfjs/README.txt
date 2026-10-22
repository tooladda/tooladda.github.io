pdf.js 3.11.174 (Mozilla, Apache-2.0 - see LICENSE.txt)

pdf.min.js        = build/pdf.min.js        from pdfjs-dist@3.11.174
pdf.worker.min.js = build/pdf.worker.min.js from pdfjs-dist@3.11.174

Both files are byte-identical to the npm package and to cdnjs's
pdf.js/3.11.174 copy.

Why 3.11.174 and not 4.x: this is the last release that ships a classic
(non-module) build. A classic <script> loads from file:// and works with no
network, while the 4.x ES modules are refused by Chrome on file://. When the
worker cannot start (file://), load pdf.worker.min.js as a classic script too:
pdf.js then finds window.pdfjsWorker and runs the worker code on the page.

Always pass isEvalSupported: false to getDocument(). It closes
CVE-2024-4367, which affects this version when eval is enabled.
