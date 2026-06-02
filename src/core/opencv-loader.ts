import { App, Notice, Platform } from "obsidian";

type Logger = (msg: string) => void;

// CDN URLs - try multiple sources on desktop, single source on iOS
// Note: npm CDN versions sometimes fail to load in Electron, so we fallback to docs.opencv.org
const CDN_URLS_DESKTOP = [
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0/dist/opencv.js',
  'https://unpkg.com/@techstark/opencv-js@4.12.0/dist/opencv.js',
  'https://docs.opencv.org/4.10.0/opencv.js', // Fallback (loads but may have WASM issues)
];

const CDN_URL_IOS = 'https://docs.opencv.org/4.10.0/opencv.js';

export async function loadOpenCV(app: App, logger?: Logger, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = (msg: string) => {
      new Notice(msg);
      if (logger) logger(msg);
    };

    const isReady = () => !!(window as any).cv?.Mat;

    if (isReady()) {
      resolve();
      return;
    }

    // Remove any stale script
    const stale = document.getElementById('opencvjs');
    if (stale) stale.remove();

    // Choose CDN list based on platform
    const cdnUrls = Platform.isIosApp ? [CDN_URL_IOS] : CDN_URLS_DESKTOP;

    let finished = false;
    let cdnIndex = 0;
    let statusCheck: any = null;

    const loadFromUrl = () => {
      if (finished || cdnIndex >= cdnUrls.length) {
        if (!finished) {
          finished = true;
          reject(new Error('OpenCV.js failed to load from all sources'));
        }
        return;
      }

      const url = cdnUrls[cdnIndex];
      cdnIndex++;

      const timeout = setTimeout(() => {
        if (finished) return;
        loadFromUrl();
      }, 20000);  // 20 second timeout per CDN source

      // Try with script tag first (simpler for some contexts)
      const script = document.createElement('script');
      script.id = 'opencvjs';
      script.src = url;
      script.async = true;

      // Setup Module for WASM loading - queue callbacks
      (window as any).Module = (window as any).Module || {};
      const originalCallback = (window as any).Module.onRuntimeInitialized;
      (window as any).Module.onRuntimeInitialized = () => {
        // Call original if it exists
        if (originalCallback && typeof originalCallback === 'function') {
          originalCallback();
        }
        // Check if ready
        if (!finished && isReady()) {
          clearTimeout(timeout);
          finished = true;
          log('✓ OpenCV.js ready');
          resolve();
        }
      };

      script.onload = () => {
        // Script loaded, now wait for cv.Mat or Module callback to be ready
      };

      let cvCheckInterval: any = null;
      let checkCvInterval: any = null;

      const cleanup = () => {
        if (cvCheckInterval) clearInterval(cvCheckInterval);
        if (checkCvInterval) clearInterval(checkCvInterval);
      };

      cvCheckInterval = setInterval(() => {
        if (finished) {
          cleanup();
          clearTimeout(timeout);
          return;
        }
        const cv = (window as any).cv;
        const mod = (window as any).Module;
        if (!cv && mod && mod._malloc) {
          (window as any).cv = mod;
        }
        if (cv && cv.Mat) {
          cleanup();
          clearTimeout(timeout);
          if (!finished) {
            finished = true;
            resolve();
          }
        }
      }, 1000);

      checkCvInterval = setInterval(() => {
        if (finished) {
          cleanup();
        }
      }, 100);

      script.onerror = () => {
        clearTimeout(timeout);
        if (finished) return;
        script.remove();
        loadFromUrl();
      };

      document.body.appendChild(script);
    };

    loadFromUrl();

    // Overall timeout
    setTimeout(() => {
      if (!finished) {
        finished = true;
        if (statusCheck) clearInterval(statusCheck);
        reject(new Error('OpenCV.js load timeout after ' + (timeoutMs / 1000) + 's'));
      }
    }, 180000);  // 3 minutes overall for all attempts
  });
}
