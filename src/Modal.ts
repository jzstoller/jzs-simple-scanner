import { App, MarkdownView, Modal, Notice, Platform, TFile } from "obsidian";
import { createDebugOverlay, detectDocument } from "../scripts/detectDocument-browser";
import { loadOpenCV } from "./opencv-loader";
import { CameraPluginSettings } from "./SettingsTab";

async function appendToLogFile(app: App, message: string) {
	const logFilePath = 'CameraPluginLog.md';
	let logContent = '';
	try {
		const existing = app.vault.getAbstractFileByPath(logFilePath);
		if (existing && existing instanceof TFile) {
			logContent = await app.vault.read(existing);
		}
	} catch (e) {
		new Notice('Log: Error reading existing log file: ' + ((e as Error)?.message || String(e)));
		console.error('Log: Error reading existing log file:', e);
	}
	const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
	logContent += `\n[${timestamp}] ${message}`;
	try {
		const file = app.vault.getAbstractFileByPath(logFilePath);
		if (file && file instanceof TFile) {
			await app.vault.modify(file, logContent);
			new Notice('Log: Updated CameraPluginLog.md');
		} else {
			await app.vault.create(logFilePath, logContent);
			new Notice('Log: Created CameraPluginLog.md');
		}
	} catch (e) {
		new Notice('Log: Error writing log file: ' + ((e as Error)?.message || String(e)));
		console.error('Log: Error writing log file:', e);
	}
}

class CameraModal extends Modal {
	chosenFolderPath: string;
	videoStream: MediaStream = null;
	shouldOpenFilePicker: boolean = false;
	constructor(app: App, cameraSettings: CameraPluginSettings, shouldOpenFilePicker: boolean = false) {
		super(app);
		this.chosenFolderPath = cameraSettings.chosenFolderPath;
		this.shouldOpenFilePicker = shouldOpenFilePicker;
	}

	async onOpen() {
		const { contentEl } = this;
		const webCamContainer = contentEl.createDiv();

		const statusMsg = webCamContainer.createEl("span", {
			text: "Loading..",
		});
		let videoEl: HTMLVideoElement;
		let switchCameraButton: HTMLButtonElement;
		const buttonsDiv = webCamContainer.createDiv();
		const firstRow = buttonsDiv.createDiv();
		const secondRow = buttonsDiv.createDiv();

		if (!Platform.isIosApp) {
			videoEl = webCamContainer.createEl("video");
			switchCameraButton = firstRow.createEl("button", {
				text: "Switch Camera",
			});
		}
		const scanButton = firstRow.createEl("button", {
			text: "Scan",
		});
		scanButton.style.display = "none";
		firstRow.style.display = "none";
		secondRow.style.display = "none";

		const filePicker = secondRow.createEl("input", {
			placeholder: "Choose image file from system",
			type: "file",
		});
		filePicker.id = "filepicker";
		filePicker.accept = "image/*";

		filePicker.style.display = "none";

		const label = secondRow.createEl("label");
		label.textContent = "Upload";
		label.style.cursor = "pointer";
		label.style.display = "inline-block";
		label.style.margin = "5px 0px";
		label.style.padding = "5px";
		label.style.border = "0.5px solid #555";
		label.htmlFor = "filepicker";
		label.innerHTML = "&#8679; Upload";

		label.appendChild(filePicker);

		secondRow.appendChild(label);

		let scanProcessing = false;

		if (Platform.isIosApp) {
			const scanPicker = secondRow.createEl("input", { type: "file" });
			scanPicker.accept = "image/*";
			scanPicker.capture = "environment";
			scanPicker.style.display = "none";

			scanButton.style.display = "inline-block";
			scanButton.onclick = () => {
				scanPicker.click();
			};
			scanPicker.onchange = async () => {
				if (scanProcessing) {
					const msg = "Scan already in progress. Please wait.";
					new Notice(msg);
					return;
				}
				scanProcessing = true; // Lock immediately
				const scanId = Math.random().toString(36).substring(7);
				await appendToLogFile(this.app, `[scanPicker.onchange] fired with scanId=${scanId}. files=${scanPicker.files?.length ?? 0}`);
				if (!scanPicker.files?.length) {
					const msg = "No file selected for scan.";
					new Notice(msg);
					await appendToLogFile(this.app, msg);
					scanProcessing = false;
					return;
				}
				const selectedFile = scanPicker.files[0];
			const now = new Date();
			const month = String(now.getMonth() + 1).padStart(2, '0');
			const day = String(now.getDate()).padStart(2, '0');
			const year = String(now.getFullYear()).slice(-2);
			const hours = String(now.getHours()).padStart(2, '0');
			const minutes = String(now.getMinutes()).padStart(2, '0');
			const seconds = String(now.getSeconds()).padStart(2, '0');
			const timestampFilename = `image_${month}${day}${year}_${hours}${minutes}${seconds}`;
				const scanTimestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
					let logMsg = `[PLUGIN v14] scanId=${scanId} Scan started: ${scanTimestamp}\nFile: ${selectedFile.name} (${selectedFile.size} bytes)\n`;
				new Notice("Loading OpenCV.js...");
				logMsg += 'Loading OpenCV.js...\n';
				try {
					// Pass app and logger to loadOpenCV to capture all loader events
					await loadOpenCV(this.app, (msg) => { logMsg += msg + '\n'; });
					new Notice("OpenCV.js loaded. Reading image...");
					logMsg += 'OpenCV.js loaded. Reading image...\n';
				} catch (err) {
					const msg = "Failed to load OpenCV.js: " + err.message;
					new Notice(msg);
					logMsg += msg + '\n';
					await appendToLogFile(this.app, logMsg);
					return;
				}
				const reader = new FileReader();
				reader.onload = async (e) => {
					const dataUrl = e.target.result as string;
					const dataUrlHash = dataUrl.substring(0, 50) + '...' + dataUrl.substring(dataUrl.length - 20);
					logMsg += `[${scanId}] FileReader loaded: data URL length=${dataUrl.length}, hash=${dataUrlHash}\n`;
					const img = new Image();
					img.onload = async () => {
						new Notice("Image loaded. Running document detection...");
						logMsg += `[${scanId}] Image loaded: ${img.width}×${img.height}px. Running document detection...\n`;
						try {
							const result = detectDocument(img);
							if (result.debug) {
								const d = result.debug;
							logMsg += `[${scanId}-DEBUG] src=${d.srcCols}×${d.srcRows} type=${d.srcType} pixel0=[${d.srcSamplePixel}]\n`;
							logMsg += `[${scanId}-DEBUG] dst=${d.dstCols}×${d.dstRows} midPixel=[${d.dstSamplePixel}] warpScale=${d.warpScaleUsed.toFixed(3)}\n`;
							}
							logMsg += `Document detected!\nCorners (tl → tr → br → bl):\n`;
							const labels = ["top-left", "top-right", "bottom-right", "bottom-left"];
							result.corners.forEach((pt, i) => {
								logMsg += `  ${labels[i].padEnd(12)} x=${pt.x}, y=${pt.y}\n`;
							});
							logMsg += `Warped size: ${result.width} × ${result.height}px\n`;

							// Create debug overlay with crop box
							const overlayCanvas = createDebugOverlay(img, result.corners);

							// Convert both images to blobs and save
							result.warped.toBlob(async (croppedBlob) => {
								if (!croppedBlob) {
									const msg = "Failed to convert warped image to blob";
									new Notice(msg);
									logMsg += msg + '\n';
									await appendToLogFile(this.app, logMsg);
									return;
								}

								overlayCanvas.toBlob(async (overlayBlob: Blob | null) => {
									if (!overlayBlob) {
										const msg = "Failed to convert overlay image to blob";
										new Notice(msg);
										logMsg += msg + '\n';
										await appendToLogFile(this.app, logMsg);
										return;
									}

									const croppedName = `cropped-${timestampFilename}.png`;
									const overlayName = `overlay-${timestampFilename}.png`;

									// Save files to vault
									const croppedPath = this.chosenFolderPath + "/" + croppedName;
									const overlayPath = this.chosenFolderPath + "/" + overlayName;

									const folderExists = this.app.vault.getAbstractFileByPath(this.chosenFolderPath);
									if (!folderExists) await this.app.vault.createFolder(this.chosenFolderPath);

								// Force delete old files to prevent caching
								try {
									const oldCropped = this.app.vault.getAbstractFileByPath(croppedPath);
									if (oldCropped) await this.app.vault.delete(oldCropped);
									logMsg += `[${scanId}] Deleted old cropped file\n`;
								} catch (e) {
									logMsg += `[${scanId}] Could not delete old cropped: ${e}\n`;
								}
								try {
									const oldOverlay = this.app.vault.getAbstractFileByPath(overlayPath);
									if (oldOverlay) await this.app.vault.delete(oldOverlay);
									logMsg += `[${scanId}] Deleted old overlay file\n`;
								} catch (e) {
									logMsg += `[${scanId}] Could not delete old overlay: ${e}\n`;
								}

								// Now create new files
								await this.app.vault.createBinary(croppedPath, await croppedBlob.arrayBuffer());
								await this.app.vault.createBinary(overlayPath, await overlayBlob.arrayBuffer());

								new Notice(`Adding new Images to vault...`);
								logMsg += `[${scanId}] Saved cropped image as ${croppedName} (${croppedBlob.size} bytes)\n`;
								logMsg += `[${scanId}] Saved overlay image as ${overlayName} (${overlayBlob.size} bytes)\n`;

								// Insert both images into the note
								if (view) {
									await appendToLogFile(this.app, `[scan] inserting note content at cursor`);
									const cursor = view.editor.getCursor();
									view.editor.replaceRange(`![[${overlayPath}]]\n![[${croppedPath}]]\n`, cursor);
								} else {
									new Notice(`Saved to ${croppedPath} and ${overlayPath}`);
								}

								// Show in UI
								const resultDiv = document.createElement('div');
								resultDiv.style.marginTop = '16px';
								const label = document.createElement('div');
								label.textContent = 'Detected Document:';
								label.style.fontWeight = 'bold';
								resultDiv.appendChild(label);
								resultDiv.appendChild(result.warped);
								contentEl.appendChild(resultDiv);

								new Notice("Document detected and saved!");
								await appendToLogFile(this.app, logMsg);
								scanProcessing = false;
								this.close();
								}, 'image/png');
							}, 'image/png');
						} catch (err) {
							logMsg += `Document detection failed: ${err.message}\n`;
							new Notice("Document detection failed: " + err.message);
							scanProcessing = false;
							if (window.console && window.console.error) {
								console.error("Document detection error:", err);
							}
							await appendToLogFile(this.app, logMsg);
						}
					};
					img.onerror = async () => {
						const msg = "Failed to load image for detection";
						new Notice(msg);
						logMsg += msg + '\n';
						if (window.console && window.console.error) {
							console.error("Image failed to load for detection");
						}
						await appendToLogFile(this.app, logMsg);
					};
							img.src = dataUrl;
				};
				reader.onerror = async (e) => {
					const msg = "Failed to read image file for detection";
					new Notice(msg);
					logMsg += msg + '\n';
					if (window.console && window.console.error) {
						console.error("FileReader error:", e);
					}
					await appendToLogFile(this.app, logMsg);
				};
				reader.readAsDataURL(selectedFile);
			// Reset file input immediately so selecting the same file again will trigger onchange
			setTimeout(() => { scanPicker.value = ''; }, 100);
			};
		}

		this.videoStream = null;
		let cameraIndex = 0;
		let cameras: MediaDeviceInfo[] = [];

		if (!Platform.isIosApp) {
			videoEl.autoplay = true;
			videoEl.muted = true;

			// getUserMedia must precede enumerateDevices so macOS grants permission
			// and real deviceIds are returned.
			try {
				this.videoStream = await navigator.mediaDevices.getUserMedia({
					video: true,
					audio: true,
				});
			} catch (error) {
				console.log(error);
			}

			cameras = (
				await navigator.mediaDevices.enumerateDevices()
			).filter((d) => d.kind === "videoinput");

			if (cameras.length <= 1) switchCameraButton.style.display = "none";

			if (this.videoStream) {
				firstRow.style.display = "block";
				secondRow.style.display = "block";
				statusMsg.style.display = "none";
			} else {
				secondRow.style.display = "block";
				statusMsg.textContent =
					"Error in loading videostream in your device..";
			}
		} else {
			// iOS: Show only the Scan button and Upload button
			firstRow.style.display = "none";
			secondRow.style.display = "block";
			statusMsg.style.display = "none";
		}

		const handleImageSelectChange = async (
			file: File,
			isImage: boolean = true,
		) => {
			const chosenFile = file;
			const bufferFile = await chosenFile.arrayBuffer();
			saveFile(bufferFile, isImage, chosenFile.name.split(" ").join("-"));
		};

		filePicker.onchange = async () => {
			await appendToLogFile(this.app, `[filePicker.onchange] fired. scanProcessing=${scanProcessing} files=${filePicker.files?.length ?? 0}`);
			if (scanProcessing) {
				await appendToLogFile(this.app, '[filePicker.onchange] blocked by scanProcessing guard');
				return;
			}
			if (!filePicker.files?.length) return;
			const selectedFile = filePicker.files[0];
			label.textContent = `Selected: ${selectedFile.name}`;
			const isImage = selectedFile.type.startsWith("image/");
			handleImageSelectChange(selectedFile, isImage);
		};

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		const saveFile = async (
			file: ArrayBuffer,
			isImage = true,
			fileName = "",
		) => {
			if (!fileName) {
				const dateString = (new Date() + "")
					.slice(4, 28)
					.split(" ")
					.join("_")
					.split(":")
					.join("-");
				fileName = `image_${dateString}.png`;
			}
			new Notice(`Adding new Image to vault...`);

			const filePath = this.chosenFolderPath + "/" + fileName;
			const folderExists = this.app.vault.getAbstractFileByPath(
				this.chosenFolderPath,
			);
			if (!folderExists)
				await this.app.vault.createFolder(this.chosenFolderPath);
			const fileExists = this.app.vault.getAbstractFileByPath(filePath);
			if (!fileExists) await this.app.vault.createBinary(filePath, file);

			if (!view) return new Notice(`Saved to ${filePath}`);

			await appendToLogFile(this.app, `[saveFile] inserting note content for ${fileName}`);
			const cursor = view.editor.getCursor();
			view.editor.replaceRange(
				`![${fileName}](${filePath})\n`,
				cursor,
			);
			this.close();
		};

		if (!Platform.isIosApp) {
			switchCameraButton.onclick = async () => {
				cameraIndex = (cameraIndex + 1) % cameras.length;
				this.videoStream = await navigator.mediaDevices.getUserMedia({
					video: { deviceId: cameras[cameraIndex].deviceId },
					audio: true,
				});
				videoEl.srcObject = this.videoStream;
				videoEl.play();
			};

			videoEl.srcObject = this.videoStream;
		}

		// Trigger file picker if this modal was opened for upload
		if (this.shouldOpenFilePicker) {
			setTimeout(() => {
				filePicker.click();
			}, 100);
		}
	}

	onClose() {
		const { contentEl } = this;
		this.videoStream?.getTracks().forEach((track) => {
			track.stop();
		});
		contentEl.empty();
	}

	static triggerIosScan(app: App, cameraSettings: CameraPluginSettings) {
		if (!Platform.isIosApp) return;

		const scanPicker = document.createElement("input");
		scanPicker.type = "file";
		scanPicker.accept = "image/*";
		scanPicker.capture = "environment";
		scanPicker.style.display = "none";

		scanPicker.onchange = async () => {
			if (!scanPicker.files?.length) return;
			const selectedFile = scanPicker.files[0];
			const modal = new CameraModal(app, cameraSettings);
			await modal.handleScanFile(selectedFile);
			document.body.removeChild(scanPicker);
		};

		document.body.appendChild(scanPicker);
		scanPicker.click();
	}

	async handleScanFile(selectedFile: File) {
		const month = String(new Date().getMonth() + 1).padStart(2, '0');
		const day = String(new Date().getDate()).padStart(2, '0');
		const year = String(new Date().getFullYear()).slice(-2);
		const hours = String(new Date().getHours()).padStart(2, '0');
		const minutes = String(new Date().getMinutes()).padStart(2, '0');
		const seconds = String(new Date().getSeconds()).padStart(2, '0');
		const timestampFilename = `image_${month}${day}${year}_${hours}${minutes}${seconds}`;
		const scanTimestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
		let logMsg = `[PLUGIN v14] Scan started: ${scanTimestamp}\nFile: ${selectedFile.name} (${selectedFile.size} bytes)\n`;

		new Notice("Loading OpenCV.js...");
		logMsg += 'Loading OpenCV.js...\n';
		try {
			await loadOpenCV(this.app, (msg) => { logMsg += msg + '\n'; });
			new Notice("OpenCV.js loaded. Reading image...");
			logMsg += 'OpenCV.js loaded. Reading image...\n';
		} catch (err) {
			const msg = "Failed to load OpenCV.js: " + err.message;
			new Notice(msg);
			logMsg += msg + '\n';
			await appendToLogFile(this.app, logMsg);
			return;
		}

		const reader = new FileReader();
		reader.onload = async (e) => {
			const dataUrl = e.target.result as string;
			const img = new Image();
			img.onload = async () => {
				new Notice("Image loaded. Running document detection...");
				logMsg += `Image loaded: ${img.width}×${img.height}px. Running document detection...\n`;
				try {
					const result = detectDocument(img);
					if (result.debug) {
						const d = result.debug;
						logMsg += `[DEBUG] src=${d.srcCols}×${d.srcRows} type=${d.srcType} pixel0=[${d.srcSamplePixel}]\n`;
						logMsg += `[DEBUG] dst=${d.dstCols}×${d.dstRows} midPixel=[${d.dstSamplePixel}] warpScale=${d.warpScaleUsed.toFixed(3)}\n`;
					}
					logMsg += `Document detected!\nCorners (tl → tr → br → bl):\n`;
					const labels = ["top-left", "top-right", "bottom-right", "bottom-left"];
					result.corners.forEach((pt, i) => {
						logMsg += `  ${labels[i].padEnd(12)} x=${pt.x}, y=${pt.y}\n`;
					});
					logMsg += `Warped size: ${result.width} × ${result.height}px\n`;

					const overlayCanvas = createDebugOverlay(img, result.corners);

					result.warped.toBlob(async (croppedBlob) => {
						if (!croppedBlob) {
							const msg = "Failed to convert warped image to blob";
							new Notice(msg);
							logMsg += msg + '\n';
							await appendToLogFile(this.app, logMsg);
							return;
						}

						overlayCanvas.toBlob(async (overlayBlob: Blob | null) => {
							if (!overlayBlob) {
								const msg = "Failed to convert overlay image to blob";
								new Notice(msg);
								logMsg += msg + '\n';
								await appendToLogFile(this.app, logMsg);
								return;
							}

							const croppedName = `cropped-${timestampFilename}.png`;
							const overlayName = `overlay-${timestampFilename}.png`;
							const croppedPath = this.chosenFolderPath + "/" + croppedName;
							const overlayPath = this.chosenFolderPath + "/" + overlayName;

							const folderExists = this.app.vault.getAbstractFileByPath(this.chosenFolderPath);
							if (!folderExists) await this.app.vault.createFolder(this.chosenFolderPath);

							try {
								const oldCropped = this.app.vault.getAbstractFileByPath(croppedPath);
								if (oldCropped) await this.app.vault.delete(oldCropped);
								logMsg += `Deleted old cropped file\n`;
							} catch (e) {
								logMsg += `Could not delete old cropped: ${e}\n`;
							}
							try {
								const oldOverlay = this.app.vault.getAbstractFileByPath(overlayPath);
								if (oldOverlay) await this.app.vault.delete(oldOverlay);
								logMsg += `Deleted old overlay file\n`;
							} catch (e) {
								logMsg += `Could not delete old overlay: ${e}\n`;
							}

							await this.app.vault.createBinary(croppedPath, await croppedBlob.arrayBuffer());
							await this.app.vault.createBinary(overlayPath, await overlayBlob.arrayBuffer());

							new Notice(`Adding new Images to vault...`);
							logMsg += `Saved cropped image as ${croppedName} (${croppedBlob.size} bytes)\n`;
							logMsg += `Saved overlay image as ${overlayName} (${overlayBlob.size} bytes)\n`;

							const view = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (view) {
								await appendToLogFile(this.app, `[scan] inserting note content at cursor`);
								const cursor = view.editor.getCursor();
								view.editor.replaceRange(`![[${overlayPath}]]\n![[${croppedPath}]]\n`, cursor);
							} else {
								new Notice(`Saved to ${croppedPath} and ${overlayPath}`);
							}

							new Notice("Document detected and saved!");
							await appendToLogFile(this.app, logMsg);
						}, 'image/png');
					}, 'image/png');
				} catch (err) {
					logMsg += `Document detection failed: ${err.message}\n`;
					new Notice("Document detection failed: " + err.message);
					if (window.console && window.console.error) {
						console.error("Document detection error:", err);
					}
					await appendToLogFile(this.app, logMsg);
				}
			};
			img.onerror = async () => {
				const msg = "Failed to load image for detection";
				new Notice(msg);
				logMsg += msg + '\n';
				if (window.console && window.console.error) {
					console.error("Image failed to load for detection");
				}
				await appendToLogFile(this.app, logMsg);
			};
			img.src = dataUrl;
		};
		reader.onerror = async (e) => {
			const msg = "Failed to read image file for detection";
			new Notice(msg);
			logMsg += msg + '\n';
			if (window.console && window.console.error) {
				console.error("FileReader error:", e);
			}
			await appendToLogFile(this.app, logMsg);
		};
		reader.readAsDataURL(selectedFile);
	}
}

export default CameraModal;
