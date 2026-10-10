# Evaluation and rate-limit regression tests

```sh
npm run eval:test       # deterministic evaluation metrics
npm run eval:test:rl    # actual classifier, orchestrator, and RPC wrappers
npm run test:operations # actual compare/analysis/investigation handlers
```

These tests use no OpenAI or database traffic. Production dependencies are
substituted at their network boundary; business logic is not duplicated.

Real PostgreSQL concurrency, permissions, migrations, and rollback checks live
in `scripts/tests/operations-db.test.ts`. See [the remediation test guide](../../tests/README.md)
for setup, safety restrictions, architecture, quota retry rules, and limitations.
