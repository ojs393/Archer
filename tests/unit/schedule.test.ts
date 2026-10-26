import { describe, it, expect } from "vitest";
import {
  WARMUP_START,
  defaultSchedule,
  validateSchedule,
  warmupQuota,
  localDateKey,
  isWithinWindow,
  windowBounds,
  nextSendTime,
  estimateSchedule,
  type Schedule,
} from "../../server/domain/schedule.ts";

const NY = "America/New_York";

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return { ...defaultSchedule(NY), ...overrides };
}

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

describe("defaultSchedule", () => {
  it("is Mon–Fri 09:00–17:00, cap 2000, warm-up on, 10s delay", () => {
    expect(defaultSchedule("Europe/Berlin")).toEqual({
      timezone: "Europe/Berlin",
      sendDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "17:00",
      dailyCap: 2000,
      warmup: true,
      delaySeconds: 10,
    });
  });

  it("is valid", () => {
    expect(validateSchedule(defaultSchedule(NY))).toEqual([]);
  });
});

describe("validateSchedule", () => {
  const invalid: [string, Partial<Schedule>][] = [
    ["unknown zone", { timezone: "Mars/Olympus" }],
    ["empty zone", { timezone: "" }],
    ["no send days", { sendDays: [] }],
    ["duplicate days", { sendDays: [1, 1, 2] }],
    ["day above 6", { sendDays: [1, 7] }],
    ["negative day", { sendDays: [-1] }],
    ["fractional day", { sendDays: [1.5] }],
    ["bad start format", { startTime: "9:00" }],
    ["start hour 24", { startTime: "24:00" }],
    ["bad end minutes", { endTime: "17:60" }],
    ["end equals start", { startTime: "09:00", endTime: "09:00" }],
    ["end before start", { startTime: "22:00", endTime: "06:00" }],
    ["cap 0", { dailyCap: 0 }],
    ["cap above 100000", { dailyCap: 100_001 }],
    ["fractional cap", { dailyCap: 10.5 }],
    ["delay 0", { delaySeconds: 0 }],
    ["delay above 3600", { delaySeconds: 3601 }],
  ];
  for (const [label, overrides] of invalid) {
    it(`rejects ${label}`, () => {
      expect(validateSchedule(schedule(overrides)).length).toBeGreaterThan(0);
    });
  }

  it("reports each problem separately", () => {
    const errors = validateSchedule(schedule({ timezone: "Nope/Nope", dailyCap: 0, delaySeconds: 0 }));
    expect(errors).toHaveLength(3);
  });

  it("accepts boundary values", () => {
    expect(
      validateSchedule(
        schedule({ sendDays: [0, 6], startTime: "00:00", endTime: "23:59", dailyCap: 100_000, delaySeconds: 3600 }),
      ),
    ).toEqual([]);
    expect(validateSchedule(schedule({ dailyCap: 1, delaySeconds: 1 }))).toEqual([]);
  });
});

describe("warmupQuota", () => {
  it("starts at WARMUP_START and doubles each send day until the cap", () => {
    expect(WARMUP_START).toBe(50);
    const sequence = Array.from({ length: 8 }, (_, i) => warmupQuota(i, 2000, true));
    expect(sequence).toEqual([50, 100, 200, 400, 800, 1600, 2000, 2000]);
  });

  it("never exceeds a small cap", () => {
    expect(warmupQuota(0, 30, true)).toBe(30);
  });

  it("stays at the cap for very large indexes", () => {
    expect(warmupQuota(5000, 2000, true)).toBe(2000);
  });

  it("returns the cap when warm-up is off", () => {
    expect(warmupQuota(0, 2000, false)).toBe(2000);
  });
});

describe("localDateKey", () => {
  it("differs by zone near midnight UTC", () => {
    const instant = at("2026-10-26T02:00:00Z");
    expect(localDateKey(instant, NY)).toBe("2026-10-25");
    expect(localDateKey(instant, "UTC")).toBe("2026-10-26");
    expect(localDateKey(at("2026-10-25T23:00:00Z"), "Asia/Tokyo")).toBe("2026-10-26");
    expect(localDateKey(at("2026-10-25T23:00:00Z"), "America/Los_Angeles")).toBe("2026-10-25");
  });
});

describe("windowBounds", () => {
  it("converts local window times to UTC instants", () => {
    const { start, end } = windowBounds("2026-10-26", schedule());
    expect(start.toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T21:00:00.000Z");
  });

  it("tracks the offset change across the spring-forward week", () => {
    expect(windowBounds("2026-03-06", schedule()).start.toISOString()).toBe("2026-03-06T14:00:00.000Z");
    expect(windowBounds("2026-03-09", schedule()).start.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("is 8h real elapsed for 09:00–17:00 on the spring-forward day", () => {
    const { start, end } = windowBounds("2026-03-08", schedule());
    expect(start.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(8 * HOUR);
  });

  it("is 8h real elapsed for 09:00–17:00 on the fall-back day", () => {
    const { start, end } = windowBounds("2026-11-01", schedule());
    expect(start.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(8 * HOUR);
  });

  it("is 1h real elapsed for 01:30–03:30 across the spring-forward gap", () => {
    const { start, end } = windowBounds("2026-03-08", schedule({ startTime: "01:30", endTime: "03:30" }));
    expect(start.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(end.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("moves a start inside the spring-forward gap to the first valid instant after it", () => {
    const { start } = windowBounds("2026-03-08", schedule({ startTime: "02:30", endTime: "05:00" }));
    expect(start.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("uses the first occurrence of an ambiguous fall-back time", () => {
    const { start, end } = windowBounds("2026-11-01", schedule({ startTime: "01:30", endTime: "03:30" }));
    expect(start.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(3 * HOUR);
  });

  it("handles zones east of UTC across their own DST change", () => {
    const { start, end } = windowBounds("2026-03-29", schedule({ timezone: "Europe/Berlin", startTime: "01:30", endTime: "03:30" }));
    expect(start.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("isWithinWindow", () => {
  const s = schedule();

  it("includes the start instant and excludes the end instant", () => {
    expect(isWithinWindow(at("2026-10-26T13:00:00Z"), s)).toBe(true);
    expect(isWithinWindow(at("2026-10-26T20:59:59Z"), s)).toBe(true);
    expect(isWithinWindow(at("2026-10-26T21:00:00Z"), s)).toBe(false);
    expect(isWithinWindow(at("2026-10-26T12:59:59Z"), s)).toBe(false);
  });

  it("is false on a non-send day during window hours", () => {
    expect(isWithinWindow(at("2026-10-25T15:00:00Z"), s)).toBe(false);
  });

  it("uses the local weekday, not the UTC weekday", () => {
    const sundayOnly = schedule({ sendDays: [0], startTime: "20:00", endTime: "23:00" });
    expect(isWithinWindow(at("2026-10-26T01:00:00Z"), sundayOnly)).toBe(true);
  });
});

describe("nextSendTime", () => {
  const s = schedule();

  it("returns the same instant when inside the window", () => {
    const now = at("2026-10-26T15:12:34.567Z");
    expect(nextSendTime(now, s).getTime()).toBe(now.getTime());
  });

  it("returns today's start when before the window on a send day", () => {
    expect(nextSendTime(at("2026-10-26T10:00:00Z"), s).toISOString()).toBe("2026-10-26T13:00:00.000Z");
  });

  it("returns the next day's start when after today's window", () => {
    expect(nextSendTime(at("2026-10-26T21:00:00Z"), s).toISOString()).toBe("2026-10-27T13:00:00.000Z");
  });

  it("returns Monday start on a Friday evening, across the fall-back weekend", () => {
    const fridayEvening = at("2026-10-30T22:00:00Z");
    expect(nextSendTime(fridayEvening, s).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("returns Monday start during the weekend", () => {
    expect(nextSendTime(at("2026-10-24T15:00:00Z"), s).toISOString()).toBe("2026-10-26T13:00:00.000Z");
  });

  it("handles a zone with a non-hour offset", () => {
    const kolkata = schedule({ timezone: "Asia/Kolkata" });
    expect(nextSendTime(at("2026-10-26T03:00:00Z"), kolkata).toISOString()).toBe("2026-10-26T03:30:00.000Z");
  });

  it("throws instead of looping when there are no send days", () => {
    expect(() => nextSendTime(at("2026-10-26T10:00:00Z"), schedule({ sendDays: [] }))).toThrow();
  });
});

describe("estimateSchedule", () => {
  const noWarmup = schedule({ warmup: false, dailyCap: 2000 });

  it("returns an empty estimate when nothing remains", () => {
    expect(estimateSchedule({ remaining: 0, schedule: noWarmup, now: at("2026-10-26T12:00:00Z") })).toEqual({
      perDay: [],
      completionDate: null,
      totalDays: 0,
    });
  });

  it("finishes 1000 at cap 2000 without warm-up in one day when the window allows", () => {
    const estimate = estimateSchedule({ remaining: 1000, schedule: noWarmup, now: at("2026-10-26T12:00:00Z") });
    expect(estimate.perDay).toEqual([{ date: "2026-10-26", count: 1000 }]);
    expect(estimate.completionDate).toBe("2026-10-26");
    expect(estimate.totalDays).toBe(1);
  });

  it("limits each day by window seconds / delay and skips the weekend", () => {
    const slow = schedule({ warmup: false, dailyCap: 2000, delaySeconds: 30 });
    const estimate = estimateSchedule({ remaining: 1000, schedule: slow, now: at("2026-10-30T12:00:00Z") });
    expect(estimate.perDay).toEqual([
      { date: "2026-10-30", count: 960 },
      { date: "2026-11-02", count: 40 },
    ]);
    expect(estimate.completionDate).toBe("2026-11-02");
    expect(estimate.totalDays).toBe(2);
  });

  it("limits each day by the daily cap", () => {
    const capped = schedule({ warmup: false, dailyCap: 300, delaySeconds: 1 });
    const estimate = estimateSchedule({ remaining: 700, schedule: capped, now: at("2026-10-26T12:00:00Z") });
    expect(estimate.perDay.map((d) => d.count)).toEqual([300, 300, 100]);
  });

  it("progresses the warm-up index per send day across weekends", () => {
    const warm = schedule({ warmup: true, dailyCap: 2000, delaySeconds: 1 });
    const estimate = estimateSchedule({ remaining: 1000, schedule: warm, now: at("2026-10-23T12:00:00Z") });
    expect(estimate.perDay).toEqual([
      { date: "2026-10-23", count: 50 },
      { date: "2026-10-26", count: 100 },
      { date: "2026-10-27", count: 200 },
      { date: "2026-10-28", count: 400 },
      { date: "2026-10-29", count: 250 },
    ]);
    expect(estimate.completionDate).toBe("2026-10-29");
    expect(estimate.totalDays).toBe(5);
  });

  it("starts the warm-up at the given sendDayIndex", () => {
    const warm = schedule({ warmup: true, dailyCap: 2000, delaySeconds: 1 });
    const estimate = estimateSchedule({ remaining: 1000, schedule: warm, now: at("2026-10-26T12:00:00Z"), sendDayIndex: 3 });
    expect(estimate.perDay.map((d) => d.count)).toEqual([400, 600]);
  });

  it("reduces the first day to the remaining window time when now is mid-window", () => {
    const estimate = estimateSchedule({ remaining: 1000, schedule: noWarmup, now: at("2026-10-26T20:00:00Z") });
    expect(estimate.perDay).toEqual([
      { date: "2026-10-26", count: 360 },
      { date: "2026-10-27", count: 640 },
    ]);
  });

  it("deducts sentToday from the first day's quota", () => {
    const warm = schedule({ warmup: true, dailyCap: 2000, delaySeconds: 1 });
    const estimate = estimateSchedule({
      remaining: 500,
      schedule: warm,
      now: at("2026-10-26T14:00:00Z"),
      sendDayIndex: 2,
      sentToday: 150,
    });
    expect(estimate.perDay).toEqual([
      { date: "2026-10-26", count: 50 },
      { date: "2026-10-27", count: 400 },
      { date: "2026-10-28", count: 50 },
    ]);
  });

  it("advances the warm-up index past today when today's quota is already used up", () => {
    const warm = schedule({ warmup: true, dailyCap: 2000, delaySeconds: 1 });
    const estimate = estimateSchedule({
      remaining: 100,
      schedule: warm,
      now: at("2026-10-26T14:00:00Z"),
      sendDayIndex: 0,
      sentToday: 50,
    });
    expect(estimate.perDay).toEqual([{ date: "2026-10-27", count: 100 }]);
  });

  it("skips today without consuming a warm-up day when now is past the window end", () => {
    const warm = schedule({ warmup: true, dailyCap: 2000, delaySeconds: 1 });
    const estimate = estimateSchedule({ remaining: 120, schedule: warm, now: at("2026-10-26T21:00:00Z") });
    expect(estimate.perDay).toEqual([
      { date: "2026-10-27", count: 50 },
      { date: "2026-10-28", count: 70 },
    ]);
  });

  it("skips today when now is on a non-send day", () => {
    const estimate = estimateSchedule({ remaining: 10, schedule: noWarmup, now: at("2026-10-25T15:00:00Z") });
    expect(estimate.perDay).toEqual([{ date: "2026-10-26", count: 10 }]);
  });

  it("uses real elapsed window time on DST days", () => {
    const sundayNight = schedule({ sendDays: [0], startTime: "01:00", endTime: "04:00", warmup: false, delaySeconds: 60 });
    const estimate = estimateSchedule({ remaining: 1000, schedule: sundayNight, now: at("2026-03-01T00:00:00Z") });
    expect(estimate.perDay.slice(0, 3)).toEqual([
      { date: "2026-03-01", count: 180 },
      { date: "2026-03-08", count: 120 },
      { date: "2026-03-15", count: 180 },
    ]);
  });

  it("terminates with a null completion date when there are no send days", () => {
    const estimate = estimateSchedule({ remaining: 10, schedule: schedule({ sendDays: [] }), now: at("2026-10-26T12:00:00Z") });
    expect(estimate.perDay).toEqual([]);
    expect(estimate.completionDate).toBeNull();
    expect(estimate.totalDays).toBe(0);
    expect(estimate.perDayCapacityNote).toEqual(expect.any(String));
  });

  it("terminates with a null completion date when the work exceeds ten years", () => {
    const tiny = schedule({ sendDays: [1], warmup: false, dailyCap: 1 });
    const estimate = estimateSchedule({ remaining: 1_000_000, schedule: tiny, now: at("2026-10-26T12:00:00Z") });
    expect(estimate.completionDate).toBeNull();
    expect(estimate.perDayCapacityNote).toEqual(expect.any(String));
    expect(estimate.totalDays).toBe(estimate.perDay.length);
    expect(estimate.perDay.length).toBeGreaterThan(500);
    expect(estimate.perDay.length).toBeLessThanOrEqual(522);
  });
});
