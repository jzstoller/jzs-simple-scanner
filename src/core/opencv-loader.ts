import { App, Notice, Platform } from "obsidian";

type Logger = (msg: string) => void;

type TimerHandle = number;

type OpenCVLoaderState = {
  script: HTMLScriptElement | null;
  sourceTimeout: ReturnType<typeof setTimeout> | null;
  overallTimeout: ReturnType<typeof setTimeout> | null;
  cvCheckInterval: ReturnType<typeof setInterval> | null;
  checkCvInterval: ReturnType<typeof setInterval> | null;
  finished: boolean;
  aborted: boolean;
  previousModuleValue: any;
  moduleObject: any;
};

// CDN URLs - try multiple sources on desktop, single source on iOS
// Note: npm CDN versions sometimes fail to load in Electron, so we fallback to docs.opencv.org
const CDN_URLS_DESKTOP = [
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0/dist/opencv.js',
  'https://unpkg.com/@techstark/opencv-js@4.12.0/dist/opencv.js',
  'https://docs.opencv.org/4.10.0/opencv.js', // Fallback (loads but may have WASM issues)
];

const CDN_URL_IOS = 'https://docs.opencv.org/4.10.0/opencv.js';

let activeLoader: OpenCVLoaderState | null = null;

function deleteOpenCVGlobals() {
  const existingScript = document.getElementById('opencvjs');
  if (existingScript) {
    existingScript.remove();
  }
  if ((window as any).cv) {
    delete (window as any).cv;
  }
}

function clearLoaderTimers(state: OpenCVLoaderState) {
  if (state.sourceTimeout) window.clearTimeout(state.sourceTimeout);
  if (state.overallTimeout) window.clearTimeout(state.overallTimeout);
  if (state.cvCheckInterval) window.clearInterval(state.cvCheckInterval);
  if (state.checkCvInterval) window.clearInterval(state.checkCvInterval);
}

function abortActiveLoader() {
  if (!activeLoader) return;

  const state = activeLoader;
  activeLoader = null;
  state.aborted = true;
  state.finished = true;
  clearLoaderTimers(state);

  const moduleObject = (window as any).Module;
  if (moduleObject === state.moduleObject) {
    if (typeof state.previousModuleValue === "undefined") {
      delete (window as any).Module;
    } else {
      (window as any).Module = state.previousModuleValue;
    }
  }

  if (state.script) {
    state.script.remove();
  }
}

export function cleanupOpenCVLoader() {
  abortActiveLoader();
  deleteOpenCVGlobals();
}

export async function loadOpenCV(app: App, logger?: Logger, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    abortActiveLoader();

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
    deleteOpenCVGlobals();

    // Choose CDN list based on platform
    const cdnUrls = Platform.isIosApp ? [CDN_URL_IOS] : CDN_URLS_DESKTOP;

    let cdnIndex = 0;
    const state: OpenCVLoaderState = {
      script: null,
      sourceTimeout: null,
      overallTimeout: null,
      cvCheckInterval: null,
      checkCvInterval: null,
      finished: false,
      aborted: false,
      previousModuleValue: undefined,
      moduleObject: null,
    };

    activeLoader = state;

    const finalize = () => {
      clearLoaderTimers(state);
      if (state.script) {
        state.script.remove();
        state.script = null;
      }
      if ((window as any).Module === state.moduleObject) {
        if (typeof state.previousModuleValue === "undefined") {
          delete (window as any).Module;
        } else {
          (window as any).Module = state.previousModuleValue;
        }
      }
      if (activeLoader === state) {
        activeLoader = null;
      }
    };

    const complete = () => {
      if (state.finished) return;
      state.finished = true;
      finalize();
    };

    const loadFromUrl = () => {
      if (state.aborted || state.finished || cdnIndex >= cdnUrls.length) {
        if (!state.finished && !state.aborted) {
          state.finished = true;
          reject(new Error('OpenCV.js failed to load from all sources'));
        }
        return;
      }

      const url = cdnUrls[cdnIndex];
      cdnIndex++;

      state.sourceTimeout = setTimeout(() => {
        if (state.finished || state.aborted) return;
        loadFromUrl();
      }, 20000);  // 20 second timeout per CDN source

      // Try with script tag first (simpler for some contexts)
      const script = document.createElement('script');
      script.id = 'opencvjs';
      script.src = url;
      script.async = true;
      state.script = script;

      // Setup Module for WASM loading - queue callbacks
      state.previousModuleValue = (window as any).Module;
      state.moduleObject = {
        ...(state.previousModuleValue || {}),
      };
      state.moduleObject.onRuntimeInitialized = () => {
        if (state.aborted || state.finished) return;
        // Check if ready
        if (!state.finished && isReady()) {
          log('✓ OpenCV.js ready');
          complete();
          resolve();
        }
      };
      (window as any).Module = state.moduleObject;

      script.onload = () => {
        // Script loaded, now wait for cv.Mat or Module callback to be ready
      };

      state.cvCheckInterval = setInterval(() => {
        if (state.finished || state.aborted) {
          clearLoaderTimers(state);
          return;
        }
        const cv = (window as any).cv;
        const mod = (window as any).Module;
        if (!cv && mod && mod._malloc) {
          (window as any).cv = mod;
        }
        if (cv && cv.Mat) {
          clearLoaderTimers(state);
          if (!state.finished) {
            state.finished = true;
            resolve();
            finalize();
          }
        }
      }, 1000);

      state.checkCvInterval = setInterval(() => {
        if (state.finished || state.aborted) {
          clearLoaderTimers(state);
        }
      }, 100);

      script.onerror = () => {
        if (state.finished || state.aborted) return;
        clearLoaderTimers(state);
        if (state.script) {
          state.script.remove();
          state.script = null;
        }
        loadFromUrl();
      };

      document.body.appendChild(script);
    };

    loadFromUrl();

    // Overall timeout
    state.overallTimeout = setTimeout(() => {
      if (!state.finished && !state.aborted) {
        state.finished = true;
        finalize();
        reject(new Error('OpenCV.js load timeout after ' + (timeoutMs / 1000) + 's'));
      }
    }, timeoutMs);
  });
}
