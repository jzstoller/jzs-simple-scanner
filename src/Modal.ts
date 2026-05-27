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
	constructor(app: App, cameraSettings: CameraPluginSettings) {
		super(app);
		this.chosenFolderPath = cameraSettings.chosenFolderPath;
	}

	async onOpen() {
		const { contentEl } = this;
		const webCamContainer = contentEl.createDiv();

		const statusMsg = webCamContainer.createEl("span", {
			text: "Loading..",
		});
		const videoEl = webCamContainer.createEl("video");
		const buttonsDiv = webCamContainer.createDiv();
		const firstRow = buttonsDiv.createDiv();
		const secondRow = buttonsDiv.createDiv();
		const recordVideoButton = firstRow.createEl("button", {
			text: "Start recording",
		});
		const switchCameraButton = firstRow.createEl("button", {
			text: "Switch Camera",
		});
		const snapPhotoButton = firstRow.createEl("button", {
			text: "Take a snap",
		});
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
		filePicker.accept = "image/*,video/*";
		filePicker.capture = "camera"; // back camera by default for mobile screens

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
				scanProcessing = true; // set before click so filePicker.onchange is blocked from the start
				scanPicker.click();
			};
			scanPicker.onchange = async () => {
				await appendToLogFile(this.app, `[scanPicker.onchange] fired. scanProcessing=${scanProcessing} files=${scanPicker.files?.length ?? 0}`);
				if (!scanPicker.files?.length) {
					const msg = "No file selected for scan.";
					new Notice(msg);
					await appendToLogFile(this.app, msg);
					return;
				}
				const selectedFile = scanPicker.files[0];
				const fileName = selectedFile.name.split(" ").join("-");
				const scanTimestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
				let logMsg = `Scan started: ${scanTimestamp}\n`;
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
					const img = new Image();
					img.onload = async () => {
						new Notice("Image loaded. Running document detection...");
						logMsg += 'Image loaded. Running document detection...\n';
						try {
							const result = detectDocument(img);
							if (result.debug) {
								const d = result.debug;
								logMsg += `Debug: src=${d.srcCols}×${d.srcRows} type=${d.srcType} pixel0=[${d.srcSamplePixel}]\n`;
								logMsg += `Debug: dst=${d.dstCols}×${d.dstRows} midPixel=[${d.dstSamplePixel}] warpScale=${d.warpScaleUsed.toFixed(3)}\n`;
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
									
									const croppedName = `cropped-${fileName.replace(/\.[^.]+$/, '')}.png`;
									const overlayName = `overlay-${fileName.replace(/\.[^.]+$/, '')}.png`;
									
									// Save files to vault
									const croppedPath = this.chosenFolderPath + "/" + croppedName;
									const overlayPath = this.chosenFolderPath + "/" + overlayName;
									
									const folderExists = this.app.vault.getAbstractFileByPath(this.chosenFolderPath);
									if (!folderExists) await this.app.vault.createFolder(this.chosenFolderPath);
									
									const croppedFileExists = this.app.vault.getAbstractFileByPath(croppedPath);
									if (!croppedFileExists) await this.app.vault.createBinary(croppedPath, await croppedBlob.arrayBuffer());
									
									const overlayFileExists = this.app.vault.getAbstractFileByPath(overlayPath);
									if (!overlayFileExists) await this.app.vault.createBinary(overlayPath, await overlayBlob.arrayBuffer());
									
									new Notice(`Adding new Images to vault...`);
									logMsg += `Saved cropped image as ${croppedName}\n`;
									logMsg += `Saved overlay image as ${overlayName}\n`;
									
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
					img.src = e.target.result as string;
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
			};
		}

		videoEl.autoplay = true;
		videoEl.muted = true;
		const chunks: BlobPart[] = [];
		let recorder: MediaRecorder = null;
		this.videoStream = null;

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

		const cameras = (
			await navigator.mediaDevices.enumerateDevices()
		).filter((d) => d.kind === "videoinput");

		if (cameras.length <= 1) switchCameraButton.style.display = "none";
		let cameraIndex = 0;

		if (this.videoStream) {
			firstRow.style.display = "block";
			secondRow.style.display = "block";
			statusMsg.style.display = "none";
		} else {
			secondRow.style.display = "block";
			statusMsg.textContent =
				"Error in loading videostream in your device..";
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
			isImage = false,
			fileName = "",
		) => {
			if (!fileName) {
				const dateString = (new Date() + "")
					.slice(4, 28)
					.split(" ")
					.join("_")
					.split(":")
					.join("-");
				fileName = isImage
					? `image_${dateString}.png`
					: `video_${dateString}.webm`;
			}
			new Notice(`Adding new ${isImage ? "Image" : "Video"} to vault...`);

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
				isImage
					? `![${fileName}](${filePath})\n`
					: `\n![[${filePath}]]\n`,
				cursor,
			);
			this.close();
		};

		switchCameraButton.onclick = async () => {
			cameraIndex = (cameraIndex + 1) % cameras.length;
			this.videoStream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: cameras[cameraIndex].deviceId },
				audio: true,
			});
			videoEl.srcObject = this.videoStream;
			videoEl.play();
		};

		snapPhotoButton.onclick = () => {
			const canvas = webCamContainer.createEl("canvas");
			canvas.style.display = "none";
			const { videoHeight, videoWidth } = videoEl;
			canvas.height = videoHeight;
			canvas.width = videoWidth;

			canvas
				.getContext("2d")
				.drawImage(videoEl, 0, 0, videoWidth, videoHeight);
			canvas.toBlob(async (blob) => {
				const bufferFile = await blob.arrayBuffer();
				saveFile(bufferFile, true);
			}, "image/png");
		};

		videoEl.srcObject = this.videoStream;

		recordVideoButton.onclick = async () => {
			switchCameraButton.disabled = true;
			if (!recorder) {
				recorder = new MediaRecorder(this.videoStream, {
					mimeType: "video/webm",
				});
			}

			let isRecording: boolean =
				recorder && recorder.state === "recording";
			if (isRecording) {
				recorder.stop();
			} else {
				recorder.start();
			}
			isRecording = !isRecording;
			recordVideoButton.innerText = isRecording
				? "Stop Recording"
				: "Start Recording";

			recorder.ondataavailable = (e) => chunks.push(e.data);
			recorder.onstop = async (_) => {
				const blob = new Blob(chunks, {
					type: "audio/ogg; codecs=opus",
				});
				const bufferFile = await blob.arrayBuffer();
				saveFile(bufferFile, false);
			};
		};
	}

	onClose() {
		const { contentEl } = this;
		this.videoStream?.getTracks().forEach((track) => {
			track.stop();
		});
		contentEl.empty();
	}
}

export default CameraModal;
