const localLlmExtraResourcesRoot = ".tmp/p2-20j-extra-resources/local-llm";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.ai-desktop-pet.app",
  productName: "AI Desktop Pet",
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
    }
  ],
  win: {
    target: [
      {
        target: "dir",
        arch: ["x64"]
      }
    ]
  },
  npmRebuild: false
};
