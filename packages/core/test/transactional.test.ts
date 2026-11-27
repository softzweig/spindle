import { describe, expect, it } from "vitest";
import { ServiceErrorCode } from "../src/result.js";
import { ServiceError } from "../src/service/service.error.js";
import {
  BaseTransactional,
  FOLLOWS_CONTEXT,
  TRANSACTION_EXECUTOR,
  type TransactionalContext,
} from "../src/transactional.js";

interface TestContext extends TransactionalContext {
  readonly id: string;
  readonly following?: TestService;
  readonly unrelated?: TestService;
  readonly truthy?: TestService;
}

type TransactionRunner = <T>(
  context: TestContext,
  fn: (context: TestContext) => Promise<T>,
) => Promise<T>;

class TestService extends BaseTransactional<TestContext> {
  constructor(
    context: TestContext,
    createTransaction: TransactionRunner,
    readonly label = "service",
  ) {
    super(context, createTransaction);
  }
}

class FollowingService extends TestService {
  readonly [FOLLOWS_CONTEXT] = true;
}

class TruthyMarkerService extends TestService {
  readonly [FOLLOWS_CONTEXT] = 1;
}

/** A subclass keeping private state, so it has to build its own copies. */
class PrivateStateService extends BaseTransactional<TestContext> {
  #issued: number;

  constructor(
    context: TestContext,
    private readonly runner: TransactionRunner,
    issued = 0,
  ) {
    super(context, runner);
    this.#issued = issued;
  }

  get issued(): number {
    return this.#issued;
  }

  protected override clone(context: Readonly<TestContext>): this {
    return new PrivateStateService(context, this.runner, this.#issued) as this;
  }
}

/** The same private state without the override: the default copy cannot see it. */
class UnclonableService extends BaseTransactional<TestContext> {
  #issued = 0;

  get issued(): number {
    return this.#issued;
  }
}

function createContext(overrides: Partial<TestContext> = {}): TestContext {
  return { isInTransaction: false, id: "root", ...overrides };
}

/** Creates a runner that records the context each transaction starts on. */
function createRunner() {
  const contexts: TestContext[] = [];

  function createTransaction<T>(
    context: TestContext,
    fn: (context: TestContext) => Promise<T>,
  ): Promise<T> {
    contexts.push(context);
    return fn({ ...context, isInTransaction: true });
  }

  return { contexts, createTransaction };
}

function setup(context: TestContext, label?: string) {
  const runner = createRunner();
  return { runner, service: new TestService(context, runner.createTransaction, label) };
}

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw");
}

describe("transaction symbols", () => {
  it("registers well-known symbols for adapters", () => {
    expect(TRANSACTION_EXECUTOR).toBe(Symbol.for("@softzweig/spindle-core/transaction-executor"));
    expect(FOLLOWS_CONTEXT).toBe(Symbol.for("@softzweig/spindle-core/follows-context"));
  });
});

describe("getContext", () => {
  it("returns the context it was constructed with", () => {
    const context = createContext();
    const { service } = setup(context);

    expect(service.getContext()).toBe(context);
  });
});

describe("withContext", () => {
  it("returns a new subclass instance bound to a copy of the context", () => {
    const original = createContext({ id: "original" });
    const { service } = setup(original, "orders");
    const next = createContext({ isInTransaction: true, id: "next" });

    const bound = service.withContext(next);

    expect(bound).not.toBe(service);
    expect(bound).toBeInstanceOf(TestService);
    expect(bound.label).toBe("orders");
    expect(bound.getContext()).not.toBe(next);
    expect(bound.getContext()).toEqual(next);
    expect(service.getContext()).toBe(original);
  });

  it("rebinds following members and leaves other members untouched", () => {
    const { runner, service } = setup(createContext());
    const siblingContext = createContext({ id: "sibling" });
    const following = new FollowingService(siblingContext, runner.createTransaction);
    const unrelated = new TestService(createContext({ id: "unrelated" }), runner.createTransaction);
    const next = createContext({
      isInTransaction: true,
      id: "next",
      following,
      unrelated,
    });

    const bound = service.withContext(next).getContext();

    expect(bound.following).toBeInstanceOf(FollowingService);
    expect(bound.following).not.toBe(following);
    expect(bound.following?.getContext()).toBe(next);
    expect(bound.unrelated).toBe(unrelated);
    expect(following.getContext()).toBe(siblingContext);
  });

  it("ignores members whose marker is not exactly true", () => {
    const { runner, service } = setup(createContext());
    const truthy = new TruthyMarkerService(
      createContext({ id: "truthy" }),
      runner.createTransaction,
    );
    const next = createContext({ isInTransaction: true, id: "next", truthy });

    const bound = service.withContext(next).getContext();

    expect(bound.truthy).toBe(truthy);
    expect(truthy.getContext().isInTransaction).toBe(false);
  });

  it("preserves symbol-keyed executor state", () => {
    const { service } = setup(createContext());
    const executor = { kind: "transaction" };
    const next = createContext({
      isInTransaction: true,
      id: "next",
      [TRANSACTION_EXECUTOR]: executor,
    });

    const bound = service.withContext(next).getContext();

    expect(bound[TRANSACTION_EXECUTOR]).toBe(executor);
  });

  it("keeps the subclass and its marker when rebinding", () => {
    const runner = createRunner();
    const service = new FollowingService(createContext(), runner.createTransaction);
    const next = createContext({ isInTransaction: true, id: "next" });

    const bound = service.withContext(next);

    expect(bound).toBeInstanceOf(FollowingService);
    expect(bound[FOLLOWS_CONTEXT]).toBe(true);
  });

  it("can rebind an already bound service again", () => {
    const { service } = setup(createContext());
    const first = createContext({ isInTransaction: true, id: "first" });
    const second = createContext({ isInTransaction: true, id: "second" });

    const boundOnce = service.withContext(first);
    const boundTwice = boundOnce.withContext(second);

    expect(boundOnce.getContext()).toEqual(first);
    expect(boundTwice.getContext()).toEqual(second);
    expect(boundTwice).not.toBe(boundOnce);
  });

  it("keeps private state when the subclass overrides clone", () => {
    const runner = createRunner();
    const service = new PrivateStateService(createContext(), runner.createTransaction, 3);
    const next = createContext({ isInTransaction: true, id: "next" });

    const bound = service.withContext(next);

    expect(bound).toBeInstanceOf(PrivateStateService);
    expect(bound.issued).toBe(3);
    expect(bound.getContext()).toEqual(next);
  });

  it("cannot read private state when the subclass does not override clone", () => {
    const runner = createRunner();
    const service = new UnclonableService(createContext(), runner.createTransaction);
    const next = createContext({ isInTransaction: true, id: "next" });

    expect(() => service.withContext(next).issued).toThrow(TypeError);
  });
});

describe("transaction", () => {
  it("runs the callback on a bound copy with the transaction context", async () => {
    const root = createContext();
    const { runner, service } = setup(root, "orders");
    let boundThis: TestService | undefined;
    let boundContext: Readonly<TestContext> | undefined;

    const value = await service.transaction(async function (context) {
      boundThis = this;
      boundContext = context;
      return 7;
    });

    expect(value).toBe(7);
    expect(runner.contexts).toEqual([root]);
    expect(boundThis).toBeInstanceOf(TestService);
    expect(boundThis).not.toBe(service);
    expect(boundThis?.label).toBe("orders");
    expect(boundThis?.getContext()).toBe(boundContext);
    expect(boundContext?.isInTransaction).toBe(true);
    expect(service.getContext()).toBe(root);
  });

  it("passes the active transaction context to nested calls", async () => {
    const root = createContext();
    const { runner, service } = setup(root);
    let outerContext: Readonly<TestContext> | undefined;
    let innerContext: Readonly<TestContext> | undefined;

    await service.transaction(async function (context) {
      outerContext = context;

      await this.transaction(async (nested) => {
        innerContext = nested;
      });
    });

    expect(runner.contexts).toHaveLength(2);
    expect(runner.contexts[0]).toBe(root);
    expect(runner.contexts[1]).toBe(outerContext);
    expect(runner.contexts[1]).not.toBe(root);
    expect(innerContext?.isInTransaction).toBe(true);
  });

  it("starts each top-level transaction from the original context", async () => {
    const root = createContext();
    const { runner, service } = setup(root);

    await service.transaction(async () => {});
    await service.transaction(async () => {});

    expect(runner.contexts).toEqual([root, root]);
    expect(runner.contexts[0]).toBe(root);
    expect(runner.contexts[1]).toBe(root);
  });

  it("rebinds following members inside the transaction", async () => {
    const runner = createRunner();
    const sibling = new FollowingService(
      createContext({ id: "sibling" }),
      runner.createTransaction,
    );
    const service = new TestService(
      createContext({ following: sibling }),
      runner.createTransaction,
    );
    let transactionSibling: TestService | undefined;

    await service.transaction(async function () {
      transactionSibling = this.getContext().following;
    });

    expect(transactionSibling).toBeInstanceOf(FollowingService);
    expect(transactionSibling).not.toBe(sibling);
    expect(transactionSibling?.getContext().isInTransaction).toBe(true);
    expect(sibling.getContext().isInTransaction).toBe(false);
  });

  it("carries the transaction executor into the callback context", async () => {
    const executor = { kind: "transaction" };
    const { service } = setup(createContext({ [TRANSACTION_EXECUTOR]: executor }));
    let seen: unknown;

    await service.transaction(async function () {
      seen = this.getContext()[TRANSACTION_EXECUTOR];
    });

    expect(seen).toBe(executor);
  });

  it("propagates a callback failure", async () => {
    const { service } = setup(createContext());
    const failure = new Error("boom");

    await expect(
      service.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("propagates a transaction runner failure", async () => {
    const failure = new Error("runner");
    const runner: TransactionRunner = () => Promise.reject(failure);
    const service = new TestService(createContext(), runner);

    await expect(service.transaction(async () => 1)).rejects.toBe(failure);
  });

  it("rebinds following members again for a nested transaction", async () => {
    const runner = createRunner();
    const sibling = new FollowingService(
      createContext({ id: "sibling" }),
      runner.createTransaction,
    );
    const service = new TestService(
      createContext({ following: sibling }),
      runner.createTransaction,
    );
    let outerSibling: TestService | undefined;
    let innerSibling: TestService | undefined;

    await service.transaction(async function () {
      outerSibling = this.getContext().following;

      await this.transaction(async function () {
        innerSibling = this.getContext().following;
      });
    });

    expect(outerSibling).toBeInstanceOf(FollowingService);
    expect(innerSibling).toBeInstanceOf(FollowingService);
    expect(innerSibling).not.toBe(outerSibling);
  });

  it("propagates a nested failure through the outer transaction", async () => {
    const { service } = setup(createContext());
    const failure = new Error("nested");

    await expect(
      service.transaction(async function () {
        await this.transaction(async () => {
          throw failure;
        });
      }),
    ).rejects.toBe(failure);
  });
});

describe("transaction assertions", () => {
  it("assertTransaction accepts an active transaction", () => {
    const { service } = setup(createContext({ isInTransaction: true, id: "tx" }));

    expect(() => service.assertTransaction()).not.toThrow();
  });

  it("assertTransaction reports a missing transaction", () => {
    const { service } = setup(createContext());

    const error = captureError(() => service.assertTransaction());

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: ServiceErrorCode.PRECONDITION_FAILED,
      message: "This service is not bound to a transaction",
    });
  });

  it("assertNotTransaction accepts a non-transactional service", () => {
    const { service } = setup(createContext());

    expect(() => service.assertNotTransaction()).not.toThrow();
  });

  it("assertNotTransaction reports an active transaction", () => {
    const { service } = setup(createContext({ isInTransaction: true, id: "tx" }));

    const error = captureError(() => service.assertNotTransaction());

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: ServiceErrorCode.PRECONDITION_FAILED,
      message: "This service is bound to a transaction",
    });
  });

  it("guards follow the bound context", () => {
    const { service } = setup(createContext());
    const bound = service.withContext(createContext({ isInTransaction: true, id: "tx" }));

    expect(() => service.assertNotTransaction()).not.toThrow();
    expect(() => bound.assertTransaction()).not.toThrow();
  });
});
