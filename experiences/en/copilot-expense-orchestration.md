---
slug: copilot-expense-orchestration
lang: en
source_lang: en
current: false
counterpart: ../fr/copilot-expense-orchestration.md
---
# GitHub Copilot Agents for Expense Analysis

**Role:** Developer
**Solutions:** GitHub Copilot, VS Code, OCR, PowerShell, Markdown

## Description

Automated a delivery lead's expense documents review, from raw files to Excel.
- Chose GitHub Copilot over Copilot Studio, whose SharePoint connectors an existing DLP policy already blocked, so the agent could still ship.
- Designed an orchestrator running analyst agents in parallel on employee batches, sending low-confidence results to a fallback agent.
- Scripted text extraction (dual-OCR fallback) and Excel output, keeping runs deterministic and costly image analysis a last resort.
