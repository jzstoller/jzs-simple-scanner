import { Plugin, Platform } from "obsidian";
import CameraModal from "./Modal";
import CameraSettingsTab, { DEFAULT_SETTINGS, CameraPluginSettings } from "./SettingsTab";

export default class ObsidianCamera extends Plugin {
  settings: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "JZS Doc Scan", (evt: MouseEvent) => {
      if (Platform.isIosApp) {
        CameraModal.triggerIosScan(this.app, this.settings);
      } else {
        new CameraModal(this.app, this.settings).open();
      }
    });
    this.addRibbonIcon("arrow-up", "JZS Doc Upload", (evt: MouseEvent) => {
      if (Platform.isIosApp) {
        CameraModal.triggerIosUpload(this.app, this.settings);
      } else {
        new CameraModal(this.app, this.settings, true).open();
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
          new CameraModal(this.app, this.settings).open();
        }
      },
    });

    this.addCommand({
      id: "jzs-doc-upload",
      name: "JZS Doc Upload",
      icon: "scan",
      callback: () => {
        if (Platform.isIosApp) {
          CameraModal.triggerIosUpload(this.app, this.settings);
        } else {
          new CameraModal(this.app, this.settings, true).open();
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
