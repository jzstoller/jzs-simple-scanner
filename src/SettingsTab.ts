import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

export interface CameraPluginSettings {
	chosenFolderPath: string;
	showBoundingBox: boolean;
}

export const DEFAULT_SETTINGS: CameraPluginSettings = {
	chosenFolderPath: "attachments/snaps",
	showBoundingBox: false,
};

export interface CameraPluginHost {
	settings: CameraPluginSettings;
	saveSettings(): Promise<void>;
}

export default class ConfigTab extends PluginSettingTab {
	plugin: CameraPluginHost;

	constructor(app: App, plugin: CameraPluginHost) {
		super(app, plugin as unknown as Plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Scan Options")
			.setHeading();

		new Setting(containerEl)
			.setName("Folder Path")
			.setDesc("Folder where the scanned images should be saved")
			.addText((text) =>
				text
					.setPlaceholder("e.g. attachments/snaps")
					.setValue(this.plugin.settings.chosenFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.chosenFolderPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Save edge detection overlay")
			.setDesc("Save an additional image showing detected document edges")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showBoundingBox)
					.onChange(async (value) => {
						this.plugin.settings.showBoundingBox = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
