export function parentProcessAlive(pid, kill = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function closeGatewayWhenParentExits({ server, parentPID, intervalMs = 2_000, kill = process.kill, exit = process.exit, setIntervalFn = setInterval, clearIntervalFn = clearInterval, setTimeoutFn = setTimeout }) {
  if (!server || !Number.isSafeInteger(parentPID) || parentPID <= 0) return null;
  let closing = false;
  const check = () => {
    if (closing || parentProcessAlive(parentPID, kill)) return;
    closing = true;
    clearIntervalFn(timer);
    server.close(() => exit(0));
    const forcedExit = setTimeoutFn(() => exit(0), 2_000);
    forcedExit?.unref?.();
  };
  const timer = setIntervalFn(check, Math.max(100, Number(intervalMs) || 2_000));
  timer?.unref?.();
  server.once?.("close", () => clearIntervalFn(timer));
  return Object.freeze({ check, stop: () => clearIntervalFn(timer) });
}
