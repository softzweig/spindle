import { describe, expect, it } from "vitest";
import type { ServiceResult } from "../../src/result.js";
import { ServiceErrorCode } from "../../src/result.js";
import { ServiceError } from "../../src/service/service.error.js";
import { ServiceExecution } from "../../src/service/service.execution.js";

describe("ServiceExecution", () => {
  it("returns a successful result without throwing", async () => {
    const result: ServiceResult<number> = { ok: true, data: 42 };
    const execution = new ServiceExecution(Promise.resolve(result));

    await expect(execution.result()).resolves.toEqual(result);
  });

  it("returns a failure result without throwing", async () => {
    const result: ServiceResult<number> = {
      ok: false,
      code: ServiceErrorCode.NOT_FOUND,
      message: "Missing",
    };
    const execution = new ServiceExecution(Promise.resolve(result));

    await expect(execution.result()).resolves.toEqual(result);
  });

  it("unwraps a successful result", async () => {
    const result: ServiceResult<number> = { ok: true, data: 42 };
    const execution = new ServiceExecution(Promise.resolve(result));

    await expect(execution.unwrap()).resolves.toBe(42);
  });

  it("throws a ServiceError when unwrapping a failure", async () => {
    const result: ServiceResult<number> = {
      ok: false,
      code: ServiceErrorCode.FORBIDDEN,
      message: "Not allowed",
      details: { action: "delete" },
    };
    const execution = new ServiceExecution(Promise.resolve(result));

    const error = await execution.unwrap().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: ServiceErrorCode.FORBIDDEN,
      message: "Not allowed",
      details: { action: "delete" },
    });
  });

  it("discards the result", async () => {
    const result: ServiceResult<number> = { ok: true, data: 42 };
    const execution = new ServiceExecution(Promise.resolve(result));

    await expect(execution.discard()).resolves.toBeUndefined();
  });

  it("returns the underlying promise from result()", () => {
    const promise = Promise.resolve<ServiceResult<number>>({ ok: true, data: 42 });
    const execution = new ServiceExecution(promise);

    expect(execution.result()).toBe(promise);
  });

  it("propagates a rejected promise through result() and unwrap()", async () => {
    const failure = new Error("boom");
    const execution = new ServiceExecution(Promise.reject(failure));

    await expect(execution.result()).rejects.toBe(failure);
    await expect(execution.unwrap()).rejects.toBe(failure);
  });

  it("swallows a rejected promise when discarding", async () => {
    const execution = new ServiceExecution(Promise.reject(new Error("boom")));

    await expect(execution.discard()).resolves.toBeUndefined();
  });

  it("keeps details undefined when a failure has none", async () => {
    const result: ServiceResult<number> = {
      ok: false,
      code: ServiceErrorCode.UNAVAILABLE,
      message: "Down",
    };
    const execution = new ServiceExecution(Promise.resolve(result));

    const error = await execution.unwrap().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: ServiceErrorCode.UNAVAILABLE,
      message: "Down",
      details: undefined,
    });
  });
});
