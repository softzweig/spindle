import type { Repository } from "../repository/repository.js";
import { Service, type ServiceContext, type ServiceExecutionContract } from "./service.js";

type AssetServiceContext = ServiceContext<{
  repository: Repository<{ id: string; key: string }>;
}>;

export class AssetService
  extends Service<AssetServiceContext>
  implements ServiceExecutionContract<AssetService>
{
  greet() {
    return this.execute(async () => {
      return "Hello world" as const;
    });
  }
}

const service = new AssetService(
  {
    isInTransaction: false,
    repository: null as unknown as Repository<{ id: string; key: string }>,
  },
  (ctx, cb) => cb(ctx),
);

void service.greet();
