import { contextBridge, ipcRenderer } from "electron";
import type { PhoneCharmApi, PhoneCharmWindowMotion } from "../shared/phone-charm-motion";

const phoneCharmApi: PhoneCharmApi = {
  onWindowMotion(handler) {
    const listener = (_event: Electron.IpcRendererEvent, motion: PhoneCharmWindowMotion) => {
      handler(motion);
    };
    ipcRenderer.on("phone-charm:window-motion", listener);
    return () => ipcRenderer.removeListener("phone-charm:window-motion", listener);
  }
};

contextBridge.exposeInMainWorld("phoneCharmApi", phoneCharmApi);
