import { describe, expect, it } from "vitest";
import { AbstractRepository } from "../../src/repository/repository.abstract.js";
import type {
  Entity,
  EntityFilter,
  EntityId,
  EntityInsert,
  EntityPatch,
  RepositoryContext,
} from "../../src/repository/repository.js";

type User = Entity & { name: string; age: number };
type UserId = EntityId<User>;
type UserFilter = EntityFilter<User>;
type UserInsert = EntityInsert<User>;
type UserPatch = EntityPatch<User>;

const ada: User = { id: 1, name: "Ada", age: 36 };
const grace: User = { id: 2, name: "Grace", age: 45 };

class RecordingRepository extends AbstractRepository<User, RepositoryContext, UserFilter> {
  findManyResult: User[] = [];
  fetchPageResult: User[] = [];
  patchWhereResult: User[] = [];
  deleteWhereResult: User[] = [];

  readonly idFilterCalls: UserId[][] = [];
  readonly findManyCalls: Array<Readonly<UserFilter & { limit?: number }>> = [];
  readonly fetchPageCalls: Array<{
    filter: Readonly<UserFilter> | undefined;
    cursor: UserId | undefined;
    limit: number;
  }> = [];
  readonly patchWhereCalls: Array<{ filter: Readonly<UserFilter>; patch: UserPatch }> = [];
  readonly deleteWhereCalls: Array<Readonly<UserFilter>> = [];

  async findMany(filter: Readonly<UserFilter & { limit?: number }>): Promise<User[]> {
    this.findManyCalls.push(filter);
    return this.findManyResult;
  }

  protected async fetchPage(
    filter: Readonly<UserFilter> | undefined,
    cursor: UserId | undefined,
    limit: number,
  ): Promise<User[]> {
    this.fetchPageCalls.push({ filter, cursor, limit });
    return this.fetchPageResult;
  }

  async insert(_dto: Readonly<UserInsert>): Promise<User> {
    return ada;
  }

  async patchWhere(filter: Readonly<UserFilter>, patch: UserPatch): Promise<User[]> {
    this.patchWhereCalls.push({ filter, patch });
    return this.patchWhereResult;
  }

  async deleteWhere(filter: Readonly<UserFilter>): Promise<User[]> {
    this.deleteWhereCalls.push(filter);
    return this.deleteWhereResult;
  }

  idFilter(ids: readonly UserId[]): UserFilter {
    this.idFilterCalls.push([...ids]);
    return { id: [...ids] };
  }
}

function neverCalled<T>(): Promise<T> {
  return Promise.reject(new Error("Transaction runner must not be called"));
}

function createRepository() {
  return new RecordingRepository({ isInTransaction: false }, neverCalled, {
    read: (user) => user.id,
  });
}

describe("AbstractRepository lookups", () => {
  it("findById queries by id and returns the first match", async () => {
    const repository = createRepository();
    repository.findManyResult = [ada];

    await expect(repository.findById(1)).resolves.toBe(ada);
    expect(repository.idFilterCalls).toEqual([[1]]);
    expect(repository.findManyCalls).toEqual([{ id: [1] }]);
  });

  it("findById returns null when nothing matches", async () => {
    const repository = createRepository();

    await expect(repository.findById(2)).resolves.toBeNull();
  });

  it("findByIds queries all ids at once", async () => {
    const repository = createRepository();
    repository.findManyResult = [ada, grace];

    await expect(repository.findByIds([1, 2])).resolves.toEqual([ada, grace]);
    expect(repository.idFilterCalls).toEqual([[1, 2]]);
  });

  it("findByIds short-circuits an empty list", async () => {
    const repository = createRepository();

    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(repository.idFilterCalls).toEqual([]);
    expect(repository.findManyCalls).toEqual([]);
  });

  it("findOne returns the first match and forwards the filter", async () => {
    const repository = createRepository();
    const filter: UserFilter = { name: "Ada" };
    repository.findManyResult = [ada, grace];

    await expect(repository.findOne(filter)).resolves.toBe(ada);
    expect(repository.findManyCalls[0]).toBe(filter);
  });

  it("findOne returns null when nothing matches", async () => {
    const repository = createRepository();

    await expect(repository.findOne({ name: "Nobody" })).resolves.toBeNull();
  });

  it("exists reports whether a row matches", async () => {
    const repository = createRepository();
    const filter: UserFilter = { age: 36 };

    repository.findManyResult = [ada];
    await expect(repository.exists(filter)).resolves.toBe(true);

    repository.findManyResult = [];
    await expect(repository.exists(filter)).resolves.toBe(false);
  });

  it("count returns the number of matching rows", async () => {
    const repository = createRepository();
    const filter: UserFilter = { age: 36 };
    repository.findManyResult = [ada, grace];

    await expect(repository.count(filter)).resolves.toBe(2);
    expect(repository.findManyCalls[0]).toBe(filter);
  });
});

describe("AbstractRepository mutations", () => {
  it("patch updates through patchWhere and returns the first row", async () => {
    const repository = createRepository();
    const patch: UserPatch = { name: "Augusta" };
    const updated: User = { ...ada, name: "Augusta" };
    repository.patchWhereResult = [updated];

    await expect(repository.patch(1, patch)).resolves.toBe(updated);
    expect(repository.idFilterCalls).toEqual([[1]]);
    expect(repository.patchWhereCalls).toEqual([{ filter: { id: [1] }, patch }]);
  });

  it("patch throws when no row matches", async () => {
    const repository = createRepository();

    await expect(repository.patch(2, { name: "Nobody" })).rejects.toThrow(
      "Entity with id 2 not found",
    );
  });

  it("delete removes through deleteWhere", async () => {
    const repository = createRepository();
    repository.deleteWhereResult = [ada];

    await expect(repository.delete([1])).resolves.toEqual([ada]);
    expect(repository.idFilterCalls).toEqual([[1]]);
    expect(repository.deleteWhereCalls).toEqual([{ id: [1] }]);
  });

  it("delete short-circuits an empty list", async () => {
    const repository = createRepository();

    await expect(repository.delete([])).resolves.toEqual([]);
    expect(repository.deleteWhereCalls).toEqual([]);
  });
});

describe("AbstractRepository list", () => {
  it("asks for one row more than the page holds", async () => {
    const repository = createRepository();

    await repository.list({ limit: 2 });

    expect(repository.fetchPageCalls).toEqual([{ filter: undefined, cursor: undefined, limit: 3 }]);
  });

  it("returns the page and the cursor of its last item", async () => {
    const repository = createRepository();
    repository.fetchPageResult = [ada, grace, { id: 3, name: "Lin", age: 27 }];

    const page = await repository.list({ limit: 2 });

    expect(page.items).toEqual([ada, grace]);
    expect(page.nextCursor).toBe(grace.id);
  });

  it("returns no next cursor for the last page", async () => {
    const repository = createRepository();
    repository.fetchPageResult = [ada];

    const page = await repository.list({ limit: 2 });

    expect(page.items).toEqual([ada]);
    expect(page.nextCursor).toBeNull();
  });

  it("returns no next cursor when the page is empty", async () => {
    const page = await createRepository().list({ limit: 2 });

    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("forwards the filter and the cursor", async () => {
    const repository = createRepository();
    const filter: UserFilter = { name: "Ada" };

    await repository.list({ limit: 5, cursor: 2, filter });

    expect(repository.fetchPageCalls[0]).toEqual({ filter, cursor: 2, limit: 6 });
  });

  it("rejects a page size that is not a positive integer", async () => {
    const repository = createRepository();

    await expect(repository.list({ limit: 0 })).rejects.toThrow("page limit must be");
    await expect(repository.list({ limit: 2.5 })).rejects.toThrow(RangeError);
    expect(repository.fetchPageCalls).toEqual([]);
  });
});

describe("AbstractRepository transactions", () => {
  it("inherits transactional context handling", () => {
    const repository = createRepository();
    const original = repository.getContext();
    const next = { isInTransaction: true };

    const bound = repository.withContext(next);

    expect(bound).not.toBe(repository);
    expect(bound.getContext()).not.toBe(next);
    expect(bound.getContext()).toEqual(next);
    expect(repository.getContext()).toBe(original);
  });
});
