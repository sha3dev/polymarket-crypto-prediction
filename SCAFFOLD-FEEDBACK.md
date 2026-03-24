# Scaffold Feedback

## Friction

- The generated `biome.json` did not ignore managed AI contract files even though the human contract says they are ignored by default. This caused `npm run lint` to fail on `ai/contract.json` until the ignore list was expanded.
- The snapshot dependency chain for `@sha3/polymarket-snapshot` resolves local `file:` dependencies (`@sha3/crypto`, `@sha3/polymarket`) that are not declared in this package scaffold. `npm run test` failed until those packages were added explicitly.
- The scaffold does not include an obvious pattern for feature entrypoints or cross-feature type sharing under the class-first contract, which makes larger feature work require some guesswork.
- Once the service grows beyond pure prediction into execution simulation, the scaffold offers no reference pattern for composing multiple runtime engines (`prediction`, `execution`, `dashboard`) while keeping files small enough for the warning model.

## Ambiguities

- The contract says managed files are ignored by Biome by default, but the repo-level config did not enforce that behavior.
- The class section order is strict, but the template examples do not make the required ordering intuitive when both private and public methods exist in the same class.
- The init workflow requires `SCAFFOLD-FEEDBACK.md` at the end, but the base scaffold does not mention or create that file anywhere visible outside prompt documents.

## Improvement Ideas

- Add managed-file ignores directly to the generated `biome.json`, not only to `.biomeignore`.
- For packages that depend on sibling `file:` packages in development, either publish and depend on registry versions in the scaffold or document the expected extra installs.
- Ship one larger example for a multi-feature node service that includes:
  - a feature state service
  - an HTTP service with several endpoints
  - a public README with exported payload types
  - deterministic tests that inject fake runtime input
- Ship one example specifically showing a “domain engine + paper execution engine + dashboard summary” composition, because that is a natural next step for this kind of node-service scaffold.
- Add a short comment block in the scaffold about the expected `@section` order for class files.
