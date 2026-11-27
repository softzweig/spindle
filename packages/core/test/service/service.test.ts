import { describe, expect, it, test, vi } from "vitest";
import { RepositoryError } from "../../src/repository/repository.error.js";
import type { SpindleFailure } from "../../src/result.js";
import { SpindleError, SpindleErrorCode } from "../../src/result.js";
import { ServiceError } from "../../src/service/service.error.js";
import { ServiceExecution } from "../../src/service/service.execution.js";
import { Service, type ServiceContext, toServiceFailure } from "../../src/service/service.js";
import { FOLLOWS_CONTEXT } from "../../src/transactional.js";

type TestContext = ServiceContext & { readonly id: string };

type TransactionRunner = <T>(
  context: TestContext,
  fn: (context: TestContext) => Promise<T>,
) => Promise<T>;

class TestService extends Service<TestContext> {
  constructor(
    context: TestContext,
    createTransaction: TransactionRunner,
    readonly label = "service",
  ) {
    super(context, createTransaction);
  }
}

function createContext(overrides: Partial<TestContext> = {}): TestContext {
  return { isInTransaction: false, id: "root", ...overrides };
}

function createRunner(options: { activates?: boolean } = {}) {
  const contexts: TestContext[] = [];

  function createTransaction<T>(
    context: TestContext,
    fn: (context: TestContext) => Promise<T>,
  ): Promise<T> {
    contexts.push(context);
    return fn({ ...context, isInTransaction: options.activates ?? true });
  }

  return { contexts, createTransaction };
}

function setup(context: TestContext, options: { activates?: boolean; label?: string } = {}) {
  const runner = createRunner({ activates: options.activates });
  return {
    runner,
    service: new TestService(context, runner.createTransaction, options.label),
  };
}

describe("toServiceFailure", () => {
  it("preserves a ServiceError", () => {
    const details = { id: 1 };

    expect(toServiceFailure(ServiceError.notFound("Missing", details))).toEqual({
      ok: false,
      code: SpindleErrorCode.NOT_FOUND,
      message: "Missing",
      details,
    });
  });

  it("preserves a RepositoryError the same way", () => {
    expect(toServiceFailure(RepositoryError.notFound("Missing", { id: 1 }))).toEqual({
      ok: false,
      code: SpindleErrorCode.NOT_FOUND,
      message: "Missing",
      details: { id: 1 },
    });
  });

  it("preserves an error from a layer core does not know", () => {
    class CacheError extends SpindleError {
      constructor() {
        super(SpindleErrorCode.UNAVAILABLE, "Cache is down");
        this.name = "CacheError";
      }
    }

    expect(toServiceFailure(new CacheError())).toEqual({
      ok: false,
      code: SpindleErrorCode.UNAVAILABLE,
      message: "Cache is down",
    });
  });

  test.for([
    ["a plain error", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
  ] as const)("maps %s to an unknown failure", ([, error]) => {
    expect(toServiceFailure(error)).toEqual({
      ok: false,
      code: SpindleErrorCode.UNKNOWN,
      message: "Unexpected failure",
    });
  });
});

describe("Service", () => {
  it("marks instances as following their context", () => {
    const { service } = setup(createContext());

    expect(service[FOLLOWS_CONTEXT]).toBe(true);
  });

  describe("prepare", () => {
    it("folds a successful callback into a success result", async () => {
      const { service } = setup(createContext());
      const execution = service.prepare(async () => 42);

      expect(execution).toBeInstanceOf(ServiceExecution);
      await expect(execution.run()).resolves.toEqual({ ok: true, data: 42 });
      await expect(execution.unwrap()).resolves.toBe(42);
    });

    it("runs the callback with the service and its context", async () => {
      const context = createContext();
      const { service } = setup(context);
      let seenThis: TestService | undefined;
      let seenContext: TestContext | undefined;

      await service
        .prepare(async function (received) {
          seenThis = this;
          seenContext = received;
          return 1;
        })
        .unwrap();

      expect(seenThis).toBe(service);
      expect(seenContext).toBe(context);
    });

    it("folds a ServiceError into a failure result", async () => {
      const { service } = setup(createContext());
      const execution = service.prepare(async () => {
        throw ServiceError.forbidden("Nope", { action: "delete" });
      });

      await expect(execution.run()).resolves.toEqual({
        ok: false,
        code: SpindleErrorCode.FORBIDDEN,
        message: "Nope",
        details: { action: "delete" },
      });

      const caught = await execution.unwrap().catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(ServiceError);
      expect(caught).toMatchObject({ code: SpindleErrorCode.FORBIDDEN, message: "Nope" });
    });

    it("maps unexpected errors to an unknown failure", async () => {
      const { service } = setup(createContext());
      const execution = service.prepare(async () => {
        throw new Error("boom");
      });

      await expect(execution.run()).resolves.toEqual({
        ok: false,
        code: SpindleErrorCode.UNKNOWN,
        message: "Unexpected failure",
      });
    });

    it("folds synchronous throws into a failure result", async () => {
      const { service } = setup(createContext());
      const execution = service.prepare(() => {
        throw ServiceError.invalidInput("Bad input");
      });

      await expect(execution.run()).resolves.toMatchObject({
        ok: false,
        code: SpindleErrorCode.INVALID_INPUT,
        message: "Bad input",
      });
    });

    it("uses the context converter when one is provided", async () => {
      const convert = vi.fn(
        (_error: unknown): SpindleFailure => ({
          ok: false,
          code: SpindleErrorCode.UNKNOWN,
          message: "Custom failure",
        }),
      );
      const { service } = setup(createContext({ toServiceFailure: convert }));
      const failure = new Error("boom");

      const execution = service.prepare(async () => {
        throw failure;
      });

      await expect(execution.run()).resolves.toEqual({
        ok: false,
        code: SpindleErrorCode.UNKNOWN,
        message: "Custom failure",
      });
      expect(convert).toHaveBeenCalledWith(failure);
    });

    it("does not call the context converter on success", async () => {
      const convert = vi.fn(
        (_error: unknown): SpindleFailure => ({
          ok: false,
          code: SpindleErrorCode.UNKNOWN,
          message: "Custom failure",
        }),
      );
      const { service } = setup(createContext({ toServiceFailure: convert }));

      await expect(service.prepare(async () => 1).run()).resolves.toEqual({
        ok: true,
        data: 1,
      });
      expect(convert).not.toHaveBeenCalled();
    });
  });

  describe("prepareTransaction", () => {
    it("runs the callback in a transaction-bound copy", async () => {
      const root = createContext();
      const { runner, service } = setup(root);
      let seenThis: TestService | undefined;
      let seenContext: TestContext | undefined;

      const execution = service.prepareTransaction(async function (context) {
        seenThis = this;
        seenContext = context;
        return 7;
      });

      await expect(execution.run()).resolves.toEqual({ ok: true, data: 7 });
      expect(runner.contexts).toEqual([root]);
      expect(seenThis).not.toBe(service);
      expect(seenThis?.getContext().isInTransaction).toBe(true);
      expect(seenContext?.isInTransaction).toBe(true);
    });

    it("folds a failed transaction guard into a failure result", async () => {
      const { service } = setup(createContext(), { activates: false });
      const execution = service.prepareTransaction(async () => 1);

      await expect(execution.run()).resolves.toMatchObject({
        ok: false,
        code: SpindleErrorCode.PRECONDITION_FAILED,
        message: "This service is not bound to a transaction",
      });
    });

    it("folds a callback failure into a failure result", async () => {
      const { service } = setup(createContext());
      const execution = service.prepareTransaction(async () => {
        throw ServiceError.conflict("Clash");
      });

      await expect(execution.run()).resolves.toMatchObject({
        ok: false,
        code: SpindleErrorCode.CONFLICT,
        message: "Clash",
      });
    });
  });

  describe("prepareNonTransaction", () => {
    it("runs the callback on the current service", async () => {
      const context = createContext();
      const { service } = setup(context);
      let seenThis: TestService | undefined;
      let seenContext: TestContext | undefined;

      const execution = service.prepareNonTransaction(async function (received) {
        seenThis = this;
        seenContext = received;
        return 3;
      });

      await expect(execution.run()).resolves.toEqual({ ok: true, data: 3 });
      expect(seenThis).toBe(service);
      expect(seenContext).toBe(context);
    });

    it("folds a failed non-transaction guard into a failure result", async () => {
      const { service } = setup(createContext({ isInTransaction: true, id: "tx" }));
      const execution = service.prepareNonTransaction(async () => 1);

      await expect(execution.run()).resolves.toMatchObject({
        ok: false,
        code: SpindleErrorCode.PRECONDITION_FAILED,
        message: "This service is bound to a transaction",
      });
    });

    it("folds a callback failure into a failure result", async () => {
      const { service } = setup(createContext());
      const execution = service.prepareNonTransaction(async () => {
        throw ServiceError.notFound("Missing");
      });

      await expect(execution.run()).resolves.toMatchObject({
        ok: false,
        code: SpindleErrorCode.NOT_FOUND,
        message: "Missing",
      });
    });
  });
});
