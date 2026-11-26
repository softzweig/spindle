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
