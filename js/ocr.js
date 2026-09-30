// On-device OCR with Tesseract.js. The image never leaves the phone.
// Tesseract (~3 MB of code and language data) loads only the first time someone scans.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine. Are you online?'));
    document.head.appendChild(s);
  });
}

let progressHandler = () => {};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: (m) => progressHandler(m),
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error('That file could not be opened as an image.'));
    img.src = url;
  });
}

/**
 * Tesla screens are light text on a dark background, which Tesseract reads poorly.
 * Upscale, convert to grayscale, invert when the image is mostly dark, and stretch the contrast.
 */
function preprocess(img) {
  const maxSide = 2400;
  const minSide = 1400;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest < minSide ? minSide / longest : Math.min(1, maxSide / longest);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const gray = new Uint8ClampedArray(w * h);
  let total = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    gray[j] = g;
    total += g;
  }
  const invert = total / gray.length < 128;

  // Contrast stretch between the 2nd and 98th percentiles.
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const pick = (p) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= gray.length * p) return v;
    }
    return 255;
  };
  const lo = pick(0.02);
  const hi = Math.max(pick(0.98), lo + 1);

  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let g = ((gray[j] - lo) * 255) / (hi - lo);
    if (invert) g = 255 - g;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * @param {File} file
 * @param {(fraction: number, label: string) => void} onProgress
 * @returns {Promise<{ text: string, previewUrl: string }>}
 */
export async function readScreenshot(file, onProgress = () => {}) {
  const { img, url } = await loadImage(file);
  onProgress(0.02, 'Loading OCR engine…');
  progressHandler = (m) => {
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Reading text…');
    else if (m.progress !== undefined) onProgress(0.05 + m.progress * 0.25, 'Loading OCR engine…');
  };
  const worker = await getWorker();
  const canvas = preprocess(img);
  const { data } = await worker.recognize(canvas);
  onProgress(1, 'Done');
  return { text: data.text, previewUrl: url };
}
