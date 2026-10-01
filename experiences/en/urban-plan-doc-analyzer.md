---
slug: urban-plan-doc-analyzer
lang: en
source_lang: en
current: false
counterpart: ../fr/urban-plan-doc-analyzer.md
---
# Urban Planning Document Analyzer

**Role:** Developer
**Solutions:** Web Scraping, OCR, Regular Expressions, Python

## Description

Automated analysis of large regional urban planning PDFs in a six-person project, removing time-consuming manual review.
- Researched text retrieval, setting native PDF extraction as default and OCR as fallback when no text was found.
- Catalogued the most common regulatory phrasings across ~50 planning documents, building a regex library tuned for coverage.
- Designed the JSON schema by planning area, mirroring the documents' per-area rules (roof size, wall thickness).
