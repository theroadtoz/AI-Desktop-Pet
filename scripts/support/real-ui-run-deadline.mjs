export function runWithRealUiDeadline(run, timeoutMs, dependencies = {}) {
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimer(() => reject(new Error("runner_timeout")), timeoutMs);
    timer?.unref?.();
  });

  return Promise.race([run(), deadline]).finally(() => {
    if (timer !== undefined) clearTimer(timer);
  });
}
