import { Platform, Plugin } from "obsidian";
import CameraModal from "./Modal";
import CameraSettingsTab, { CameraPluginSettings, DEFAULT_SETTINGS } from "./SettingsTab";

export default class ObsidianCamera extends Plugin {
  settings: CameraPluginSettings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("camera", "JZS Auto Page Extract", (evt: MouseEvent) => {
      if (Platform.isIosApp) {
        CameraModal.triggerIosUpload(this.app, this.settings);
      } else {
        // Desktop: open system file picker and process file
        const filePicker = document.createElement("input");
        filePicker.type = "file";
        filePicker.accept = "image/*";
        filePicker.style.display = "none";
        filePicker.onchange = async () => {
          if (!filePicker.files?.length) return;
          const selectedFile = filePicker.files[0];
          const modal = new CameraModal(this.app, this.settings);
          await modal.handleUploadFile(selectedFile);
          document.body.removeChild(filePicker);
        };
        document.body.appendChild(filePicker);
        filePicker.click();
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
      name: "JZS Auto Page Extract",
      icon: "camera",
      callback: () => {
        CameraModal.triggerIosUpload(this.app, this.settings);
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
