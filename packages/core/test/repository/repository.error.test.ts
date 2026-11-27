import { describe, expect, it, test } from "vitest";
import { RepositoryError } from "../../src/repository/repository.error.js";
import { SpindleErrorCode } from "../../src/result.js";

describe("RepositoryError", () => {
  it("carries code, message, details, and a stable name", () => {
    const details = { id: 1 };
    const error = new RepositoryError(SpindleErrorCode.CONFLICT, "Conflict", details);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RepositoryError");
    expect(error.code).toBe(SpindleErrorCode.CONFLICT);
    expect(error.message).toBe("Conflict");
    expect(error.details).toBe(details);
  });

  test.for([
    ["notFound", SpindleErrorCode.NOT_FOUND],
    ["invalidInput", SpindleErrorCode.INVALID_INPUT],
    ["forbidden", SpindleErrorCode.FORBIDDEN],
    ["conflict", SpindleErrorCode.CONFLICT],
    ["preconditionFailed", SpindleErrorCode.PRECONDITION_FAILED],
    ["unavailable", SpindleErrorCode.UNAVAILABLE],
    ["unknown", SpindleErrorCode.UNKNOWN],
  ] as const)("%s builds a %s error", ([factory, code]) => {
    const details = { id: 1 };
    const error = RepositoryError[factory]("Message", details);

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error.code).toBe(code);
    expect(error.message).toBe("Message");
    expect(error.details).toBe(details);
  });

  it("builds an error for an explicit code", () => {
    expect(RepositoryError.of(SpindleErrorCode.UNAVAILABLE, "Down")).toMatchObject({
      code: SpindleErrorCode.UNAVAILABLE,
      message: "Down",
    });
  });
});
