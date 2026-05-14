import { describe, expect, it } from "vitest";
import type { LibraryTagStat } from "../../../sdks/library";
import {
  classifyTag,
  groupTags,
  normalizeTag,
  normalizeTagList,
} from "./tag-grouping";

function stat(tag: string, count: number): LibraryTagStat {
  return { tag, count };
}

describe("classifyTag", () => {
  it("recognizes mount tags", () => {
    expect(classifyTag("smd")).toBe("mount");
    expect(classifyTag("through-hole")).toBe("mount");
    expect(classifyTag("THT")).toBe("mount");
  });

  it("recognizes family tags", () => {
    expect(classifyTag("resistor")).toBe("family");
    expect(classifyTag("mcu")).toBe("family");
    expect(classifyTag("Connector")).toBe("family");
  });

  it("recognizes package tags via patterns", () => {
    expect(classifyTag("0402")).toBe("package");
    expect(classifyTag("0603")).toBe("package");
    expect(classifyTag("SOT-23")).toBe("package");
    expect(classifyTag("QFN-64")).toBe("package");
    expect(classifyTag("dip8")).toBe("package");
  });

  it("recognizes system tags", () => {
    expect(classifyTag("builtin")).toBe("system");
    expect(classifyTag("drawn-footprint")).toBe("system");
    expect(classifyTag("user")).toBe("system");
  });

  it("falls back to other for unknown tags", () => {
    expect(classifyTag("rohs")).toBe("other");
    expect(classifyTag("custom-thing")).toBe("other");
  });
});

describe("groupTags", () => {
  it("buckets tags into ordered groups", () => {
    const groups = groupTags([
      stat("resistor", 10),
      stat("0603", 8),
      stat("smd", 5),
      stat("rohs", 2),
      stat("builtin", 2),
    ]);
    const ids = groups.map((g) => g.group.id);
    expect(ids).toEqual(["family", "package", "mount", "other", "system"]);
    expect(groups[0]!.tags.map((t) => t.tag)).toEqual(["resistor"]);
    expect(groups[1]!.tags.map((t) => t.tag)).toEqual(["0603"]);
    expect(groups[2]!.tags.map((t) => t.tag)).toEqual(["smd"]);
    expect(groups[3]!.tags.map((t) => t.tag)).toEqual(["rohs"]);
    expect(groups[4]!.tags.map((t) => t.tag)).toEqual(["builtin"]);
  });

  it("sorts entries within a group by count desc then alpha", () => {
    const groups = groupTags([
      stat("resistor", 4),
      stat("capacitor", 4),
      stat("ic", 10),
      stat("mcu", 2),
    ]);
    const family = groups.find((g) => g.group.id === "family")!;
    expect(family.tags.map((t) => t.tag)).toEqual([
      "ic",
      "capacitor",
      "resistor",
      "mcu",
    ]);
  });

  it("excludeSystem drops the system group", () => {
    const groups = groupTags([stat("builtin", 5), stat("resistor", 3)], {
      excludeSystem: true,
    });
    expect(groups.find((g) => g.group.id === "system")?.tags).toEqual([]);
  });

  it("dropEmpty omits empty groups entirely", () => {
    const groups = groupTags([stat("resistor", 3)], { dropEmpty: true });
    const ids = groups.map((g) => g.group.id);
    expect(ids).toEqual(["family"]);
  });
});

describe("normalizeTag / normalizeTagList", () => {
  it("lowercases and trims a single tag", () => {
    expect(normalizeTag("  Resistor ")).toBe("resistor");
  });

  it("de-duplicates and preserves first-occurrence order", () => {
    expect(
      normalizeTagList(["Resistor", "smd", "RESISTOR", "  ", "SMD", "rohs"]),
    ).toEqual(["resistor", "smd", "rohs"]);
  });

  it("ignores non-strings safely", () => {
    expect(
      normalizeTagList([
        "resistor",
        // @ts-expect-error — intentionally exercising defensive guard
        null,
        // @ts-expect-error — intentionally exercising defensive guard
        42,
        "0603",
      ]),
    ).toEqual(["resistor", "0603"]);
  });
});
