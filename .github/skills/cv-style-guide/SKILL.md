---
name: cv-style-guide
description: "CV writing rules for Avanade consultant experience descriptions in English and French: marketable client-facing tone, readable structure, value signals, banned filler, EN/FR conventions. Use when: writing, restructuring, enriching or translating a CV experience."
user-invocable: false
---

# CV Style Guide (Avanade consultant profile)

## Audience and goal

The CV is read by Avanade staffing managers and by **client decision-makers from any industry**. It is not tailored to a job offer.
Each experience must make a reader from another company think: *"this person understood the need, made smart choices, and would do the same for us."*

## Input format

The user provides two parts (the second is optional):

1. **CV entry**: the existing experience copy-pasted from the CV: title, role, solutions, description. It may contain several projects (e.g. "DetteIT + RSSI").
2. **Summary**: the user's own words about what they actually did. Usually richer than the CV entry: it is a primary source of facts, reasoning and technologies.

Both parts are facts. When they conflict, the summary wins and the conflict is reported in the brain notes.
Template: `experiences/inbox/_template.md`.

## Experience file format

Every stage (structured, enriched, EN, FR) uses the same Markdown format:

```markdown
---
slug: <kebab-case-english-slug>
lang: <en|fr>
source_lang: <en|fr>
current: <true|false>
---
# <Title>

**Role:** <role title as given>          (FR: **Rôle :**)
**Solutions:** <technologies, comma-separated, see Solutions rules>

## Description

<Lead sentence: client + need or challenge + what was brought. One line if possible.>
- <Bullet: action + reasoning/how + outcome>
- <Bullet>
- <Bullet (optional)>
```

When the experience covers **several projects**, keep one block per project, in the input order:

```markdown
## Description

**<Project A>:** <lead sentence for A: need + contribution>
- <Bullet>
- <Bullet (optional)>

**<Project B>:** <lead sentence for B>
- <Bullet>
```

`counterpart: ../<other-lang>/<slug>.md` is added in final EN/FR files only.

## Title

Start from the CV entry's title. Keep project and client names (e.g. "DetteIT + DSSI"). It may be sharpened, never made generic. Max 8 words.

## Solutions rules

- Start from the CV entry's list, keep its order.
- **Add** every technology, product, language or framework explicitly named in the description or the summary but missing from the list (e.g. "SharePoint Framework" in the text → SPFx already listed, nothing to add; "Power Automate" in the summary → add).
- **Normalize** names to their official spelling (Sharepoint → SharePoint, Pnp → PnP PowerShell, Github Copilot → GitHub Copilot) and merge duplicates.
- **Never add** a technology that is only implied. Ask in open questions instead (e.g. "Which tool ran the agents: GitHub Copilot, Copilot Studio, Foundry?").
- **Never remove** an item the user listed because it looks unrelated; ask instead. Pruning for redundancy or size (below) is the only allowed removal.
- Practices are allowed when the user names them (e.g. "Agentic Engineering").
- **Keep it short**: the CV template fits about one line, so **at most 5 items**.
- **Drop redundant items**: a library that only implements a capability already listed goes (pytesseract when OCR is listed, Scrapy/BeautifulSoup when Web Scraping is listed). Keep the capability, unless the library is itself a marketable platform or product (SharePoint, Power Automate, Azure OpenAI).
- **Drop low-signal items** first when over the cap: generic formats or steps a recruiter would not search for (JSON, Text Extraction).
- Every change is recorded in the brain notes under "Solutions changes".

## Length (enforced by hook)

The `## Description` section must take at most **80 %** of the space of [reference-too-long.md](../../../docs/cv-context/reference-too-long.md): both characters and wrapped lines (70 chars per line) are checked. In practice: single project → a lead sentence + 2 or 3 bullets; two projects → per project a lead line + 1 or 2 bullets. Each bullet at most 2 lines. Title, Role and Solutions are not counted.
Technologies go in **Solutions**, not in the description, unless naming one is the point of the sentence.

## Readability rules (what makes it enjoyable)

1. Lead with the **why** (the client's need), then the **what**. The reference file starts with "Définition, développement et amélioration de…": a stack of nouns with no reason. Never do that.
2. Use verbs, not chained nominalizations. Bad: "Amélioration de la gestion d'alertes par la création d'un WebPart". Good: "Repensé la gestion des alertes…".
3. One idea per bullet. No bullet longer than 2 lines.
4. Max one "et/and" and one "de la/of the" chain per clause.
5. Vary the verb at the start of each bullet.
6. Replace client-internal names that mean nothing to outsiders with what they are (e.g. "page Allo Réseaux" → "portail de support réseau"), unless the name is well known. The client name itself (e.g. CNAV) stays.
7. Every bullet should let the reader infer a **transferable** capability (usable at another client).
8. Consulting register: precise, professional wording. No shorthand, slang or familiar verbs, even when the summary uses them; rewrite them with the same meaning (see the "Register" section of the language reference).

## Individual contribution focus

The CV sells what **this person** brings. Even on a team project, the description is written around their own actions, choices and outcomes.

- Never foreground the team: no "co-built", "co-developed", "with the team", "as part of a team", "the team adopted…" (see banned phrases). Do not open the lead sentence with the team or a group-project framing.
- Team size is useful context: state it once, briefly, when the input gives it ("in a six-person project", "projet à six"). Prefer it over a vague "group project". Never invent it.
- Do not frame the person's work by what it did for the team ("the team's shared foundation", "socle commun de l'équipe", "used by the rest of the team"). State the outcome for the product or client instead.
- Describe the person's part directly: "Benchmarked single-pass models…", not "Co-built a model…".
- A team decision is phrased through the person's input to it, never as their sole decision: "Benchmarked YOLO against multi-stage models, informing the move to Fast R-CNN", not "the team adopted Fast R-CNN" nor "Chose Fast R-CNN".
- Do not overclaim either: never state the person owned or led something the input attributes to the group. If ownership is unclear, phrase around their contribution and ask in open questions.

## Value without fabrication

- Never invent numbers, team sizes, durations, tools, outcomes, users or client names.
- A reasonable inference (e.g. automating a task implies it was manual before) is allowed only if low-risk and listed as `to confirm` in the brain notes.
- No placeholders (`[X%]`, `TBD`, `N users`) in descriptions. Missing data becomes an open question.

## References

| File | Use |
|---|---|
| [references/value-signals.md](references/value-signals.md) | What "shows judgment" and how to phrase it |
| [references/en.md](references/en.md) | English conventions + example |
| [references/fr.md](references/fr.md) | French conventions + example |
| [references/banned-phrases.md](references/banned-phrases.md) | Never output these |
