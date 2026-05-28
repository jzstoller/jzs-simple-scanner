import ObsidianCamera from "main";
import { App, PluginSettingTab, Setting } from "obsidian";

export interface CameraPluginSettings {
	chosenFolderPath: string;
	showBoundingBox: boolean;
}

export const DEFAULT_SETTINGS: CameraPluginSettings = {
	chosenFolderPath: "attachments/snaps",
	showBoundingBox: false,
};

export default class CameraSettingsTab extends PluginSettingTab {
	plugin: ObsidianCamera;

	constructor(app: App, plugin: ObsidianCamera) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Obsidian-Camera settings" });

		new Setting(containerEl)
			.setName("Folder Path")
			.setDesc("Folder where the scanned images should be saved")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
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
