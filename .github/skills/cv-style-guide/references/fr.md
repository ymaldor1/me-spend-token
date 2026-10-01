# French conventions

## Voice and form
- Lead sentence: natural sentence, first person allowed once ("Pour la CNAV, j'ai fait évoluer…"). It states client + need + contribution.
- Never « nous » or « l'équipe » as subject. Team work is phrased around the person's own contribution (see SKILL.md "Individual contribution focus").
- Bullets: start with a **past participle used as a verb**, no subject ("Conçu…", "Repensé…", "Automatisé…"). Present tense ("Conçoit…") is not used.
- **Never** start with a nominalization ("Définition de…", "Création de…", "Amélioration de…"): it is exactly what makes the reference description dense and flat.
- Ongoing mission (`current: true`): lead sentence in present ("Pour X, je fais évoluer…"), bullets unchanged.

## Useful verbs
Conçu, Repensé, Automatisé, Fiabilisé, Simplifié, Structuré, Industrialisé, Proposé, Accompagné, Harmonisé, Accéléré, Modernisé, Rationalisé, Déployé, Outillé.

## Outcome connectors
"pour que…", "afin de…", "permettant de…", "supprimant…", "réduisant…", "facilitant…". Use at most one per bullet.

## Vocabulary
- Keep established English tech terms: WebPart, SharePoint, Power Automate, flux (for flows), tenant, pipeline, CI/CD.
- Prefer French when a common equivalent exists: "tableau de bord" (dashboard), "déploiement" (rollout), "retours utilisateurs" (feedback).
- Labels: **Rôle :**, **Solutions :**, `## Description`.

## Register
Registre conseil : précis, professionnel, jamais familier ni abrégé. Applies to wording taken from the summary and to literal translations from English.

| Avoid | Use |
|---|---|
| trancher (une demande) | arbitrer |
| spec, specs | spécifications |
| manques (de spécifications) | lacunes |
| à moitié fonctionnel, semi-fonctionnel | partiellement opérationnel |
| creuser (un rendu, un sujet) | analyser en profondeur, approfondir |
| faire marcher, faire tourner | rendre opérationnel, exploiter |
| checker, valider à l'œil | vérifier, contrôler |

The table shows the pattern, not an exhaustive list: apply the same correction to any familiar or abbreviated word.

## Typography
- Space before `:`, `;`, `?`, `!` (French rule), « guillemets » for quotes.
- Numbers: "2 WebParts" is fine in bullets; spell out only at sentence start.
- Accents on capitals when possible (É, À).

## Example (built only from the reference's facts)

Reference (dense, list-like, 627 chars / 11 lines):
> Définition, développement et amélioration de WebParts et extensions SharePoint sur les sites de la CNAV. - Définition et création de 2 WebParts pour la gestion de différents types de liens… - Amélioration de la gestion d'alertes sur la page Allo Réseaux par la création d'un WebPart… - Automatisation de la création d'une structure de dossiers…

Rewritten (456 chars / 8 lines, within budget):

```markdown
## Description

Pour la CNAV, j'ai fait évoluer l'intranet SharePoint avec des composants pensés pour les usages quotidiens.
- Conçu deux WebParts de liens, en partie personnalisables, pour que chacun accède directement à ses outils.
- Repensé la gestion des alertes du portail réseau : un WebPart pour les recenser et les créer, et des flux Power Automate optimisés.
- Automatisé la création des arborescences de dossiers et leur code couleur, supprimant une tâche manuelle.
```

Inferences in this example (would be listed `to confirm`): "pensés pour les usages quotidiens", "accède directement à ses outils", "supprimant une tâche manuelle".
This example illustrates style only. Never copy its content into another experience.
