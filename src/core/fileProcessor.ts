import { App, MarkdownView, Notice } from "obsidian";
import { createDebugOverlay, detectDocument } from "./DocumentDetector";
import { loadOpenCV } from "./opencv-loader";

async function appendToLogFile(app: App, message: string) {
	void app;
	void message;
}

function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to load image for detection"));
		img.src = objectUrl;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Failed to convert canvas to blob"));
				return;
			}
			resolve(blob);
		}, type);
	});
}

export async function processSelectedFile(
	app: App,
	selectedFile: File,
	chosenFolderPath: string,
	showBoundingBox: boolean,
	closeOnFinish: () => void,
) {
	let objectUrl: string | null = null;
	let logMsg = "";
	try {
		const pad2 = (value: number) => String(value).padStart(2, '0');
		const month = pad2(new Date().getMonth() + 1);
		const day = pad2(new Date().getDate());
		const year = String(new Date().getFullYear()).slice(-2);
		const hours = pad2(new Date().getHours());
		const minutes = pad2(new Date().getMinutes());
		const seconds = pad2(new Date().getSeconds());
		const timestampFilename = `image_${month}${day}${year}_${hours}${minutes}${seconds}`;
		const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
		logMsg = `Upload started: ${timestamp}\nFile: ${selectedFile.name} (${selectedFile.size} bytes)\n`;

		await loadOpenCV(app, (msg) => { logMsg += msg + '\n'; });
		new Notice("OpenCV.js loaded. Reading image...");
		logMsg += 'OpenCV.js loaded. Reading image...\n';

		objectUrl = URL.createObjectURL(selectedFile);
		const img = await loadImageFromObjectUrl(objectUrl);
		new Notice("Image loaded. Running document detection...");
		logMsg += `Image loaded: ${img.width}×${img.height}px. Running document detection...\n`;

		const result = detectDocument(img);
		if (result.debug) {
			const d = result.debug;
			logMsg += `[DEBUG] ${d.srcCols}×${d.srcRows} → ${d.dstCols}×${d.dstRows} (warpScale=${d.warpScaleUsed.toFixed(3)})\n`;
		}
		logMsg += `Document detected!\n`;

		const croppedName = `cropped-${timestampFilename}.png`;
		const croppedPath = chosenFolderPath + "/" + croppedName;

		const folderExists = app.vault.getAbstractFileByPath(chosenFolderPath);
		if (!folderExists) await app.vault.createFolder(chosenFolderPath);

		const croppedBlob = await canvasToBlob(result.warped, 'image/png');

		try {
			const oldCropped = app.vault.getAbstractFileByPath(croppedPath);
			if (oldCropped) await app.fileManager.trashFile(oldCropped);
		} catch (e) {
			logMsg += `Could not delete old cropped: ${e}\n`;
		}

		await app.vault.createBinary(croppedPath, await croppedBlob.arrayBuffer());
		logMsg += `Saved cropped image as ${croppedName} (${croppedBlob.size} bytes)\n`;

		if (showBoundingBox) {
			const overlayCanvas = createDebugOverlay(img, result.corners);
			const overlayBlob = await canvasToBlob(overlayCanvas, 'image/png');

			const overlayName = `overlay-${timestampFilename}.png`;
			const overlayPath = chosenFolderPath + "/" + overlayName;

			try {
				const oldOverlay = app.vault.getAbstractFileByPath(overlayPath);
				if (oldOverlay) await app.fileManager.trashFile(oldOverlay);
				logMsg += `Deleted old overlay file\n`;
			} catch (e) {
				logMsg += `Could not delete old overlay: ${e}\n`;
			}

			await app.vault.createBinary(overlayPath, await overlayBlob.arrayBuffer());
			logMsg += `Saved overlay image as ${overlayName} (${overlayBlob.size} bytes)\n`;

			new Notice(`Adding images to vault...`);
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const cursor = view.editor.getCursor();
				view.editor.replaceRange(`![[${overlayPath}]]\n![[${croppedPath}]]\n`, cursor);
			} else {
				new Notice(`Saved to ${croppedPath} and ${overlayPath}`);
			}
			await appendToLogFile(app, logMsg);
		} else {
			new Notice(`Adding image to vault...`);
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const cursor = view.editor.getCursor();
				view.editor.replaceRange(`![[${croppedPath}]]\n`, cursor);
			} else {
				new Notice(`Saved to ${croppedPath}`);
			}
			await appendToLogFile(app, logMsg);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message === "Failed to load image for detection") {
			new Notice(message);
			console.error("Image failed to load for detection");
		} else if (message === "Failed to convert canvas to blob") {
			new Notice(message);
		} else {
			logMsg += `Document detection failed: ${message}\n`;
			new Notice("Document detection failed: " + message);
			console.error("Document detection error:", err);
		}
		await appendToLogFile(app, logMsg);
	} finally {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
		}
		closeOnFinish();
	}
}