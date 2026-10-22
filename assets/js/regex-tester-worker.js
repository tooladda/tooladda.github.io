/* ToolAdda — Regex Tester worker.

   Matching runs here so a pattern with catastrophic backtracking can be
   terminated by the page instead of locking the interface. A running
   RegExp cannot be interrupted from inside, which is exactly why this
   file exists: the only reliable cancel is terminating the worker.

   The engine is imported rather than duplicated — regex-tester.js skips
   all of its UI code when `document` is undefined, as it is here. */

/* global importScripts, self */
importScripts('regex-tester.js');

self.onmessage = function (event) {
  var data = event.data || {};
  var result;

  try {
    result = self.ToolAddaRegex.run(data.request);
  } catch (err) {
    result = {
      ok: false,
      error: self.ToolAddaRegex.cleanErrorMessage(err && err.message)
    };
  }

  self.postMessage({ id: data.id, result: result });
};
