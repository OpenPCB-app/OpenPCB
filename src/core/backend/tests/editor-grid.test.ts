import { expect, test } from "bun:test";
import {
  snapCoordinateMm,
  snapCoordinateNm,
  snapPointNm,
  snappedMoveDeltaNm,
} from "../../../shared/domain/editor-grid";
import { repairToManhattan } from "../../../shared/schematic-routing/manhattan";

test("positive and negative coordinates use exact nanometre multiples", () => {
  expect(snapPointNm({ x: 1_904_999, y: -1_905_001 }, 1_270_000)).toEqual({
    x: 1_270_000,
    y: -2_540_000,
  });
  expect(snapPointNm({ x: 1_905_000, y: -1_905_000 }, 1_270_000)).toEqual({
    x: 2_540_000,
    y: -1_270_000,
  });
  expect(Object.is(snapCoordinateNm(-1, 1_270_000), -0)).toBe(false);
});
test("mm and nm inputs select the same PCB grid cell without decimal drift", () => {
  for (const mm of [0.05, 0.1, 0.25, 0.5, 1, 1.27]) {
    for (const value of [-7.85, -1.27, -0.01, 0, 0.29, 2.54, 7.85]) {
      expect(snapCoordinateMm(value, mm)).toBe(
        snapCoordinateNm(value * 1_000_000, mm * 1_000_000) / 1_000_000,
      );
    }
  }
});
test("free placement rounds only to model nanometres", () => {
  expect(snapPointNm({ x: -11_160_001, y: -3_305_002 }, 0)).toEqual({
    x: -11_160_001,
    y: -3_305_002,
  });
  expect(snapCoordinateMm(-1.1234564, 0)).toBe(-1.123456);
});
test("group movement snaps the grabbed origin and preserves every relative offset", () => {
  const origin = { x: -11_160_000, y: -3_305_000 };
  const delta = snappedMoveDeltaNm(
    origin,
    { x: 1_000_000, y: 700_000 },
    1_270_000,
  );
  expect({ x: origin.x + delta.x, y: origin.y + delta.y }).toEqual({
    x: -10_160_000,
    y: -2_540_000,
  });
  expect(snappedMoveDeltaNm(origin, { x: 0, y: 0 }, 1_270_000)).toEqual({
    x: 0,
    y: 0,
  });
  expect(snappedMoveDeltaNm(origin, { x: 123, y: -456 }, 0)).toEqual({
    x: 123,
    y: -456,
  });
});
test("routing preserves exact off-grid electrical endpoints", () => {
  const source = { x: -11_160_000, y: -3_305_000 };
  const target = { x: 18_760_000, y: -722_000 };
  const path = repairToManhattan(
    [source, { x: 4_124_000, y: -99_999 }, target],
    source,
    target,
  );
  expect(path[0]).toEqual(source);
  expect(path.at(-1)).toEqual(target);
  expect(
    path.every(
      (point) => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y),
    ),
  ).toBe(true);
});
test("invalid coordinates and grid pitches fail before emitting a command coordinate", () => {
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    expect(() => snapCoordinateNm(value, 1_270_000)).toThrow();
  for (const pitch of [-1, NaN, Infinity, 0.5])
    expect(() => snapCoordinateNm(0, pitch)).toThrow();
});
