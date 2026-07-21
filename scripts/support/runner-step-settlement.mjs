export async function settleActiveRunSteps(activeRunSteps, timeoutMs) {
  if (!(activeRunSteps instanceof Set) || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("invalid_runner_step_settlement_input");
  }

  const deadline = Date.now() + timeoutMs;
  while (activeRunSteps.size > 0) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { settled: false, pendingCount: activeRunSteps.size };
    }

    let timeoutHandle;
    const pending = Promise.allSettled([...activeRunSteps]);
    const settled = await Promise.race([
      pending.then(() => true),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), remainingMs);
      })
    ]);
    clearTimeout(timeoutHandle);
    if (!settled) {
      return { settled: false, pendingCount: activeRunSteps.size };
    }
  }

  return { settled: true, pendingCount: 0 };
}
