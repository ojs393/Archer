import { beforeEach, describe, expect, it, vi } from "vitest";
import { Watchdog, type WatchedWorker, type WatchdogOptions } from "../../server/send/watchdog.ts";

type Activity = ReturnType<WatchedWorker["getActivity"]>;

const T0 = 1_800_000_000_000;

class FakeWorker implements WatchedWorker {
  activity: Activity = {
    campaignId: 1,
    status: "running",
    heartbeatAt: T0,
    inFlightSince: null,
    expectedWakeAt: null,
    delaySeconds: 1,
    loopRunning: true,
  };
  calls: string[] = [];
  getActivity(): Activity {
    return { ...this.activity };
  }
  restartLoop(reason: string): void {
    this.calls.push(`restartLoop:${reason}`);
    this.activity.heartbeatAt = clock;
    this.activity.inFlightSince = null;
    this.activity.loopRunning = true;
  }
  rebuildTransport(): void {
    this.calls.push("rebuildTransport");
  }
  wake(reason: string): void {
    this.calls.push(`wake:${reason}`);
  }
  pause(reason: string): void {
    this.calls.push(`pause:${reason}`);
    this.activity.status = "paused";
  }
}

let clock: number;
let worker: FakeWorker;
let logs: string[];

function watchdog(opts: WatchdogOptions = {}): Watchdog {
  return new Watchdog(worker, { now: () => clock, onLog: (m) => logs.push(m), ...opts });
}

function stall(dog: Watchdog): void {
  worker.activity.loopRunning = false;
  dog.tick();
}

beforeEach(() => {
  clock = T0;
  worker = new FakeWorker();
  logs = [];
});

describe("Watchdog — stall detection", () => {
  it("does nothing while the worker is inside its thresholds", () => {
    const dog = watchdog();
    for (let i = 0; i < 12; i++) {
      clock += 5_000;
      worker.activity.heartbeatAt = clock - 1_000;
      dog.tick();
    }
    worker.activity.inFlightSince = clock - 150_000;
    dog.tick();
    worker.activity.inFlightSince = null;
    worker.activity.heartbeatAt = clock - 63_000;
    dog.tick();
    expect(worker.calls).toEqual([]);
  });

  it("restarts the loop when a send has been in flight past the send timeout plus 30 s", () => {
    const dog = watchdog({ sendTimeoutMs: 120_000 });
    worker.activity.inFlightSince = clock;
    clock += 150_001;
    worker.activity.heartbeatAt = clock;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: send_stalled"]);
    expect(logs.some((m) => /send_stalled/.test(m))).toBe(true);
  });

  it("restarts the loop when the heartbeat goes stale with nothing in flight", () => {
    const dog = watchdog();
    clock += 63_001;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_stalled"]);
  });

  it("measures idle staleness from the expected wake time of a nap", () => {
    const dog = watchdog({ clockJumpMs: Infinity });
    worker.activity.expectedWakeAt = T0 + 3_600_000;
    clock += 3_600_000;
    dog.tick();
    expect(worker.calls).toEqual([]);
    clock += 63_001;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_stalled"]);
  });

  it("scales the idle threshold with the inter-send delay", () => {
    const dog = watchdog();
    worker.activity.delaySeconds = 120;
    clock += 420_000;
    dog.tick();
    expect(worker.calls).toEqual([]);
    clock += 1;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_stalled"]);
  });

  it("uses the 60 s floor when no delay is known", () => {
    const dog = watchdog();
    worker.activity.delaySeconds = null;
    clock += 60_000;
    dog.tick();
    expect(worker.calls).toEqual([]);
    clock += 1;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_stalled"]);
  });

  it("restarts the loop when the campaign is active but the loop is not running", () => {
    const dog = watchdog();
    worker.activity.status = "waiting_network";
    worker.activity.loopRunning = false;
    dog.tick();
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_not_running"]);
  });

  it.each(["paused", "safety_stop", "completed", "stopped", "draft", null])("ignores a worker whose status is %s", (status) => {
    const dog = watchdog();
    worker.activity.status = status;
    worker.activity.loopRunning = false;
    worker.activity.inFlightSince = T0;
    clock += 10_000_000;
    dog.tick();
    expect(worker.calls).toEqual([]);
  });
});

describe("Watchdog — giving up", () => {
  it("pauses with watchdog_giveup on the 4th recovery within 10 minutes and does not restart", () => {
    const dog = watchdog({ clockJumpMs: Infinity });
    for (let i = 0; i < 3; i++) {
      stall(dog);
      clock += 150_000;
    }
    stall(dog);
    expect(worker.calls).toEqual([
      "restartLoop:watchdog: loop_not_running",
      "restartLoop:watchdog: loop_not_running",
      "restartLoop:watchdog: loop_not_running",
      "pause:watchdog_giveup",
    ]);
    expect(logs.some((m) => /watchdog_giveup|giving up/i.test(m))).toBe(true);
  });

  it("does not count recoveries older than the window", () => {
    const dog = watchdog({ clockJumpMs: Infinity });
    for (let i = 0; i < 3; i++) {
      stall(dog);
      clock += 1_000;
    }
    clock = T0 + 600_001;
    stall(dog);
    expect(worker.calls.filter((c) => c.startsWith("restartLoop"))).toHaveLength(4);
    expect(worker.calls).not.toContain("pause:watchdog_giveup");
  });

  it("noteProgress clears recovery debt so a later stall does not give up early", () => {
    const dog = watchdog({ maxRecoveries: 2, clockJumpMs: Infinity });
    stall(dog);
    stall(dog);
    dog.noteProgress();
    worker.activity.status = "running";
    worker.activity.loopRunning = false;
    dog.tick();
    expect(worker.calls.filter((c) => c.startsWith("restartLoop"))).toHaveLength(3);
    expect(worker.calls).not.toContain("pause:watchdog_giveup");
  });

  it("gives a campaign resumed after a give-up fresh recoveries", () => {
    const dog = watchdog({ maxRecoveries: 1 });
    stall(dog);
    stall(dog);
    worker.activity.status = "running";
    stall(dog);
    expect(worker.calls).toEqual([
      "restartLoop:watchdog: loop_not_running",
      "pause:watchdog_giveup",
      "restartLoop:watchdog: loop_not_running",
    ]);
  });

  it("honours custom maxRecoveries and recoveryWindowMs", () => {
    const dog = watchdog({ maxRecoveries: 1, recoveryWindowMs: 10_000 });
    stall(dog);
    clock += 9_999;
    stall(dog);
    expect(worker.calls).toEqual(["restartLoop:watchdog: loop_not_running", "pause:watchdog_giveup"]);
  });
});

describe("Watchdog — clock jumps", () => {
  it("rebuilds the transport and wakes the worker after a forward jump, without a stall restart or a recovery", () => {
    const dog = watchdog();
    dog.tick();
    clock += 2 * 3_600_000;
    worker.activity.inFlightSince = T0;
    dog.tick();
    expect(worker.calls).toEqual(["rebuildTransport", "wake:clock_jump"]);
    expect(logs.some((m) => /clock/i.test(m))).toBe(true);

    worker.calls = [];
    worker.activity.inFlightSince = null;
    for (let i = 0; i < 3; i++) {
      stall(dog);
      clock += 1_000;
    }
    expect(worker.calls.filter((c) => c.startsWith("restartLoop"))).toHaveLength(3);
    expect(worker.calls).not.toContain("pause:watchdog_giveup");
  });

  it("treats a backward jump as a clock jump too", () => {
    const dog = watchdog();
    dog.tick();
    clock -= 3_600_000;
    dog.tick();
    expect(worker.calls).toEqual(["rebuildTransport", "wake:clock_jump"]);
  });

  it("does not see a jump on the first tick or on normal tick spacing", () => {
    const dog = watchdog({ intervalMs: 5_000, clockJumpMs: 30_000 });
    clock += 1_000_000;
    worker.activity.heartbeatAt = clock;
    dog.tick();
    clock += 35_000;
    worker.activity.heartbeatAt = clock;
    dog.tick();
    expect(worker.calls).toEqual([]);
  });
});

describe("Watchdog — robustness and timers", () => {
  it("logs and survives a worker that throws", () => {
    const dog = watchdog();
    worker.getActivity = () => {
      throw new Error("db locked");
    };
    expect(() => dog.tick()).not.toThrow();
    expect(logs.some((m) => /db locked/.test(m))).toBe(true);
  });

  it("ticks on its interval after start and stops ticking after stop", () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const read = worker.getActivity.bind(worker);
      worker.getActivity = () => {
        reads += 1;
        return read();
      };
      const dog = watchdog({ intervalMs: 5_000 });
      dog.start();
      dog.start();
      vi.advanceTimersByTime(15_000);
      expect(reads).toBe(3);
      dog.stop();
      vi.advanceTimersByTime(15_000);
      expect(reads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
