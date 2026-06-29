# Public Dashboard Application Fit Scoring

Application Fit is generated locally from candidate evidence, job requirements,
and eligibility/preferences in `config/job-search.yml`. Titles primarily drive
discovery and do not materially dominate ranking.

## 100-point model

| Signal | Weight |
|---|---:|
| Skills | 45 |
| Experience | 25 |
| Eligibility | 15 |
| Notice period and education | 10 |
| Other signals | 5 |

Mandatory skills contribute about 70% of the skill signal. Preferred, related,
and transferable skills receive progressively less credit. Resume-backed and
explicitly confirmed skills receive full evidence credit; supporting evidence
remains internal. Education is neutral unless the posting explicitly requires a
degree, certification, or licence.

Experience and notice-period mismatches reduce fit gradually. Unclear location,
remote, visa, or work-authorisation information lowers rank and is surfaced for
verification. Explicit incompatibility can cap the score.

Other signals include compensation, preferred industry, source reliability,
and freshness. They fine-tune ranking but cannot outweigh primary compatibility.
Freshness uses 0–14, 15–30, and 31–60-day bands. Confirmed postings older than
60 days are excluded; unknown dates remain visible and flagged.

Every normalized result exposes strengths, concerns, missing information,
recommended action, freshness, source, score breakdown, and any hard gates.
