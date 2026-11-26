import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One global run for the whole monorepo, split by file name:
    // *.integration.test.ts goes to the `integration` project, every other
    // *.test.ts is a unit test, with or without the `.unit` qualifier.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/{src,test}/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/*/{src,test}/**/*.integration.test.ts"],
        },
      },
    ],
  },
});
