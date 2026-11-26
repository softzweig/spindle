import { describe, expect, it, vi } from "vitest";
import type { ServiceExecution } from "../../src/service/service.execution.js";
import {
  Service,
  type ServiceContext,
  type ServiceExecutionContract,
} from "../../src/service/service.js";
import { lazy } from "../../src/service/service.lazy.js";

/** A runner that opens no transaction, enough for the context plumbing under test. */
const runInline = async <TContext, T>(
  context: TContext,
  fn: (context: TContext) => Promise<T>,
): Promise<T> => fn(context);

class AssetService
  extends Service<ServiceContext<{ readonly resources: ResourceService }>>
  implements ServiceExecutionContract<AssetService>
{
  find(): ServiceExecution<string> {
    return this.prepare(async () => "asset");
  }

  describeResource(): ServiceExecution<string> {
    return this.prepare(async () => `asset sees ${await this.context.resources.find().unwrap()}`);
  }
}

class ResourceService
  extends Service<ServiceContext<{ readonly assets: AssetService }>>
  implements ServiceExecutionContract<ResourceService>
{
  find(): ServiceExecution<string> {
    return this.prepare(async () => "resource");
  }

  describeAsset(): ServiceExecution<string> {
    return this.prepare(async () => `resource sees ${await this.context.assets.find().unwrap()}`);
  }
}

class GatewayService
  extends Service<ServiceContext<{ readonly assets: AssetService }>>
  implements ServiceExecutionContract<GatewayService>
{
  describeAsset(): ServiceExecution<string> {
    return this.prepare(async () => `gateway sees ${await this.context.assets.find().unwrap()}`);
  }
}

const createServices = () => {
  // The annotations break the inference cycle: each service's context names the other,
  // so neither constant can take its type from the expression that creates it.
  const assets: AssetService = new AssetService(
    { isInTransaction: false, resources: lazy(() => resources) },
    runInline,
  );
  const resources: ResourceService = new ResourceService(
    { isInTransaction: false, assets: lazy(() => assets) },
    runInline,
  );

  return { assets, resources };
};

describe("lazy context members", () => {
  it("resolves a dependency on access", async () => {
    const { assets } = createServices();

    await expect(assets.describeResource().unwrap()).resolves.toBe("asset sees resource");
  });

  it("resolves a cycle in both directions", async () => {
    const { assets, resources } = createServices();

    await expect(assets.describeResource().unwrap()).resolves.toBe("asset sees resource");
    await expect(resources.describeAsset().unwrap()).resolves.toBe("resource sees asset");
  });

  it("does not resolve anything while the service is being constructed", () => {
    const { resources } = createServices();
    const resolve = vi.fn(() => resources);
    const assets = new AssetService(
      { isInTransaction: false, resources: lazy(resolve) },
      runInline,
    );

    expect(assets).toBeInstanceOf(AssetService);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves on every access, without caching", async () => {
    const { resources } = createServices();
    const resolve = vi.fn(() => resources);
    const assets = new AssetService(
      { isInTransaction: false, resources: lazy(resolve) },
      runInline,
    );

    await assets.describeResource().unwrap();
    await assets.describeResource().unwrap();

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("keeps the dependency reachable inside a transaction", async () => {
    const { assets } = createServices();

    const found = await assets.transaction(async function () {
      return this.context.resources.find().unwrap();
    });

    expect(found).toBe("resource");
  });

  it("accepts a dependency that is not lazy", async () => {
    const { assets } = createServices();
    const gateway = new GatewayService({ isInTransaction: false, assets }, runInline);

    await expect(gateway.describeAsset().unwrap()).resolves.toBe("gateway sees asset");
  });

  it("still requires the execution contract of a lazy dependency", () => {
    class LooseService extends Service<ServiceContext> {
      find(): Promise<string> {
        return Promise.resolve("loose");
      }
    }

    const context: ServiceContext<{ readonly loose: LooseService }> = {
      isInTransaction: false,
      // @ts-expect-error a lazy dependency still has to implement the contract
      loose: lazy(() => new LooseService({ isInTransaction: false }, runInline)),
    };

    expect(context.isInTransaction).toBe(false);
  });
});
