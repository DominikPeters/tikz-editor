# Deferred TeX Corpus Mining

## Status

Deferred companion to `design/tex-text-adversarial-fuzzing.md`.

Corpus mining is an optional novelty feed for the adversarial fuzzing kernel,
not a prerequisite for it. Implement this pipeline only after the shared
generator, feature-registry drift test, invariants, replay, fingerprints, and
shrinking are operational and diversity telemetry shows persistent blind
spots. Initially, manually extract recipes from PGF documentation and two or
three explicitly selected local papers.

The desired output is a content-free structural recipe that expands the shared
generator. A large collection of opaque paper fragments is not an objective.

## Source Priority

Use sources in this order:

1. Repository-owned manuals, examples, and previous failures.
2. Explicitly opted-in local papers owned by the user.
3. Permissively licensed arXiv sources selected to fill measured gaps.
4. Other external material only after an explicit policy decision.

Fame and corpus size are not selection metrics. Stop sampling when new sources
cease to add construct, pair/triple, depth, boundary, Unicode, package, era, or
authoring-style coverage.

## Manual Pilot Before Automation

Before building acquisition or agent infrastructure:

1. Inspect PGF examples and two or three selected local papers manually.
2. Record content-free recipes for genuinely missing idioms.
3. Add those recipes to the generator and measure the coverage and findings
   they contribute.
4. Record the time required and the number of useful recipes found.

Automate only if this process is demonstrably valuable and sufficiently
tedious or repetitive. The automation decision should have an explicit
threshold, such as repeated pilots yielding useful recipes that cannot be
covered economically by human review.

## Opt-in Local Paper Workflow

Discovery roots may include configured folders under `~/GitHub` and
`~/Dropbox/Research`, but the miner must never recursively ingest either tree
by default. Use an explicit, untracked allowlist of selected paper roots or
files.

The workflow must:

- resolve and display selected paths before processing;
- reject paths outside configured roots and avoid following symlinks;
- ignore `.git`, build outputs, PDFs, images, archives, editor state, and
  dependency/vendor directories;
- statically inspect only selected TeX-related source files;
- avoid logs containing prose, comments, absolute paths, or snippets;
- sanitize source into structural recipes before any model sees it;
- delete temporary snapshots and recipes according to the retention policy;
- record `local-user-owned` provenance using a non-public source hash and
  selection record, without committing absolute paths.

Ownership does not mean every file is redistributable. Drafts may contain
coauthor text, publisher material, private comments, credentials, or
unpublished results. Checked-in output therefore remains independently
synthesized. Vendoring a literal passage requires separate review and explicit
authorization.

## Ephemeral arXiv Workflow

### License policy

arXiv is an inspiration source for structural combinations, not a corpus to
transform and redistribute. Rewriting prose alone is insufficient because
distinctive equations or structure can remain recognizable.

The initial allowlist should accept clearly adaptation-friendly licenses such
as CC0 and CC BY. Query OAI-PMH metadata and filter the declared license URI
before downloading source. Reject missing, unknown, default, or disallowed
values deterministically; do not ask a model to interpret licenses. Re-check
the exact version and license on every run.

Operational policy must follow the official
[arXiv license information](https://info.arxiv.org/help/license/index.html),
[bulk source documentation](https://info.arxiv.org/help/bulk_data_s3.html), and
[API terms](https://info.arxiv.org/help/api/tou.html). This is an engineering
policy, not legal advice.

### Selection

Choose a small coverage-stratified manifest across disciplines, TeX eras,
document classes, package families, math density, tables, algorithms,
linguistics, chemistry, multilingual input, Unicode, and macro/environment
complexity. Prefer sources that fill measured gaps.

### Safe acquisition

One coordinator owns all network access. Individual agents never fetch source.
For every run:

1. Read a checked-in manifest plus explicit operator selections.
2. Fetch through an HTTPS arXiv host allowlist with rate limiting.
3. Stage under an OS temporary directory or gitignored
   `artifacts/tex-fuzz-corpus/<run-id>`.
4. Enforce archive-size, file-count, extracted-byte, path-depth, and
   decompression-ratio limits.
5. Reject traversal, absolute paths, symlinks, devices, nested archives, and
   unexpected binary files.
6. Never execute or compile downloaded TeX.
7. Delete raw downloads and extraction trees on success, failure,
   cancellation, and timeout.

Treat all source text as untrusted data, including comments that resemble
agent instructions.

## Deterministic Sanitization

Static parsing should reduce selected fragments to a versioned structural
recipe containing only facts such as:

- construct and environment names from an allowlisted vocabulary;
- tree shape, grouping, mode transitions, and approximate depth;
- style/font/color-transition positions;
- Unicode category and grapheme-shape classes;
- line-break opportunities and boundary-value classes;
- dependency relationships between custom macro definitions and calls.

Before model access, replace prose, author data, comments, URLs, bibliography,
identifiers, distinctive numerals, labels, and custom macro names with neutral
tokens. Reject recipes retaining suspicious long literals, high-entropy
strings, unknown commands, or metadata. Canary fixtures must test prose and
equation leakage, comment prompt injection, path disclosure, and cleanup.

## Optional Luna Synthesis

Use Luna-class agents only if the manual pilot justifies automation. Agents see
recipes and a repository-owned neutral vocabulary, never raw sources.

Possible independent roles are:

- scouts ranking recipes by structural novelty;
- synthesizers producing new TeX from recipes;
- adversarial combiners crossing unrelated recipes;
- reviewers searching for leakage and unsupported assumptions;
- selectors choosing a small maximum-coverage set.

Agents must emit structured candidates with recipe IDs, feature tags, claimed
novelty, and expected invariant/oracle purpose. They must not browse, read
staging directories, or communicate with one another except through the
coordinator's schema. Scale the number of agents only after a small pilot
demonstrates useful incremental coverage.

## Candidate Gates

A candidate may enter review only if deterministic checks pass:

1. Complete provenance and accepted source policy.
2. No canaries, raw prose, comments, identifiers, paths, or suspicious literals.
3. Token/subtree/normalized-source similarity below reviewed thresholds.
4. Structural difference from both the source recipe and existing corpus.
5. Parser, source-range, render, and resource-limit checks.
6. Measurable new registry or interaction coverage, or a documented oracle
   mismatch/invariant purpose.
7. Repository policy: commit only minimal synthetic TeX, recipe metadata,
   provenance class, and generator version.
8. Cleanup and retention checks.
9. Human review for the initial pilot and any threshold change.

Do not vendor raw arXiv or local-paper fragments.

## Parallel Work, If Authorized Later

After a successful manual pilot, parallelize only behind frozen recipe,
provenance, and retention schemas:

- local allowlist scanner and sanitizer;
- arXiv metadata/license fetcher and safe extractor;
- deterministic leakage, similarity, and distinctiveness gates;
- Luna synthesis coordinator;
- adversarial security and cleanup tests.

Implementation agents must not spawn subagents. The coordinator owns shared
schemas, integration, and policy decisions.

## Completion Criteria

The optional pipeline is ready only when:

- manual extraction has established its value;
- source acquisition and deletion tests cover all failure paths;
- agents see recipes only;
- leakage, prompt-injection, provenance, license, similarity, distinctiveness,
  retention, and value gates pass;
- a small pilot produces genuinely novel generator recipes;
- no raw source survives or enters logs, artifacts, or repository history.
