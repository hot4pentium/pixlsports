# Completion analytics funnel

These custom events measure whether completion feedback helps families finish game-day preparation and continue to the next recommended action.

## Events

| Description | Event name | Coarse properties |
| --- | --- | --- |
| A checklist item is changed from incomplete to complete | `checklist_item_completed` | `source`, `completed_count`, `total_count` |
| The final incomplete checklist item is completed | `checklist_completed` | `source`, `completed_count`, `total_count` |
| The active weekly path advances to a later stage while the dashboard is open | `weekly_path_advanced` | `source`, `from_stage`, `to_stage`, `progress_count` |
| A family clicks the recommended action shown after checklist completion or in the weekly path | `completion_next_action_clicked` | `source`, `stage`, and the applicable coarse progress counts |

`source` and stage values are fixed application enums. No checklist labels, game details, opponent names, account identifiers, share tokens, or other free-form content are sent.

## Reporting funnels

### Checklist completion to game-day action

1. Count `checklist_item_completed` to understand preparation progress.
2. Use `checklist_completed` as the completion outcome.
3. Use `completion_next_action_clicked` where `source` is `local_checklist` or `shared_checklist` as the conversion outcome.
4. Compare completions and next-action clicks by `source`. Use event totals and conversion rates; do not attempt to identify individual families.

### Weekly-path advancement to next action

1. Use `weekly_path_advanced` as the stage-advancement outcome.
2. Group by `from_stage`, `to_stage`, and `progress_count` to find where progress continues or stalls.
3. Use `completion_next_action_clicked` where `source` is `weekly_path_mobile` or `weekly_path_desktop` as the next-action outcome.
4. Compare next-action click rates by coarse `stage`, progress count, and interface source.

The events are available only after analytics is enabled in Publishing settings and the app is published or republished. The shared analytics wrapper catches tracker errors and safely does nothing when analytics is unavailable.