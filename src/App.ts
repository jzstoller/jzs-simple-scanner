import { Plugin } from "obsidian";
import CameraSettingsTab, { CameraPluginSettings, DEFAULT_SETTINGS } from "./SettingsTab";
import { triggerUpload } from "./core/filePicker";
import { cleanupOpenCVLoader } from "./core/opencv-loader";

export default class ObsidianCamera extends Plugin {
  settings!: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "Simple Scanner", () => {
      triggerUpload(this.app, this.settings);
    });
    this.addSettingTab(new CameraSettingsTab(this.app, this));

    this.addCommand({
      id: "jzs-doc-upload",
      name: "Scan",
      icon: "camera",
      callback: () => {
        triggerUpload(this.app, this.settings);
      }
    });
  }

  onunload() {
    cleanupOpenCVLoader();
  }


  async loadSettings() {
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(data as Partial<CameraPluginSettings> | null)
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
