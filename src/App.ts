import { Plugin } from "obsidian";
import ConfigTab, {
	CameraPluginSettings,
	DEFAULT_SETTINGS,
} from "./ConfigTab";
import { triggerUpload } from "./core/filePicker";
import { initScanic } from "./core/scanic-loader";

export default class SimpleScanner extends Plugin {
	settings!: CameraPluginSettings;
	async onload() {
		await this.loadSettings();

		// Initialize Scanic once on plugin load
		await initScanic();

		this.addRibbonIcon("camera", "Simple Scanner", () => {
			triggerUpload(this.app, this.settings);
		});
		this.addSettingTab(new ConfigTab(this.app, this));

		this.addCommand({
			id: "jzs-doc-upload",
			name: "Scan",
			icon: "camera",
			callback: () => {
				triggerUpload(this.app, this.settings);
			},
		});
	}

	onunload() {
		//nothing to do
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...(data as Partial<CameraPluginSettings> | null),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
