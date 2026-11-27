import { describe, expect, it, test } from "vitest";
import { SpindleErrorCode } from "../../src/result.js";
import { ServiceError } from "../../src/service/service.error.js";

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw");
}

describe("ServiceError", () => {
  it("carries code, message, details, and a stable name", () => {
    const details = { field: "id" };
    const error = new ServiceError(SpindleErrorCode.CONFLICT, "Conflict", details);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ServiceError");
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
    const details = { field: "id" };
    const error = ServiceError[factory]("Message", details);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe(code);
    expect(error.message).toBe("Message");
    expect(error.details).toBe(details);
  });
});

describe("ServiceError.assert", () => {
  test.for([
    ["true", true],
    ["a number", 1],
    ["a string", "value"],
    ["an object", {}],
    ["an array", []],
  ] as const)("accepts %s", ([, condition]) => {
    expect(() => ServiceError.assert(condition, "Message")).not.toThrow();
  });

  test.for([
    ["false", false],
    ["zero", 0],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ] as const)("rejects %s", ([, condition]) => {
    const error = captureError(() => ServiceError.assert(condition, "Message"));

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: SpindleErrorCode.PRECONDITION_FAILED,
      message: "Message",
    });
  });

  it("uses an explicit code and details", () => {
    const details = { field: "id" };
    const error = captureError(() =>
      ServiceError.assert(false, "Message", details, SpindleErrorCode.CONFLICT),
    );

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: SpindleErrorCode.CONFLICT,
      message: "Message",
      details,
    });
  });
});

describe("specific assertions", () => {
  test.for([
    ["assertFound", SpindleErrorCode.NOT_FOUND],
    ["assertConflict", SpindleErrorCode.CONFLICT],
    ["assertAllowed", SpindleErrorCode.FORBIDDEN],
    ["assertValidInput", SpindleErrorCode.INVALID_INPUT],
    ["assertAvailable", SpindleErrorCode.UNAVAILABLE],
  ] as const)("%s rejects with %s", ([guard, code]) => {
    const error = captureError(() => ServiceError[guard](false, "Message"));

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code, message: "Message" });
  });
});

describe("ServiceError.assertPermitted", () => {
  it("accepts true", () => {
    expect(() => ServiceError.assertPermitted(true)).not.toThrow();
  });

  test.for([
    ["a custom reason", "Custom reason", "Custom reason"],
    ["an empty string", "", "Not permitted"],
    ["false", false, "Not permitted"],
    ["undefined", undefined, "Not permitted"],
    ["null", null, "Not permitted"],
  ] as const)("rejects %s", ([, verdict, message]) => {
    const details = { resource: "asset" };
    const error = captureError(() => ServiceError.assertPermitted(verdict, details));

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      code: SpindleErrorCode.FORBIDDEN,
      message,
      details,
    });
  });
});
