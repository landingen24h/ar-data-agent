# Kognai citizen app: design system and clickable prototype

Mobile first design system and static prototype for the Kognai citizen app: first run, lobby, chat with your citizen, services (learn, create, earn), credits and wallet, settings. Light and dark, English and Arabic (right to left). Static HTML and CSS, no build step, no dependencies.

## Layout

* `tokens/tokens.json`: `{color: {light, dark}, type, space, radius}`. Each theme has bg, surface, text, text-muted, primary, on-primary, border, danger and accent as `#rrggbb`, from the citizen brand: terracotta, charcoal, cream.
* `tokens/tokens.css`: the same values as custom properties (`--color-text` and so on). Light by default, dark under `prefers-color-scheme: dark` and under `[data-theme="dark"]` (`[data-theme="light"]` forces light).
* `prototype/index.html`: links every screen in both languages and the design system.
* `prototype/design-system.html`: swatches for both themes, type scale, space, radius and the components (buttons, field, chat bubbles, avatar, tab bar), with a theme preview switch.
* `prototype/{first-run,lobby,chat,services,wallet,settings}.html` and the same six under `prototype/ar/` with `<html lang="ar" dir="rtl">`.
* `prototype/app.css`: components, built only from the tokens and with logical properties (`margin-inline-start`), so the same CSS mirrors in right to left.

## Flow

first run, then lobby. Lobby leads to chat, services and wallet. The tab bar links lobby, chat, services, wallet and settings. Settings switches theme live and leads back to first run (delete citizen). Every screen has an Index link and a language switch to the same screen in the other language.

## Contrast (A1)

| pair | light | dark |
| --- | --- | --- |
| text on bg | 13.9 | 15.2 |
| text on surface | 15.0 | 13.5 |
| text-muted on bg | 6.8 | 8.8 |
| text-muted on surface | 7.3 | 7.8 |
| on-primary on primary | 6.1 | 6.9 |
| danger on bg | 6.1 | 7.7 |

The test computes these from tokens.json (WCAG relative luminance) and fails under 4.5.

## Tests

```
npm test
```

Node 20 or later, `node:test`, no network, no dependencies. Each test is named after the acceptance item it proves:

* A1 tokens complete in both themes, every pair at 4.5 or more, tokens.css equal to tokens.json in the three places.
* A2 every screen in English and Arabic, Arabic pages `lang="ar" dir="rtl"` with Arabic text, no physical left or right in the CSS.
* A3 viewport meta, tokens.css and app.css on every page, no raw colour in the CSS, no fixed width above 360 px.
* A4 every local link resolves, every page is reachable from index.html, every screen links the screens it leads to.
* A5 every page sets its language, images and svg have text alternatives, every control has a label, Latin digits only and no long dashes in visible text.

A6 (review by the Founder with three test users) happens on the Kognai side; we apply the changes from that review before M2.

Screenshots at 360 px: `docs/ar-lobby-dark-360.png`, `docs/en-wallet-light-360.png`.

Built by an AI agent (Landing en 24h). MIT licence.
