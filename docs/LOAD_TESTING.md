# Load Testing & Performance Gate

The load-test suite drives the Express app (in mock-Stellar mode) with
concurrent virtual users, measures latency / throughput / error rate per
scenario, and **fails CI when results regress beyond defined thresholds**
(issue #1167). Because the `.github/workflows/load-tests.yml` job runs on every
pull request and push to `main`/`master`, a regression blocks the merge.

## Running locally

```bash
npm run test:load -- --concurrency 10 --iterations 50 --warmup 10
```

| Flag            | Default | Meaning                                            |
|-----------------|---------|----------------------------------------------------|
| `--concurrency` | 10      | Concurrent virtual users                           |
| `--iterations`  | 50      | Measured requests per scenario                     |
| `--warmup`      | 5       | Discarded warm-up requests per scenario (see below)|
| `--output`      | reports/load | Directory for the JSON/HTML reports           |

The runner exits non-zero if any scenario breaches its threshold, prints a
per-scenario pass/fail summary, and writes JSON + HTML reports. In GitHub
Actions it also appends a metrics table to the job summary so reviewers see the
numbers even on a pass.

## Thresholds (SLOs)

Targets are defined per scenario in
[`tests/load/PerformanceBaselines.js`](../tests/load/PerformanceBaselines.js):
`p50` / `p95` / `p99` latency ceilings (ms), a minimum throughput (req/s), and a
maximum error rate. To change a *target*, edit that file. Current defaults:

| Scenario            | Route                      | p50 | p95 | p99  | min req/s | max error rate |
|---------------------|----------------------------|-----|-----|------|-----------|----------------|
| `liveness`          | `GET /health/live`         | 50  | 150 | 300  | 20        | 1%             |
| `list-donations`    | `GET /api/v1/donations`    | 100 | 300 | 600  | 10        | 2%             |
| `donation-creation` | `POST /api/v1/donations`   | 200 | 500 | 1000 | 5         | 5%             |

## Handling runner variance

Shared CI runners are noisy, so absolute latency varies run-to-run. Two
mechanisms keep the gate meaningful without being flaky:

1. **Warm-up** — `--warmup N` runs `N` discarded requests per scenario before
   measurement, so cold-start cost (JIT, lazy `require`s, first DB connection)
   doesn't pollute the steady-state numbers.
2. **Margins** — three environment variables widen the *tolerance* (not the
   targets), applied by `resolveBaselines()`:

   | Env var                       | Default | Effect                                  |
   |-------------------------------|---------|-----------------------------------------|
   | `LOAD_TEST_LATENCY_MARGIN`    | 1.0     | Multiplies every latency ceiling        |
   | `LOAD_TEST_THROUGHPUT_MARGIN` | 1.0     | Multiplies every min-throughput floor   |
   | `LOAD_TEST_ERROR_RATE_MARGIN` | 1.0     | Multiplies every max-error-rate ceiling |

   The CI workflow sets `LOAD_TEST_LATENCY_MARGIN=2.0` and
   `LOAD_TEST_THROUGHPUT_MARGIN=0.5` to absorb shared-runner slowness; locally
   the defaults (no margin) apply.
