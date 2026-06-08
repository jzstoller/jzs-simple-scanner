import { Plugin } from "obsidian";
import CameraSettingsTab, { CameraPluginSettings, DEFAULT_SETTINGS } from "./SettingsTab";
import { triggerUpload } from "./core/filePicker";
import { cleanupOpenCVLoader } from "./core/opencv-loader";

export default class ObsidianCamera extends Plugin {
  settings: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "Simple Scanner", () => {
      triggerUpload(this.app, this.settings);
    });
    this.addSettingTab(new CameraSettingsTab(this.app, this));

    this.addCommand({
      id: "jzs-doc-upload",
      name: "Simple Scanner",
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
