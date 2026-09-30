OCR engine for ats-resume-checker.html (image-only PDF resumes). Apache-2.0,
see LICENSE.txt.

tesseract.min.js                 tesseract.js 5.1.1   dist/tesseract.min.js
worker.min.js                    tesseract.js 5.1.1   dist/worker.min.js
tesseract-core-simd-lstm.wasm.js tesseract.js-core 5.1.1 (wasm embedded)
eng.traineddata.gz               @tesseract.js-data/eng 1.0.0, 4.0.0_best_int

All byte-identical to the npm packages. Only the SIMD + LSTM core is kept
(the OEM tesseract.js 5 uses by default). A browser without WebAssembly SIMD
(Safari before 16.4) is sent to the same core on jsDelivr instead: pass
corePath as a directory for that case and tesseract.js picks the plain core.

Pass absolute URLs for workerPath, corePath and langPath: the worker runs
from a blob: URL, so relative paths do not resolve.
