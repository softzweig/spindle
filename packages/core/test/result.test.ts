import { describe, expect, it, test } from "vitest";
import z from "zod";
import {
  SpindleErrorCode,
  SpindleFailureSchema,
  SpindleResultSchema,
  SpindleSuccessSchema,
} from "../src/result.js";

const failure = {
  ok: false,
  code: SpindleErrorCode.NOT_FOUND,
  message: "Missing",
} as const;

describe("SpindleErrorCode", () => {
  it("exposes a frozen, stable vocabulary", () => {
    expect(SpindleErrorCode).toEqual({
      NOT_FOUND: "not_found",
      INVALID_INPUT: "invalid_input",
      FORBIDDEN: "forbidden",
      CONFLICT: "conflict",
      PRECONDITION_FAILED: "precondition_failed",
      UNAVAILABLE: "unavailable",
      UNKNOWN: "unknown",
    });
    expect(Object.isFrozen(SpindleErrorCode)).toBe(true);
  });
});

describe("SpindleFailureSchema", () => {
  it("accepts a minimal failure", () => {
    expect(SpindleFailureSchema.parse(failure)).toEqual(failure);
  });

  it("accepts free-form details", () => {
    const withDetails = { ...failure, details: { field: "id", ids: [1, 2] } };

    expect(SpindleFailureSchema.parse(withDetails)).toEqual(withDetails);
  });

  test.for([
    ["a success marker", { ...failure, ok: true }],
    ["an unknown code", { ...failure, code: "teapot" }],
    ["a missing message", { ok: false, code: SpindleErrorCode.UNKNOWN }],
    ["non-record details", { ...failure, details: "nope" }],
  ])("rejects %s", ([, value]) => {
    expect(SpindleFailureSchema.safeParse(value).success).toBe(false);
  });
});

describe("SpindleSuccessSchema", () => {
  const schema = SpindleSuccessSchema(z.number());

  it("accepts a matching payload", () => {
    expect(schema.parse({ ok: true, data: 3 })).toEqual({ ok: true, data: 3 });
  });

  it("rejects a mismatched payload", () => {
    expect(schema.safeParse({ ok: true, data: "3" }).success).toBe(false);
  });
});

describe("SpindleResultSchema", () => {
  const schema = SpindleResultSchema(z.number());

  it("accepts a success result", () => {
    expect(schema.parse({ ok: true, data: 3 })).toEqual({ ok: true, data: 3 });
  });

  it("accepts a failure result", () => {
    expect(schema.parse(failure)).toEqual(failure);
  });

  test.for([
    ["a mismatched success payload", { ok: true, data: "3" }],
    ["an unknown failure code", { ...failure, code: "teapot" }],
    ["a failure without a message", { ok: false, code: SpindleErrorCode.UNKNOWN }],
  ])("rejects %s", ([, value]) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
