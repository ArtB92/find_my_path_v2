---
name: ui-craft
description: Visual and interaction rules for this app's UI. Load before creating or restyling any page, component, or style token.
---

# UI craft

Goal: a tool that feels made by a small, opinionated design team. Avoid the generic "AI SaaS" look.

## Avoid
- Purple/blue gradients, glassmorphism, glowing borders, gradient text.
- Emoji as icons, sparkle icons for anything "AI".
- Every block wrapped in a rounded card with a drop shadow; `rounded-2xl` everywhere.
- Centered hero + three feature cards + big CTA layouts.
- Default Inter at every size, gray-500 body text on white, low-contrast placeholders.
- Filler copy ("Unlock your potential", "Seamlessly"), exclamation marks.

## Do
- The map is the product: give it most of the viewport. Controls sit in a restrained side panel or bottom sheet (mobile).
- Tokens first: define color, type, spacing, radius, and motion as CSS variables in one theme file; components use tokens, never raw hex values.
- Palette: warm neutral base plus one earthy accent (think topo maps: moss, ochre, clay). Real dark mode, not inverted.
- Type: one characterful face for headings, one neutral text face, a tabular-figure mono for distances/elevation. Clear scale (e.g. 12/14/16/20/28/40).
- Spacing on a 4px grid. Hierarchy through weight, size, and whitespace before borders and color.
- Radii small and consistent (4–8px). Shadows only for floating layers (popovers, sheets).
- Motion: 150–250ms, ease-out, only to explain state change. Respect `prefers-reduced-motion`.
- Data first: distance, elevation gain, surface mix, and ETA are the hero numbers; show an elevation profile under the map.
- Copy is short, concrete, in the rider's words ("Avoid busy roads"), sentence case.

## Always
- Keyboard reachable, visible focus rings, WCAG AA contrast, labels on every input.
- Mobile first; test at 375px and 1440px.
- Loading states for route generation (skeletons on the stats panel, progressive route draw), and a useful error when a route can't be found.
