import { describe, expect, it, test } from "vitest";
import z from "zod";
import {
  ServiceErrorCode,
  ServiceFailureSchema,
  serviceResultSchema,
  serviceSuccessSchema,
} from "../src/result.js";

const failure = {
  ok: false,
  code: ServiceErrorCode.NOT_FOUND,
  message: "Missing",
} as const;

describe("ServiceErrorCode", () => {
  it("exposes a frozen, stable vocabulary", () => {
    expect(ServiceErrorCode).toEqual({
      NOT_FOUND: "not_found",
      INVALID_INPUT: "invalid_input",
      FORBIDDEN: "forbidden",
      CONFLICT: "conflict",
      PRECONDITION_FAILED: "precondition_failed",
      UNAVAILABLE: "unavailable",
      UNKNOWN: "unknown",
    });
    expect(Object.isFrozen(ServiceErrorCode)).toBe(true);
  });
});

describe("ServiceFailureSchema", () => {
  it("accepts a minimal failure", () => {
    expect(ServiceFailureSchema.parse(failure)).toEqual(failure);
  });

  it("accepts free-form details", () => {
    const withDetails = { ...failure, details: { field: "id", ids: [1, 2] } };

    expect(ServiceFailureSchema.parse(withDetails)).toEqual(withDetails);
  });

  test.for([
    ["a success marker", { ...failure, ok: true }],
    ["an unknown code", { ...failure, code: "teapot" }],
    ["a missing message", { ok: false, code: ServiceErrorCode.UNKNOWN }],
    ["non-record details", { ...failure, details: "nope" }],
  ])("rejects %s", ([, value]) => {
    expect(ServiceFailureSchema.safeParse(value).success).toBe(false);
  });
});

describe("serviceSuccessSchema", () => {
  const schema = serviceSuccessSchema(z.number());

  it("accepts a matching payload", () => {
    expect(schema.parse({ ok: true, data: 3 })).toEqual({ ok: true, data: 3 });
  });

  it("rejects a mismatched payload", () => {
    expect(schema.safeParse({ ok: true, data: "3" }).success).toBe(false);
  });
});

describe("serviceResultSchema", () => {
  const schema = serviceResultSchema(z.number());

  it("accepts a success result", () => {
    expect(schema.parse({ ok: true, data: 3 })).toEqual({ ok: true, data: 3 });
  });

  it("accepts a failure result", () => {
    expect(schema.parse(failure)).toEqual(failure);
  });

  test.for([
    ["a mismatched success payload", { ok: true, data: "3" }],
    ["an unknown failure code", { ...failure, code: "teapot" }],
    ["a failure without a message", { ok: false, code: ServiceErrorCode.UNKNOWN }],
  ])("rejects %s", ([, value]) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
