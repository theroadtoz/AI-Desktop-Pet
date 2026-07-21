export function createWindowsNativeClickArgs(input) {
  if (!/^\d{1,20}$/u.test(input.expectedHwnd) ||
    !Number.isSafeInteger(input.expectedPid) || input.expectedPid <= 0 ||
    !Number.isFinite(input.clientX) || input.clientX < 0 ||
    !Number.isFinite(input.clientY) || input.clientY < 0 ||
    !Number.isFinite(input.deviceScaleFactor) ||
    input.deviceScaleFactor < 0.5 || input.deviceScaleFactor > 8) {
    throw new TypeError("invalid_native_click_target");
  }
  return [
    "-ExpectedHwnd", input.expectedHwnd,
    "-ExpectedPid", String(input.expectedPid),
    "-ClientX", String(input.clientX),
    "-ClientY", String(input.clientY),
    "-DeviceScaleFactor", String(input.deviceScaleFactor)
  ];
}

export function isExpectedNativePointTarget(input) {
  return /^\d{1,20}$/u.test(input.targetHwnd) && input.targetHwnd !== "0" &&
    /^\d{1,20}$/u.test(input.targetRootHwnd) &&
    /^\d{1,20}$/u.test(input.expectedHwnd) &&
    Number.isSafeInteger(input.targetRootPid) && input.targetRootPid > 0 &&
    Number.isSafeInteger(input.expectedPid) && input.expectedPid > 0 &&
    input.targetRootHwnd === input.expectedHwnd &&
    input.targetRootPid === input.expectedPid;
}
