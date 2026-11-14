# International national-team results source audit

**Audit date:** 2026-11-14  
**Scope:** Pinned upstream men's and women's national-team result CSVs used as the basis for the Mon Sport Info international-results catalogue.  
**Status:** Structural audit passed in CI; production import is not yet approved.

## Source versions

| Category | Repository | Commit | Git blob SHA | Rows | Date range | Competition labels |
|---|---|---|---|---:|---|---:|
| Men's | [martj42/international_results](https://github.com/martj42/international_results) | `b0948cb558c927c357db4067eac5b37b96d0e4bb` | `9999a4b380b16189825884a8dab4dc869c847f72` | 49,940 | 1872-11-30 – 2026-10-06 | 225 |
| Women's | [martj42/womens-international-results](https://github.com/martj42/womens-international-results) | `d2aa1d5e5337881481b04844339f8a43a5f132f2` | `79b2b220e5a430f311258154348090f1fa606a19` | 11,816 | 1956-09-23 – 2026-10-13 | 117 |
| **Combined** | | | | **61,756** | 1872-11-30 – 2026-10-13 | Separate taxonomies |

The combined count matches Mon Sport Info's 8 November 2026 ingestion status (61,756), while the catalogue page still displays 61,170. This audit pins the upstream source files; it does **not** claim byte-for-byte identity with Mon Sport Info's own export.

## Structural validation

| Check | Men's | Women's |
|---|---:|---:|
| Invalid calendar dates | 0 | 0 |
| Invalid / negative / non-integer scores | 0 | 0 |
| Blank fields or malformed row widths | 0 | 0 |
| Invalid neutral flags | 0 | 0 |
| Exact duplicate rows | 0 | 0 |
| Duplicate fixture keys (date + home + away + tournament) | 1 | 0 |
| Scores above FAL's current 0–30 import limit | 1 | 0 |

### Manual review required

1. **Conflicting duplicate fixture — men's data.** Two records for Tahiti v New Caledonia, 1974-02-17, Friendly, Papeete, have opposite results: 2–1 and 1–2. Both rows must be quarantined pending authoritative source verification. Do not choose one automatically.
2. **Score above configured limit — men's data.** Australia 31–0 American Samoa, 2001-04-11, FIFA World Cup qualification. This is a recorded result, not a parse error. Current FAL importer accepts 0–30, so quarantine and preserve this row; never cap it to 30 or silently discard it.
3. **Women's source completeness.** The women's repository README describes the dataset as work-in-progress and says many results are still missing. Its README count (11,020) is older than the pinned current CSV count (11,816). Do not interpret this as complete global coverage.

## Competition / friendly labels

| Label family | Men's rows | Women's rows | Combined |
|---|---:|---:|---:|
| Exact tournament label `Friendly` | 18,258 | 1,328 | 19,586 |
| Other tournament labels containing “friend” | 106 | 29 | 135 |

The other friendly-like labels must remain separate until reviewed. A label containing “friend” is not automatically equivalent to a FIFA-recognized A international friendly.

The women's source contains **182 Olympic-labelled rows**. Keep them in a separate competition bucket for model training and reporting. The men's source README explicitly says its dataset is men's full internationals only and excludes Olympic Games, U23, B teams, and league selections.

## Gender, age and FIFA status

- Assign gender from source provenance: men's repository vs women's repository. Never infer it from team names.
- The raw result schema has no explicit age-category field. The men's README documents senior/full internationals and excludes U23/B-team/league-select matches. The women's source is work-in-progress and does not establish a complete age-category contract. Absence of U17/U20/U23 tournament strings is not proof that all women's records are senior.
- Neither CSV has a verified FIFA-sanctioning field. Tournament names are not proof of FIFA recognition. Default any unverified record to `fifa_status=not_verified` until an authoritative federation/FIFA source and evidence URL are attached.
- Keep club matches, senior men's national teams, senior women's national teams, youth teams, Olympic selections, B teams, and unofficial representative teams in separate partitions. Do not train a club model with national-team results.

## License and attribution

- Men's source repository publishes a CC0-1.0 license.
- Women's source repository publishes an Unlicense / public-domain dedication.
- Mon Sport Info catalogue identifies its international-results dataset as CC0-1.0. Preserve source commit, blob SHA, retrieval date, and attribution/provenance metadata with every imported snapshot.

## CI reproduction

Run:

```bash
npm run audit:international-results
```

The script pins both upstream commits and Git blob SHAs, verifies schema and row counts, checks dates/scores/neutral flags, reports duplicate keys, and prints competition/friendly/Olympic/youth-label summaries. Android Debug CI runs this audit before the web and APK builds.

## Gate decision

**Structural audit: passed for the two pinned upstream CSVs.**  
**Mon Sport Info exact export audit: pending.**  
**FIFA/competition recognition mapping: pending authoritative evidence.**  
**Youth coverage: incomplete / not established.**  
**Production import: not approved until duplicate and 31-goal exceptions are quarantined, taxonomy is reviewed, and the exact export is matched or the pinned upstream files are adopted explicitly.**


## Odds data rights note

Football-Data.co.uk free CSVs are not used by the production FAL pipeline or fetched repeatedly by CI. Its published fair-use policy limits free data to personal betting/academic research and light downloads (up to twice weekly), and explicitly excludes commercial or AI/model-training projects without an appropriate paid agreement. The earlier 760-fixture EPL audit is retained only as a historical one-off technical test; its ROI/CLV output is not a production backtest and must not be used as a performance claim. Prefer a provider whose written terms expressly permit the intended FAL model and app use.
