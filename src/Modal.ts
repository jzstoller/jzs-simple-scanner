import { App, MarkdownView, Modal, Notice, Platform } from "obsidian";
import { createDebugOverlay, detectDocument } from "./core/DocumentDetector";
import { loadOpenCV } from "./core/opencv-loader";
import { CameraPluginSettings } from "./SettingsTab";

async function appendToLogFile(app: App, message: string) {
	void app;
	void message;
}

class CameraModal extends Modal {
	chosenFolderPath: string;
	cameraSettings: CameraPluginSettings;
	videoStream: MediaStream = null;
	openFilePickerOnOpen: boolean = false;
	constructor(app: App, cameraSettings: CameraPluginSettings, openFilePickerOnOpen: boolean = false) {
		super(app);
		this.chosenFolderPath = cameraSettings.chosenFolderPath;
		this.cameraSettings = cameraSettings;
		this.openFilePickerOnOpen = openFilePickerOnOpen;
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


		this.videoStream = null;
		let cameraIndex = 0;
		let cameras: MediaDeviceInfo[] = [];

		if (!Platform.isIosApp && !this.openFilePickerOnOpen) {
			videoEl.autoplay = true;
			videoEl.muted = true;

			// getUserMedia must precede enumerateDevices so macOS grants permission
			// and real deviceIds are returned.
			try {
				this.videoStream = await navigator.mediaDevices.getUserMedia({
					video: true,
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
		} else if (!Platform.isIosApp && this.openFilePickerOnOpen) {
			// Desktop file-picker mode: skip camera, hide all UI
			statusMsg.style.display = "none";
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
			if (!filePicker.files?.length) return;
			const selectedFile = filePicker.files[0];
			if (this.openFilePickerOnOpen) {
				// Opened via ribbon/command — run full document detection pipeline
				await this.handleUploadFile(selectedFile);
			} else {
				// Opened as a plain upload modal — save raw file
				label.textContent = `Selected: ${selectedFile.name}`;
				const isImage = selectedFile.type.startsWith("image/");
				handleImageSelectChange(selectedFile, isImage);
			}
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

		if (!Platform.isIosApp && !this.openFilePickerOnOpen) {
			switchCameraButton.onclick = async () => {
				cameraIndex = (cameraIndex + 1) % cameras.length;
				this.videoStream = await navigator.mediaDevices.getUserMedia({
					video: { deviceId: cameras[cameraIndex].deviceId },
				});
				videoEl.srcObject = this.videoStream;
				videoEl.play();
			};

			videoEl.srcObject = this.videoStream;
		}

		// Trigger file picker if this modal was opened for upload
		if (this.openFilePickerOnOpen) {
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

		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			window.removeEventListener("focus", handleWindowFocus);
			scanPicker.remove();
		};
		const handleWindowFocus = () => cleanup();

		scanPicker.onchange = async () => {
			cleanup();
			if (!scanPicker.files?.length) return;
			const selectedFile = scanPicker.files[0];
			const modal = new CameraModal(app, cameraSettings);
			await modal.handleScanFile(selectedFile);
		};

		document.body.appendChild(scanPicker);
		window.addEventListener("focus", handleWindowFocus, { once: true });
		scanPicker.click();
	}

	async handleScanFile(selectedFile: File) {
		await this.processSelectedFile(selectedFile, "Scan");
	}

	static triggerIosUpload(app: App, cameraSettings: CameraPluginSettings) {
		if (!Platform.isIosApp) return;

		const filePicker = document.createElement("input");
		filePicker.type = "file";
		filePicker.accept = "image/*";
		filePicker.style.display = "none";

		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			window.removeEventListener("focus", handleWindowFocus);
			filePicker.remove();
		};
		const handleWindowFocus = () => cleanup();

		filePicker.onchange = async () => {
			cleanup();
			if (!filePicker.files?.length) return;
			const selectedFile = filePicker.files[0];
			const modal = new CameraModal(app, cameraSettings);
			await modal.handleUploadFile(selectedFile);
		};

		document.body.appendChild(filePicker);
		window.addEventListener("focus", handleWindowFocus, { once: true });
		filePicker.click();
	}

	static triggerDesktopUpload(app: App, cameraSettings: CameraPluginSettings) {
		if (Platform.isIosApp) return;

		const filePicker = document.createElement("input");
		filePicker.type = "file";
		filePicker.accept = "image/*";
		filePicker.style.display = "none";

		filePicker.onchange = async () => {
			filePicker.remove();
			if (!filePicker.files?.length) return;
			const selectedFile = filePicker.files[0];
			const modal = new CameraModal(app, cameraSettings, false);
			await modal.handleUploadFile(selectedFile);
		};

		document.body.appendChild(filePicker);
		filePicker.click();
	}

	async handleUploadFile(selectedFile: File) {
		await this.processSelectedFile(selectedFile, "Upload");
	}

	private async processSelectedFile(selectedFile: File, logLabel: "Scan" | "Upload") {
		const month = String(new Date().getMonth() + 1).padStart(2, '0');
		const day = String(new Date().getDate()).padStart(2, '0');
		const year = String(new Date().getFullYear()).slice(-2);
		const hours = String(new Date().getHours()).padStart(2, '0');
		const minutes = String(new Date().getMinutes()).padStart(2, '0');
		const seconds = String(new Date().getSeconds()).padStart(2, '0');
		const timestampFilename = `image_${month}${day}${year}_${hours}${minutes}${seconds}`;
		const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
		let logMsg = `${logLabel} started: ${timestamp}\nFile: ${selectedFile.name} (${selectedFile.size} bytes)\n`;

		try {
			await loadOpenCV(this.app, (msg) => { logMsg += msg + '\n'; });
			new Notice("OpenCV.js loaded. Reading image...");
			logMsg += 'OpenCV.js loaded. Reading image...\n';
		} catch (err) {
			const msg = "Failed to load OpenCV.js: " + err.message;
			new Notice(msg);
			logMsg += msg + '\n';
			await appendToLogFile(this.app, logMsg);
			if (this.openFilePickerOnOpen && !Platform.isIosApp) {
				this.close();
			}
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
					logMsg += `[DEBUG] ${d.srcCols}×${d.srcRows} → ${d.dstCols}×${d.dstRows} (warpScale=${d.warpScaleUsed.toFixed(3)})\n`;
					}
					logMsg += `Document detected!\n`;

					result.warped.toBlob(async (croppedBlob) => {
						if (!croppedBlob) {
							const msg = "Failed to convert warped image to blob";
							new Notice(msg);
							logMsg += msg + '\n';
							await appendToLogFile(this.app, logMsg);
							return;
						}

						const croppedName = `cropped-${timestampFilename}.png`;
						const croppedPath = this.chosenFolderPath + "/" + croppedName;

						const folderExists = this.app.vault.getAbstractFileByPath(this.chosenFolderPath);
						if (!folderExists) await this.app.vault.createFolder(this.chosenFolderPath);

						// Delete old cropped file
						try {
							const oldCropped = this.app.vault.getAbstractFileByPath(croppedPath);
							if (oldCropped) await this.app.vault.delete(oldCropped);
						} catch (e) {
							logMsg += `Could not delete old cropped: ${e}\n`;
						}

						// Always save cropped image
						await this.app.vault.createBinary(croppedPath, await croppedBlob.arrayBuffer());
						logMsg += `Saved cropped image as ${croppedName} (${croppedBlob.size} bytes)\n`;

						// Optionally save overlay if setting is enabled
						if (this.cameraSettings.showBoundingBox) {
							const overlayCanvas = createDebugOverlay(img, result.corners);

							overlayCanvas.toBlob(async (overlayBlob: Blob | null) => {
								if (!overlayBlob) {
									const msg = "Failed to convert overlay image to blob";
									logMsg += msg + '\n';
								} else {
									const overlayName = `overlay-${timestampFilename}.png`;
									const overlayPath = this.chosenFolderPath + "/" + overlayName;

									// Delete old overlay if exists
									try {
										const oldOverlay = this.app.vault.getAbstractFileByPath(overlayPath);
										if (oldOverlay) await this.app.vault.delete(oldOverlay);
										logMsg += `Deleted old overlay file\n`;
									} catch (e) {
										logMsg += `Could not delete old overlay: ${e}\n`;
									}

									// Save new overlay
									await this.app.vault.createBinary(overlayPath, await overlayBlob.arrayBuffer());
									logMsg += `Saved overlay image as ${overlayName} (${overlayBlob.size} bytes)\n`;

									new Notice(`Adding images to vault...`);
									const view = this.app.workspace.getActiveViewOfType(MarkdownView);
									if (view) {

										const cursor = view.editor.getCursor();
										view.editor.replaceRange(`![[${overlayPath}]]\n![[${croppedPath}]]\n`, cursor);
									} else {
										new Notice(`Saved to ${croppedPath} and ${overlayPath}`);
									}


									await appendToLogFile(this.app, logMsg);
								}
							}, 'image/png');
						} else {
							// Setting is OFF - only save cropped, skip overlay
							new Notice(`Adding image to vault...`);
							const view = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (view) {
								const cursor = view.editor.getCursor();
								view.editor.replaceRange(`![[${croppedPath}]]\n`, cursor);
							} else {
								new Notice(`Saved to ${croppedPath}`);
							}


							await appendToLogFile(this.app, logMsg);
						}
					}, 'image/png');
				} catch (err) {
					logMsg += `Document detection failed: ${err.message}\n`;
					new Notice("Document detection failed: " + err.message);
					console.error("Document detection error:", err);
					await appendToLogFile(this.app, logMsg);
					if (this.openFilePickerOnOpen && !Platform.isIosApp) {
						this.close();
					}
				}
			};
			img.onerror = async () => {
				const msg = "Failed to load image for detection";
				new Notice(msg);
				logMsg += msg + '\n';
				console.error("Image failed to load for detection");
				await appendToLogFile(this.app, logMsg);
					if (this.openFilePickerOnOpen && !Platform.isIosApp) {
						this.close();
					}
			};
			img.src = dataUrl;
		};
		reader.onerror = async (e) => {
			const msg = "Failed to read image file for detection";
			new Notice(msg);
			logMsg += msg + '\n';
			console.error("FileReader error:", e);
			await appendToLogFile(this.app, logMsg);
			if (this.openFilePickerOnOpen && !Platform.isIosApp) {
				this.close();
			}
		};
		reader.readAsDataURL(selectedFile);
	}
}

export default CameraModal;
