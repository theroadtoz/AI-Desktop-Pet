import { app } from "electron";
import { join } from "node:path";

const windowIconName = "app-icon-256.png";

export function getWindowIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icons", windowIconName);
  }

  return join(app.getAppPath(), "resources", "icons", windowIconName);
}
