import { App, Notice } from "obsidian";

interface OpenCVWasmModule {
	_malloc?: unknown;
	[key: string]: unknown;
}

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

const LOCAL_OPENCV_SCRIPT =
	".obsidian/plugins/simple-scanner/assets/opencv/opencv.min.js";
const LOCAL_OPENCV_WASM =
	".obsidian/plugins/simple-scanner/assets/opencv/opencv.min.wasm";

let activeLoader: OpenCVLoaderState | null = null;

function deleteOpenCVGlobals() {
	const existingScript = document.getElementById("opencvjs");
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

export async function loadOpenCV(
	app: App,
	logger?: Logger,
	timeoutMs = 60000,
): Promise<void> {
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

		const script = document.createElement("script");
		script.id = "opencvjs";
		script.src = app.vault.adapter.getResourcePath(LOCAL_OPENCV_SCRIPT);
		script.async = true;
		state.script = script;

		state.previousModuleValue = (window as any).Module;
		state.moduleObject = {
			...(state.previousModuleValue || {}),
			locateFile: (file: string) => {
				if (file.endsWith(".wasm")) {
					return app.vault.adapter.getResourcePath(LOCAL_OPENCV_WASM);
				}
				return app.vault.adapter.getResourcePath(file);
			},
			onRuntimeInitialized: () => {
				if (state.aborted || state.finished) return;

				const cv = (window as any).cv;
				if (cv && cv.Mat) {
					log("✓ OpenCV.js ready");
					complete();
					resolve();
				}
			},
		};
		(window as any).Module = state.moduleObject;

		state.cvCheckInterval = setInterval(() => {
			if (state.finished || state.aborted) {
				clearLoaderTimers(state);
				return;
			}
			const cv = (window as any).cv;
			const mod = (window as any).Module as OpenCVWasmModule;
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
			reject(new Error("Failed to load local OpenCV build"));
		};

		document.body.appendChild(script);

		// Overall timeout
		state.overallTimeout = setTimeout(() => {
			if (!state.finished && !state.aborted) {
				state.finished = true;
				finalize();
				reject(
					new Error(
						"OpenCV.js load timeout after " +
							timeoutMs / 1000 +
							"s",
					),
				);
			}
		}, timeoutMs);
	});
}
