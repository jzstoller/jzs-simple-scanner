import { Plugin } from "obsidian";
import CameraSettingsTab, { CameraPluginSettings, DEFAULT_SETTINGS } from "./SettingsTab";
import { cleanupOpenCVLoader } from "./core/opencv-loader";
import { triggerUpload } from "./core/filePicker";

export default class ObsidianCamera extends Plugin {
  settings: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "JZS Auto Page Extract", () => {
      triggerUpload(this.app, this.settings);
    });
    this.addSettingTab(new CameraSettingsTab(this.app, this));

    this.addCommand({
      id: "Open camera modal",
      name: "Open camera modal / File Picker",
      icon: "camera",
      callback: () => {
        triggerUpload(this.app, this.settings);
      },
    });

    this.addCommand({
      id: "jzs-doc-upload",
      name: "JZS Auto Page Extract",
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
