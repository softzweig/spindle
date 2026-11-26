import { describe, expect, it, vi } from "vitest";
import type { ServiceResult } from "../../src/result.js";
import { ServiceErrorCode } from "../../src/result.js";
import { ServiceError } from "../../src/service/service.error.js";
import { ServiceExecution } from "../../src/service/service.execution.js";

const succeeds = (data: number) => ServiceExecution.fromResult<number>({ ok: true, data });

describe("ServiceExecution", () => {
  describe("executors", () => {
    it("does not run the work until an executor is called", () => {
      const work = vi.fn(async () => ({ ok: true, data: 42 }) as const);

      ServiceExecution.of(work);

      expect(work).not.toHaveBeenCalled();
    });

    it("runs the work once across executors", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 42 }) as const);
      const execution = ServiceExecution.of<number>(work);

      await execution.result();
      await execution.unwrap();
      await execution.discard();

      expect(work).toHaveBeenCalledTimes(1);
    });

    it("returns a successful result without throwing", async () => {
      await expect(succeeds(42).result()).resolves.toEqual({ ok: true, data: 42 });
    });

    it("returns a failure result without throwing", async () => {
      const failure: ServiceResult<number> = {
        ok: false,
        code: ServiceErrorCode.NOT_FOUND,
        message: "Missing",
      };

      await expect(ServiceExecution.of(async () => failure).result()).resolves.toEqual(failure);
    });

    it("unwraps a successful result", async () => {
      await expect(succeeds(42).unwrap()).resolves.toBe(42);
    });

    it("throws a ServiceError when unwrapping a failure", async () => {
      const execution = ServiceExecution.fromError<number>(
        ServiceError.forbidden("Not allowed", { action: "delete" }),
      );

      const error = await execution.unwrap().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Not allowed",
        details: { action: "delete" },
      });
    });

    it("keeps details undefined when a failure has none", async () => {
      const execution = ServiceExecution.fromError<number>(ServiceError.unavailable("Down"));

      const error = await execution.unwrap().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        code: ServiceErrorCode.UNAVAILABLE,
        message: "Down",
        details: undefined,
      });
    });

    it("discards the result", async () => {
      await expect(succeeds(42).discard()).resolves.toBeUndefined();
    });

    it("propagates a rejected executor through result() and unwrap()", async () => {
      const failure = new Error("boom");
      const execution = ServiceExecution.of<number>(() => Promise.reject(failure));

      await expect(execution.result()).rejects.toBe(failure);
      await expect(execution.unwrap()).rejects.toBe(failure);
    });

    it("swallows a rejected executor when discarding", async () => {
      const execution = ServiceExecution.of<number>(() => Promise.reject(new Error("boom")));

      await expect(execution.discard()).resolves.toBeUndefined();
    });

    it("turns a synchronous throw in the executor into a rejection", async () => {
      const execution = ServiceExecution.of<number>(() => {
        throw new Error("boom");
      });

      await expect(execution.result()).rejects.toThrow("boom");
      await expect(execution.discard()).resolves.toBeUndefined();
    });
  });

  describe("pipe", () => {
    it("pipes the data into the next step", async () => {
      const url = await succeeds(42)
        .pipe((data) => `asset/${data}`)
        .unwrap();

      expect(url).toBe("asset/42");
    });

    it("does not run the pipeline until it is executed", async () => {
      const step = vi.fn(() => succeeds(7));
      const pipeline = succeeds(42).pipe(step);

      expect(step).not.toHaveBeenCalled();

      await expect(pipeline.unwrap()).resolves.toBe(7);
      expect(step).toHaveBeenCalledWith(42);
    });

    it("chains executions and unwraps the last value", async () => {
      const first = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const second = vi.fn(async () => ({ ok: true, data: 2 }) as const);
      const third = vi.fn(async () => ({ ok: true, data: 3 }) as const);

      const value = await ServiceExecution.of<number>(first)
        .pipe(() => ServiceExecution.of<number>(second))
        .pipe(() => ServiceExecution.of<number>(third))
        .unwrap();

      expect(value).toBe(3);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(third).toHaveBeenCalledTimes(1);
    });

    it("skips every step when the execution already failed", async () => {
      const step = vi.fn(() => succeeds(2));
      const execution = ServiceExecution.fromError<number>(ServiceError.notFound("Missing"));

      await expect(execution.pipe(step).unwrap()).rejects.toBeInstanceOf(ServiceError);
      expect(step).not.toHaveBeenCalled();
    });

    it("carries a failed step to the end of the pipeline", async () => {
      const failing = ServiceExecution.fromError<number>(ServiceError.forbidden("Nope"));
      const last = vi.fn(() => succeeds(3));

      const error = await succeeds(1)
        .pipe(() => failing)
        .pipe(last)
        .unwrap()
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ code: ServiceErrorCode.FORBIDDEN, message: "Nope" });
      expect(last).not.toHaveBeenCalled();
    });

    it("runs the work once when the pipeline is executed twice", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const pipeline = ServiceExecution.of<number>(work).pipe((data) => data + 1);

      await Promise.all([pipeline.unwrap(), pipeline.unwrap()]);

      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  describe("factories", () => {
    it("settles a result without running anything", async () => {
      const execution = succeeds(42);

      await expect(execution.result()).resolves.toEqual({ ok: true, data: 42 });
      await expect(execution.unwrap()).resolves.toBe(42);
    });

    it("settles a failure from an error", async () => {
      const execution = ServiceExecution.fromError<number>(ServiceError.conflict("Taken"));

      await expect(execution.result()).resolves.toEqual({
        ok: false,
        code: ServiceErrorCode.CONFLICT,
        message: "Taken",
        details: undefined,
      });
    });
  });
});
