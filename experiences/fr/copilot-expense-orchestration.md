---
slug: copilot-expense-orchestration
lang: fr
source_lang: en
current: false
counterpart: ../en/copilot-expense-orchestration.md
---
# Agents GitHub Copilot pour l'analyse des dépenses

**Rôle :** Développeur
**Solutions :** GitHub Copilot, VS Code, OCR, PowerShell, Markdown

## Description

Pour un delivery lead, j'ai automatisé l'analyse des documents de dépenses, des fichiers bruts à l'Excel.
- Choisi GitHub Copilot plutôt que Copilot Studio, dont les connecteurs SharePoint étaient déjà bloqués par une DLP, pour livrer l'agent.
- Conçu un orchestrateur exécutant des agents en parallèle par lots d'employés, avec repli vers un agent pour les cas peu fiables.
- Scripté l'extraction de texte (double OCR de repli) et l'export Excel, traitements déterministes, analyse coûteuse en dernier recours.
