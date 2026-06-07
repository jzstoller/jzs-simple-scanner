import { Platform, Plugin } from "obsidian";
import CameraModal from "./Modal";
import CameraSettingsTab, { CameraPluginSettings, DEFAULT_SETTINGS } from "./SettingsTab";

export default class ObsidianCamera extends Plugin {
  settings: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "JZS Auto Page Extract", () => {
      if (Platform.isIosApp) {
        CameraModal.triggerIosUpload(this.app, this.settings);
      } else {
        CameraModal.triggerDesktopUpload(this.app, this.settings);
      }
    });
    this.addSettingTab(new CameraSettingsTab(this.app, this));

    this.addCommand({
      id: "Open camera modal",
      name: "Open camera modal / File Picker",
      icon: "camera",
      callback: () => {
        if (Platform.isIosApp) {
          CameraModal.triggerIosUpload(this.app, this.settings);
        } else {
          CameraModal.triggerDesktopUpload(this.app, this.settings);
        }
      },
    });

    this.addCommand({
      id: "jzs-doc-upload",
      name: "JZS Auto Page Extract",
      icon: "camera",
      callback: () => {
        if (Platform.isIosApp) {
          CameraModal.triggerIosUpload(this.app, this.settings);
        } else {
          CameraModal.triggerDesktopUpload(this.app, this.settings);
        }
      }
    });
  }


  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
