/**
 * WAI-ARIA roving-focus key handling shared by DockTabs and SegmentedControl
 * (T-018). Pure: returns the index that should receive focus, or null when
 * the key is not a navigation key for this orientation.
 */
export type RovingOrientation = "horizontal" | "vertical";

export interface RovingInput {
  key: string;
  current: number;
  count: number;
  orientation?: RovingOrientation;
  isDisabled?: (index: number) => boolean;
}

function step(
  from: number,
  delta: 1 | -1,
  count: number,
  isDisabled: (index: number) => boolean,
): number | null {
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + delta * offset) % count) + count) % count;
    if (!isDisabled(index)) return index;
  }
  return null;
}

export function nextRovingIndex({
  key,
  current,
  count,
  orientation = "horizontal",
  isDisabled = () => false,
}: RovingInput): number | null {
  if (count <= 0) return null;
  const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const from = current < 0 || current >= count ? 0 : current;
  switch (key) {
    case nextKey:
      return step(from, 1, count, isDisabled);
    case prevKey:
      return step(from, -1, count, isDisabled);
    case "Home":
      return step(-1, 1, count, isDisabled);
    case "End":
      return step(count, -1, count, isDisabled);
    default:
      return null;
  }
}
