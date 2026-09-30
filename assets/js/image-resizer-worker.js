/* ToolAdda — off-main-thread pixel resampling.
   Only pure array math runs here (via image-resizer-engine.js, which has zero
   DOM dependency) — no DOMParser/Canvas/Image objects are needed inside a
   Worker, so this is a safe, well-supported use of importScripts(). */
try {
  importScripts('image-resizer-engine.js');
} catch (e) {
  // If the worker script fails to load for any reason, every message below
  // will simply error out and the caller falls back to the main thread.
}

self.onmessage = (event) => {
  const { id, algorithm, data, width, height, destWidth, destHeight } = event.data;
  try {
    const src = { data: new Uint8ClampedArray(data), width, height };
    const result = self.ImageResizerEngine.resample(algorithm, src, destWidth, destHeight);
    self.postMessage(
      { id, ok: true, data: result.data.buffer, width: result.width, height: result.height },
      [result.data.buffer]
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || 'Resampling failed in worker' });
  }
};
