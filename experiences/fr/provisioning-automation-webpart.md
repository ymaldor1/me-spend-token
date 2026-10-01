---
slug: provisioning-automation-webpart
lang: fr
source_lang: fr
current: false
counterpart: ../en/provisioning-automation-webpart.md
---
# Automatisation du provisioning SharePoint pour la GED

**Rôle :** Developer
**Solutions :** Azure Functions, Azure Logic Apps, Microsoft Forms, SharePoint, Microsoft Entra ID

## Description

Pour que chaque demande de site GED aboutisse sans intervention manuelle, j'ai automatisé tout son provisioning SharePoint.
- Conçu le formulaire de demande, point d'entrée unique dont la soumission lance la création du site.
- Écrit l'intégralité du provisioning : listes, bibliothèques d'archivage, groupes et droits, identiques sur chaque site.
- Développé un WebPart de statistiques, intégré à l'accueil de chaque site, pour suivre stockage et documents actifs ou archivés.
