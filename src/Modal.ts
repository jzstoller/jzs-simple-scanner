import { App, MarkdownView, Modal, Notice, Platform } from "obsidian";
import { CameraPluginSettings } from "./ConfigTab";
import { scanBlob } from "./core/scanic-loader";

async function appendToLogFile(app: App, message: string) {
	void app;
	void message;
}

class CameraModal extends Modal {
	chosenFolderPath: string;
	cameraSettings: CameraPluginSettings;
	videoStream: MediaStream | null = null;
	constructor(app: App, cameraSettings: CameraPluginSettings) {
		super(app);
		this.chosenFolderPath = cameraSettings.chosenFolderPath;
		this.cameraSettings = cameraSettings;
	}

	async onOpen() {
		const { contentEl } = this;
		const webCamContainer = contentEl.createDiv();

		const statusMsg = webCamContainer.createEl("span", {
			text: "Loading..",
		});
		let videoEl: HTMLVideoElement;
		let switchCameraButton: HTMLButtonElement | null = null;
		const buttonsDiv = webCamContainer.createDiv();
		const firstRow = buttonsDiv.createDiv();
		const secondRow = buttonsDiv.createDiv();

		if (!Platform.isIosApp) {
			videoEl = webCamContainer.createEl("video");
			switchCameraButton = firstRow.createEl("button", {
				text: "Switch Camera",
			});
			videoEl.autoplay = true;
			videoEl.muted = true;
		}
		firstRow.addClass("jzs-hidden");
		secondRow.addClass("jzs-hidden");

		const filePicker = secondRow.createEl("input", {
			placeholder: "Choose image file from system",
			type: "file",
		});
		filePicker.id = "filepicker";
		filePicker.accept = "image/*";

		filePicker.addClass("jzs-hidden");

		const label = secondRow.createEl("label");
		label.textContent = "Upload";
		label.addClass("jzs-upload-label");

		label.htmlFor = "filepicker";
		label.setText("↑ Upload");

		label.appendChild(filePicker);

		secondRow.appendChild(label);


		this.videoStream = null;
		let cameraIndex = 0;
		let cameras: MediaDeviceInfo[] = [];

		if (!Platform.isIosApp) {
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

			if (cameras.length <= 1 && switchCameraButton) switchCameraButton.addClass("jzs-hidden");

			if (this.videoStream) {
				firstRow.addClass("jzs-visible");
				secondRow.addClass("jzs-visible");
				statusMsg.addClass("jzs-hidden");
			} else {
				secondRow.addClass("jzs-visible");
				statusMsg.textContent =
					"Error in loading videostream in your device..";
			}
		} else {
			// iOS: Show only the Scan button and Upload button
			firstRow.addClass("jzs-hidden");
			secondRow.addClass("jzs-visible");
			statusMsg.addClass("jzs-hidden");

		}

		const handleImageSelectChange = async (
			file: File,
			isImage: boolean = true,
		) => {
			const chosenFile = file;
			const bufferFile = await chosenFile.arrayBuffer();
			await saveFile(bufferFile, isImage, chosenFile.name.split(" ").join("-"));
		};

		filePicker.onchange = async () => {
			if (!filePicker.files?.length) return;
			const selectedFile = filePicker.files[0];
			label.textContent = `Selected: ${selectedFile.name}`;
			const isImage = selectedFile.type.startsWith("image/");
			await handleImageSelectChange(selectedFile, isImage);
		};

		const saveFile = async (
			file: ArrayBuffer,
			isImage = true,
			fileName = "",
		) => {
			if (!fileName) {

				const dateString = new Date().toISOString().replace(/[:.]/g, "-");

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

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
			switchCameraButton!.onclick = async () => {
				cameraIndex = (cameraIndex + 1) % cameras.length;
				this.videoStream = await navigator.mediaDevices.getUserMedia({
					video: { deviceId: cameras[cameraIndex].deviceId },
				});
				videoEl!.srcObject = this.videoStream;
				await videoEl!.play();
			};

			videoEl!.srcObject = this.videoStream;
		}

	}

	onClose() {
		const { contentEl } = this;
		this.videoStream?.getTracks().forEach((track) => {
			track.stop();
		});
		contentEl.empty();
	}

	async handleUploadFile(selectedFile: File) {
		try {
			new Notice("Scanning image...");

			// Run Scanic on the uploaded file
			const pngDataUrl = await scanBlob(selectedFile as Blob);

			// Convert data URL → ArrayBuffer
			const arrayBuffer = await (await fetch(pngDataUrl)).arrayBuffer();

			// Build file path
			const fileName = `scan-${Date.now()}.png`;
			const filePath = `${this.chosenFolderPath}/${fileName}`;

			// Ensure folder exists
			const folder = this.app.vault.getAbstractFileByPath(this.chosenFolderPath);
			if (!folder) {
				await this.app.vault.createFolder(this.chosenFolderPath);
			}

			// Save scanned PNG
			await this.app.vault.createBinary(filePath, arrayBuffer);

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				await appendToLogFile(
					this.app,
					`[handleUploadFile] inserting scanned image for ${fileName}`,
				);
				const cursor = view.editor.getCursor();
				view.editor.replaceRange(`![${fileName}](${filePath})\n`, cursor);
			} else {
				new Notice(`Saved scanned image to ${filePath}`);
			}

			// Close modal
			this.close();
		} catch (error) {
			console.error("Scanic upload failed:", error);
			new Notice("Scan failed. Check the console for details.");
			throw error;
		}
	}
}

export default CameraModal;
