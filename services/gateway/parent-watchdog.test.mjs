import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { closeGatewayWhenParentExits, parentProcessAlive } from "./parent-watchdog.mjs";

test("gateway parent watchdog treats permission denial as alive", () => {
  assert.equal(parentProcessAlive(81, () => { const error = new Error("denied"); error.code = "EPERM"; throw error; }), true);
  assert.equal(parentProcessAlive(81, () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; }), false);
  assert.equal(parentProcessAlive(0), false);
});

test("gateway parent crash closes the child once and cancels its poller", () => {
  const server = new EventEmitter();
  let closes = 0;
  let exits = 0;
  let cleared = 0;
  let scheduled;
  server.close = (done) => { closes += 1; done(); };
  const watchdog = closeGatewayWhenParentExits({
    server,
    parentPID: 82,
    kill: () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; },
    exit: () => { exits += 1; },
    setIntervalFn: (callback) => { scheduled = callback; return { unref() {} }; },
    clearIntervalFn: () => { cleared += 1; },
    setTimeoutFn: () => ({ unref() {} }),
  });
  watchdog.check();
  scheduled();
  assert.equal(closes, 1);
  assert.equal(exits, 1);
  assert.ok(cleared >= 1);
});

test("gateway parent watchdog leaves a live owner and child untouched", () => {
  const server = new EventEmitter();
  let closes = 0;
  server.close = () => { closes += 1; };
  const watchdog = closeGatewayWhenParentExits({
    server,
    parentPID: 83,
    kill: () => {},
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  watchdog.check();
  assert.equal(closes, 0);
  watchdog.stop();
});
