const TICKS_PATTERN = /^\d{1,20}$/u;
const ROLES = new Set(["root", "descendant"]);

export function parseOwnedProcessIdentities(value) {
  if (!Array.isArray(value)) throw new TypeError("invalid_owned_process_identities");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      Object.keys(item).length !== 3 ||
      !Number.isSafeInteger(item.pid) || item.pid <= 0 ||
      typeof item.creationTimeUtcTicks !== "string" || !TICKS_PATTERN.test(item.creationTimeUtcTicks) ||
      !ROLES.has(item.role)) {
      throw new TypeError("invalid_owned_process_identity");
    }
    return { pid: item.pid, creationTimeUtcTicks: item.creationTimeUtcTicks, role: item.role };
  });
}

export function isSameOwnedProcessIdentity(expected, current) {
  return Boolean(expected && current &&
    expected.pid === current.pid &&
    expected.creationTimeUtcTicks === current.creationTimeUtcTicks);
}

export function selectInitialOwnedRootIdentity(input) {
  if (!Number.isSafeInteger(input?.pid) || input.pid <= 0) {
    throw new TypeError("invalid_initial_owned_root_capture");
  }
  const identities = parseOwnedProcessIdentities(input.identities);
  return identities.find((identity) => identity.role === "root" && identity.pid === input.pid) ?? null;
}

export function mergeOwnedProcessIdentities(left, right) {
  const merged = new Map();
  for (const identity of [...left, ...right]) {
    const key = `${identity.pid}:${identity.creationTimeUtcTicks}`;
    const existing = merged.get(key);
    merged.set(key, existing?.role === "root" ? existing : identity);
  }
  return [...merged.values()];
}

export function summarizeOwnedProcessSurvivors(identities) {
  const rootAlive = identities.some(({ role }) => role === "root");
  const descendantAliveCount = identities.filter(({ role }) => role === "descendant").length;
  return { survivorCount: identities.length, rootAlive, descendantAliveCount };
}

export function isTaskkillFailureIdempotent(identity, survivors) {
  return !survivors.some((current) => isSameOwnedProcessIdentity(identity, current));
}
