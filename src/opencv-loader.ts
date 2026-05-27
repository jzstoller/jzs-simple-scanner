import { App, Notice, Platform } from "obsidian";

type Logger = (msg: string) => void;

// CDN fallback if local file is missing or WASM is corrupt
const CDN_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

export async function loadOpenCV(app: App, logger?: Logger, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = (msg: string) => {
      new Notice(msg);
      if (logger) logger(msg);
    };
    let finished = false;
    const finish = (fn: () => void) => {
      if (!finished) {
        finished = true;
        fn();
      }
    };

    // Check if cv.Mat is available — the only reliable readiness signal
    const isReady = () => !!(window as any).cv?.Mat;

    if (isReady()) {
      log('OpenCV.js already loaded and ready.');
      finish(resolve);
      return;
    }

    // If a stale/broken script tag is in the DOM, remove it so we can try fresh
    const stale = document.getElementById('opencvjs');
    if (stale) {
      log('Removing stale OpenCV.js script tag from previous failed attempt...');
      stale.remove();
    }

    // Wait for cv.Mat to appear after a script loads, with a per-attempt timeout
    const waitForReady = (attemptLabel: string, perAttemptMs: number, onReady: () => void, onTimeout: () => void) => {
      const deadline = Date.now() + perAttemptMs;
      const poll = () => {
        if (finished) return;
        if (isReady()) {
          log('OpenCV.js WASM ready (' + attemptLabel + ').');
          onReady();
        } else if (Date.now() > deadline) {
          onTimeout();
        } else {
          setTimeout(poll, 300);
        }
      };
      const cv = (window as any).cv;
      if (cv && !cv.Mat) {
        // cv object exists but WASM not yet done — hook the callback too
        cv['onRuntimeInitialized'] = () => {
          if (!finished) {
            log('OpenCV.js onRuntimeInitialized fired (' + attemptLabel + ').');
            onReady();
          }
        };
      }
      poll();
    };

    const tryLoad = (src: string, label: string, onSuccess: () => void, onFail: (reason: string) => void) => {
      if (finished) return;
      log('Trying to load OpenCV.js from: ' + label);
      const script = document.createElement('script');
      script.id = 'opencvjs';
      script.src = src;
      script.async = true;
      script.onload = () => {
        log('Script loaded (' + label + '), waiting for WASM...');
        waitForReady(
          label,
          20000,
          onSuccess,
          () => {
            script.remove();
            onFail('WASM init timed out after loading from ' + label);
          }
        );
      };
      script.onerror = () => {
        script.remove();
        onFail('Script load error from ' + label);
      };
      document.body.appendChild(script);
    };

    const localPluginPath = '.obsidian/plugins/jzs_scan/opencv.js';

    const tryLoadLocal = async () => {
      if (Platform.isIosApp) {
        // iOS WKWebView blocks <script src> for local files; read via vault API and inject as a Blob URL instead
        log('Trying to load OpenCV.js from: local plugin file (iOS blob)');
        let blobUrl: string | null = null;
        try {
          const data = await app.vault.adapter.readBinary(localPluginPath);
          const blob = new Blob([data], { type: 'application/javascript' });
          blobUrl = URL.createObjectURL(blob);
          await new Promise<void>((res, rej) => {
            tryLoad(blobUrl!, 'local plugin file', res, rej);
          });
          URL.revokeObjectURL(blobUrl);
          finish(resolve);
        } catch (err) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          log('Local load failed (' + (err?.message ?? err) + '), trying CDN fallback...');
          tryLoad(
            CDN_URL,
            'OpenCV CDN',
            () => finish(resolve),
            (reason2) => {
              log('CDN load also failed: ' + reason2);
              finish(() => reject(new Error('OpenCV.js failed to load from local and CDN: ' + reason2)));
            }
          );
        }
      } else {
        const localPath = (app.vault.adapter as any).getResourcePath(localPluginPath);
        // Try local file, then fall back to CDN
        tryLoad(
          localPath,
          'local plugin file',
          () => finish(resolve),
          (reason) => {
            log('Local load failed (' + reason + '), trying CDN fallback...');
            tryLoad(
              CDN_URL,
              'OpenCV CDN',
              () => finish(resolve),
              (reason2) => {
                log('CDN load also failed: ' + reason2);
                finish(() => reject(new Error('OpenCV.js failed to load from local and CDN: ' + reason2)));
              }
            );
          }
        );
      }
    };

    tryLoadLocal();

    // Overall hard timeout
    setTimeout(() => {
      finish(() => {
        log('OpenCV.js overall load timed out after ' + timeoutMs / 1000 + 's');
        reject(new Error('OpenCV.js overall load timed out after ' + timeoutMs / 1000 + 's'));
      });
    }, timeoutMs);
  });
}
