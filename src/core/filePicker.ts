import { App, Platform } from "obsidian";
import CameraModal from "../Modal";
import { CameraPluginSettings } from "../SettingsTab";

type PickerHandler = (selectedFile: File) => Promise<void>;

function openHiddenFilePicker(
	onSelect: PickerHandler,
	capture?: string,
) {
	const filePicker = document.createElement("input");
	filePicker.type = "file";
	filePicker.accept = "image/*";
	filePicker.addClass("jzs-hidden");
	if (capture) {
		filePicker.capture = capture;
	}

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
		await onSelect(filePicker.files[0]);
	};

	document.body.appendChild(filePicker);
	window.addEventListener("focus", handleWindowFocus, { once: true });
	filePicker.click();
}

export function triggerIosUpload(app: App, cameraSettings: CameraPluginSettings) {
	if (!Platform.isIosApp) return;

	openHiddenFilePicker(async (selectedFile) => {
		const modal = new CameraModal(app, cameraSettings);
		await modal.handleUploadFile(selectedFile);
	});
}

export function triggerDesktopUpload(app: App, cameraSettings: CameraPluginSettings) {
	if (Platform.isIosApp) return;

	openHiddenFilePicker(async (selectedFile) => {
		const modal = new CameraModal(app, cameraSettings);
		await modal.handleUploadFile(selectedFile);
	});
}

export function triggerUpload(app: App, cameraSettings: CameraPluginSettings) {
	if (Platform.isIosApp) {
		triggerIosUpload(app, cameraSettings);
		return;
	}

	triggerDesktopUpload(app, cameraSettings);
}