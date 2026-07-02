const localLlmExtraResourcesRoot = ".tmp/p2-20j-extra-resources/local-llm";
const windowsIcon = "resources/icons/app-icon.ico";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.ai-desktop-pet.app",
  productName: "AI Desktop Pet",
  copyright: "Copyright © 2026 AI Desktop Pet Project",
  artifactName: "${productName}-${version}-${arch}.${ext}",
  directories: {
    output: ".tmp/p2-20j-package-output"
  },
  files: [
    "dist/**/*",
    "package.json",
    "node_modules/pangu/**/*"
  ],
  extraResources: [
    {
      from: localLlmExtraResourcesRoot,
      to: "local-llm"
    },
    {
      from: "resources/icons/app-icon-256.png",
      to: "icons/app-icon-256.png"
    }
  ],
  win: {
    icon: windowsIcon,
    target: [
      {
        target: "dir",
        arch: ["x64"]
      },
      {
        target: "portable",
        arch: ["x64"]
      },
      {
        target: "nsis",
        arch: ["x64"]
      }
    ]
  },
  nsis: {
    artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    shortcutName: "AI Desktop Pet"
  },
  portable: {
    artifactName: "${productName}-Portable-${version}-${arch}.${ext}"
  },
  npmRebuild: false
};
