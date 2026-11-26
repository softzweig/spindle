import { describe, expect, it } from "vitest";
import * as repository from "../src/repository/index.js";
import * as service from "../src/service/index.js";
import * as transactional from "../src/transactional.js";

describe("public module surface", () => {
  it("exports the service primitives", () => {
    expect(service.Service).toBeTypeOf("function");
    expect(service.ServiceError).toBeTypeOf("function");
    expect(service.ServiceExecution).toBeTypeOf("function");
    expect(service.toServiceFailure).toBeTypeOf("function");
  });

  it("exports the repository primitives", () => {
    expect(repository.AbstractRepository).toBeTypeOf("function");
  });

  it("exports the transaction primitives", () => {
    expect(transactional.BaseTransactional).toBeTypeOf("function");
    expect(transactional.FOLLOWS_CONTEXT).toBeTypeOf("symbol");
    expect(transactional.TRANSACTION_EXECUTOR).toBeTypeOf("symbol");
  });
});
