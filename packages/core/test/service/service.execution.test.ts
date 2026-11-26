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

      await execution.run();
      await execution.unwrap();
      await execution.discard();

      expect(work).toHaveBeenCalledTimes(1);
    });

    it("returns a successful result without throwing", async () => {
      await expect(succeeds(42).run()).resolves.toEqual({ ok: true, data: 42 });
    });

    it("returns a failure result without throwing", async () => {
      const failure: ServiceResult<number> = {
        ok: false,
        code: ServiceErrorCode.NOT_FOUND,
        message: "Missing",
      };

      await expect(ServiceExecution.of(async () => failure).run()).resolves.toEqual(failure);
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

    it("propagates a rejected executor through run() and unwrap()", async () => {
      const failure = new Error("boom");
      const execution = ServiceExecution.of<number>(() => Promise.reject(failure));

      await expect(execution.run()).rejects.toBe(failure);
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

      await expect(execution.run()).rejects.toThrow("boom");
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

  describe("all", () => {
    it("resolves every value, in the order given", async () => {
      const together: ServiceExecution<[number, string]> = ServiceExecution.all([
        succeeds(1),
        ServiceExecution.fromResult({ ok: true, data: "two" }),
      ]);

      await expect(together.unwrap()).resolves.toEqual([1, "two"]);
    });

    it("does not run anything until it is executed", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const together = ServiceExecution.all([ServiceExecution.of<number>(work), succeeds(2)]);

      expect(work).not.toHaveBeenCalled();

      await together.unwrap();

      expect(work).toHaveBeenCalledTimes(1);
    });

    it("resolves an empty set", async () => {
      await expect(ServiceExecution.all([]).unwrap()).resolves.toEqual([]);
    });

    it("takes the first failure and drops the values", async () => {
      const together = ServiceExecution.all([
        succeeds(1),
        ServiceExecution.fromError<number>(ServiceError.notFound("Missing")),
        ServiceExecution.fromError<number>(ServiceError.forbidden("Nope")),
      ]);

      await expect(together.run()).resolves.toMatchObject({
        ok: false,
        code: ServiceErrorCode.NOT_FOUND,
        message: "Missing",
      });
    });

    it("runs a shared execution once", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const shared = ServiceExecution.of<number>(work);

      await ServiceExecution.all([shared, shared]).unwrap();

      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  describe("allSettled", () => {
    it("keeps every outcome, in the order given", async () => {
      const settled: ServiceExecution<[ServiceResult<number>, ServiceResult<number>]> =
        ServiceExecution.allSettled([
          succeeds(1),
          ServiceExecution.fromError<number>(ServiceError.forbidden("Nope")),
        ]);

      await expect(settled.unwrap()).resolves.toEqual([
        { ok: true, data: 1 },
        {
          ok: false,
          code: ServiceErrorCode.FORBIDDEN,
          message: "Nope",
          details: undefined,
        },
      ]);
    });

    it("succeeds even when every execution fails", async () => {
      const settled = ServiceExecution.allSettled([
        ServiceExecution.fromError<number>(ServiceError.notFound("Missing")),
      ]);

      const result = await settled.run();

      expect(result.ok).toBe(true);
    });

    it("does not run anything until it is executed", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const settled = ServiceExecution.allSettled([ServiceExecution.of<number>(work)]);

      expect(work).not.toHaveBeenCalled();

      await settled.unwrap();

      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  describe("composition", () => {
    it("pipes a combined result into a single value", async () => {
      const total = await ServiceExecution.all([succeeds(1), succeeds(2)])
        .pipe(([first, second]) => first + second)
        .unwrap();

      expect(total).toBe(3);
    });

    it("combines the output of a pipeline with another execution", async () => {
      const derived = succeeds(2).pipe((data) => data * 10);

      await expect(ServiceExecution.all([derived, succeeds(3)]).unwrap()).resolves.toEqual([20, 3]);
    });

    it("turns a failed combination into a value with allSettled", async () => {
      const failing = ServiceExecution.fromError<number>(ServiceError.notFound("Missing"));
      const settled = ServiceExecution.allSettled([ServiceExecution.all([succeeds(1), failing])]);

      const [combined] = await settled.unwrap();

      expect(combined).toEqual({
        ok: false,
        code: ServiceErrorCode.NOT_FOUND,
        message: "Missing",
        details: undefined,
      });
    });

    it("collects the successes of a settled set", async () => {
      const failing = ServiceExecution.fromError<number>(ServiceError.forbidden("Nope"));

      const values = await ServiceExecution.allSettled([succeeds(1), failing, succeeds(3)])
        .pipe((results) => results.flatMap((result) => (result.ok ? [result.data] : [])))
        .unwrap();

      expect(values).toEqual([1, 3]);
    });

    it("skips the remaining pipeline when a combined execution fails", async () => {
      const step = vi.fn(([total]: [number, number]) => total);
      const failing = ServiceExecution.fromError<number>(ServiceError.unavailable("Down"));

      const error = await ServiceExecution.all([succeeds(1), failing])
        .pipe(step)
        .unwrap()
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ code: ServiceErrorCode.UNAVAILABLE, message: "Down" });
      expect(step).not.toHaveBeenCalled();
    });

    it("runs a shared execution once across a nested combination", async () => {
      const work = vi.fn(async () => ({ ok: true, data: 1 }) as const);
      const shared = ServiceExecution.of<number>(work);

      await ServiceExecution.all([shared, ServiceExecution.all([shared, succeeds(2)])]).unwrap();

      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  describe("factories", () => {
    it("settles a result without running anything", async () => {
      const execution = succeeds(42);

      await expect(execution.run()).resolves.toEqual({ ok: true, data: 42 });
      await expect(execution.unwrap()).resolves.toBe(42);
    });

    it("settles a failure from an error", async () => {
      const execution = ServiceExecution.fromError<number>(ServiceError.conflict("Taken"));

      await expect(execution.run()).resolves.toEqual({
        ok: false,
        code: ServiceErrorCode.CONFLICT,
        message: "Taken",
        details: undefined,
      });
    });
  });
});
