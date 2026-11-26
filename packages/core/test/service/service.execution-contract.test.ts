import { describe, expect, it } from "vitest";
import { ServiceExecution } from "../../src/service/service.execution.js";
import {
  Service,
  type ServiceContext,
  type ServiceExecutionContract,
} from "../../src/service/service.js";

type TestContext = ServiceContext & { readonly id: string };

function createContext(): TestContext {
  return { isInTransaction: false, id: "root" };
}

function createTransaction<T>(
  context: TestContext,
  fn: (context: TestContext) => Promise<T>,
): Promise<T> {
  return fn(context);
}

class GoodService extends Service<TestContext> implements ServiceExecutionContract<GoodService> {
  constructor() {
    super(createContext(), createTransaction);
  }

  find(): ServiceExecution<number> {
    return new ServiceExecution(Promise.resolve({ ok: true, data: 1 }));
  }
}

class GoodServiceWithProperty
  extends Service<TestContext>
  implements ServiceExecutionContract<GoodServiceWithProperty>
{
  readonly find = (): ServiceExecution<number> =>
    new ServiceExecution(Promise.resolve({ ok: true, data: 1 }));

  constructor() {
    super(createContext(), createTransaction);
  }
}

class GoodServiceWithProtectedMethod
  extends Service<TestContext>
  implements ServiceExecutionContract<GoodServiceWithProtectedMethod>
{
  constructor() {
    super(createContext(), createTransaction);
  }

  find(): ServiceExecution<number> {
    return new ServiceExecution(Promise.resolve({ ok: true, data: 1 }));
  }

  protected async helper(): Promise<number> {
    return 1;
  }
}

class BadService extends Service<TestContext> {
  constructor() {
    super(createContext(), createTransaction);
  }

  find(): Promise<number> {
    return Promise.resolve(1);
  }
}

class BadPropertyService extends Service<TestContext> {
  readonly find = (): Promise<number> => Promise.resolve(1);

  constructor() {
    super(createContext(), createTransaction);
  }
}

class AsyncService extends Service<TestContext> {
  constructor() {
    super(createContext(), createTransaction);
  }

  async find(): Promise<ServiceExecution<number>> {
    return new ServiceExecution(Promise.resolve({ ok: true, data: 1 }));
  }
}

describe("ServiceExecutionContract", () => {
  it("accepts a service whose public methods return ServiceExecution", () => {
    const service = new GoodService();
    const contract: ServiceExecutionContract<GoodService> = service;

    expect(contract).toBe(service);
  });

  it("accepts function-valued public properties that return ServiceExecution", () => {
    const service = new GoodServiceWithProperty();
    const contract: ServiceExecutionContract<GoodServiceWithProperty> = service;

    expect(contract).toBe(service);
  });

  it("ignores protected methods", () => {
    const service = new GoodServiceWithProtectedMethod();
    const contract: ServiceExecutionContract<GoodServiceWithProtectedMethod> = service;

    expect(contract).toBe(service);
  });

  it("rejects a public method returning anything else", () => {
    const service = new BadService();
    // Type '() => Promise<number>' is not assignable to
    // '{ "Service method \"find\" must return ServiceExecution": never; }'.
    // @ts-expect-error public methods must return ServiceExecution
    const contract: ServiceExecutionContract<BadService> = service;

    expect(contract).toBe(service);
  });

  it("rejects a function-valued public property returning anything else", () => {
    const service = new BadPropertyService();
    // @ts-expect-error public functions must return ServiceExecution
    const contract: ServiceExecutionContract<BadPropertyService> = service;

    expect(contract).toBe(service);
  });

  it("rejects an async public method wrapping the execution in a promise", () => {
    const service = new AsyncService();
    // @ts-expect-error async methods return Promise<ServiceExecution>, not ServiceExecution
    const contract: ServiceExecutionContract<AsyncService> = service;

    expect(contract).toBe(service);
  });
});
