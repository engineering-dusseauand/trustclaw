import { describe, it, expect } from "vitest";
import {
  collectArrays,
  findProjectArray,
} from "../listSupabaseProjects";

describe("collectArrays", () => {
  it("returns every array reachable from the value", () => {
    const arrays = collectArrays({
      foo: [1, 2, 3],
      bar: { baz: ["a", "b"] },
    });
    // Two top-level arrays we expect to find.
    expect(arrays.some((a) => a.length === 3 && a[0] === 1)).toBe(true);
    expect(arrays.some((a) => a.length === 2 && a[0] === "a")).toBe(true);
  });

  it("returns an empty list for primitives and null", () => {
    expect(collectArrays(null)).toEqual([]);
    expect(collectArrays("hi")).toEqual([]);
    expect(collectArrays(42)).toEqual([]);
  });
});

describe("findProjectArray", () => {
  it("finds projects under data: [ ... ]", () => {
    const composioData = [
      { id: "uuid-1", ref: "abc123", name: "Project One" },
      { id: "uuid-2", ref: "def456", name: "Project Two" },
    ];
    const rows = findProjectArray(composioData);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.[0]?.ref).toBe("abc123");
  });

  it("finds projects under data: { projects: [ ... ] }", () => {
    const rows = findProjectArray({
      projects: [
        { id: "uuid-1", ref: "abc123", name: "Project One" },
        { id: "uuid-2", ref: "def456", name: "Project Two" },
      ],
    });
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.[1]?.name).toBe("Project Two");
  });

  it("recursively walks deeper nesting (data.wrapper.items)", () => {
    const rows = findProjectArray({
      wrapper: {
        items: [
          { id: "uuid-1", ref: "abc123", name: "Project One" },
        ],
      },
    });
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.ref).toBe("abc123");
  });

  it("returns null for an empty array", () => {
    expect(findProjectArray([])).toBeNull();
  });

  it("returns null for arrays of non-objects", () => {
    expect(findProjectArray([1, 2, 3])).toBeNull();
    expect(findProjectArray(["a", "b", "c"])).toBeNull();
  });

  it("returns null for arrays of objects without identifier-looking fields", () => {
    // The heuristic requires ref/id/project_ref/project_id on the first row.
    expect(findProjectArray([{ foo: "bar" }, { baz: "qux" }])).toBeNull();
  });

  it("accepts rows that have only project_id (no ref/id)", () => {
    const rows = findProjectArray([{ project_id: "xyz", name: "p" }]);
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.project_id).toBe("xyz");
  });

  it("accepts rows that have only project_ref (no ref/id)", () => {
    const rows = findProjectArray([{ project_ref: "xyz", name: "p" }]);
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.project_ref).toBe("xyz");
  });
});
