import { RepositoryError } from "@softzweig/spindle-core/repository";
import { SpindleErrorCode } from "@softzweig/spindle-core/result";
import { describe, expect, it, test } from "vitest";
import { toRepositoryError } from "../src/errors.js";

/** An error shaped like the ones the two drivers throw. */
function driverError(code: string, extendedCode?: string) {
  return Object.assign(new Error("driver failed"), { code, extendedCode });
}

/** The wrapper drizzle throws, with the driver's error underneath it. */
function wrapped(cause: unknown) {
  return Object.assign(new Error("Failed query: insert into assets"), { cause });
}

describe("toRepositoryError", () => {
  test.for([
    ["a postgres unique violation", driverError("23505"), SpindleErrorCode.CONFLICT],
    [
      "a sqlite unique index",
      driverError("SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE"),
      SpindleErrorCode.CONFLICT,
    ],
    [
      "a sqlite primary key",
      driverError("SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_PRIMARYKEY"),
      SpindleErrorCode.CONFLICT,
    ],
    ["a postgres not-null violation", driverError("23502"), SpindleErrorCode.INVALID_INPUT],
    ["a postgres foreign key violation", driverError("23503"), SpindleErrorCode.INVALID_INPUT],
    ["a postgres check violation", driverError("23514"), SpindleErrorCode.INVALID_INPUT],
    [
      "a sqlite not-null violation",
      driverError("SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_NOTNULL"),
      SpindleErrorCode.INVALID_INPUT,
    ],
    [
      "a sqlite foreign key violation",
      driverError("SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_FOREIGNKEY"),
      SpindleErrorCode.INVALID_INPUT,
    ],
    [
      "a sqlite check violation",
      driverError("SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_CHECK"),
      SpindleErrorCode.INVALID_INPUT,
    ],
  ] as const)("maps %s to %s", ([, error, code]) => {
    const translated = toRepositoryError(error);

    expect(translated).toBeInstanceOf(RepositoryError);
    expect(translated).toMatchObject({ code, message: "driver failed" });
  });

  it("keeps the driver code for the caller", () => {
    expect(toRepositoryError(driverError("23505"))).toMatchObject({
      details: { driverCode: "23505" },
    });
  });

  it("reaches a driver error drizzle wrapped", () => {
    const translated = toRepositoryError(wrapped(driverError("23505")));

    expect(translated).toBeInstanceOf(RepositoryError);
    expect(translated).toMatchObject({
      code: SpindleErrorCode.CONFLICT,
      message: "driver failed",
      details: { driverCode: "23505" },
    });
  });

  test.for([
    ["a connection failure", driverError("08006")],
    ["an error without a code", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
  ] as const)("returns %s untouched", ([, error]) => {
    expect(toRepositoryError(error)).toBe(error);
  });
});
