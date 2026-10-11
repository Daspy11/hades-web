# HADES tests

The Haskell test driver `hades/test/Main.hs` only ran the four test modules in turn
(document, expression, GI and AutoMonad tests) and set the exit code from their results. It has
no other logic, so it has no TypeScript counterpart: vitest finds every `src/**/*.test.ts` file
(see `test.include` in `vite.config.ts`) and runs each suite by itself.

The ported suites in this directory are:

| Haskell module               | vitest suite                          |
|------------------------------|---------------------------------------|
| `Test.Expression`            | `Test/Expression.test.ts`             |
| `Test.AutoMonad.Exceptions`  | `Test/AutoMonad/Exceptions.test.ts`   |
| `Test.GI.PackageTree`        | `Test/GI/PackageTree.test.ts`         |
| `Test.Report.TestDocument`   | `Test/Report/TestDocument.test.ts`    |

Run all of them with `npx vitest run src/hades/test`, or one at a time with
`npx vitest run src/hades/test/Test/AutoMonad/Exceptions.test.ts`. `npm test` runs these suites
along with the unit tests that sit next to the modules under `src/`.
