# LANDING-01: transparent product compositions

The images in `public/landing` contain synthetic data only. They are generated
as inert SVG/foreignObject from HTML rendered with the production
components at baseline `6ab1913b8412229ffa8ce550b3f39ff888331a40`.

- `kanban.svg`: `ContactTable` with `view="states"`, its real `StatusBoard`,
  `StatusBoardCard`, and `NETWORKING_STATUSES`. The composition isolates the
  first three columns with a slight stagger and removes the workspace panel.
- `coach.svg`: `CoachModule` in suggestions mode; four synthetic status-change
  recommendations. The production state/evidence JSON format is used.
- `inicio.svg` (INT-01): real `GamificationPanel` with a complete synthetic
  route and values calculated by `buildGamification`. Only Cifras, Metas and
  Racha appear: one floating upper block and two lower blocks. No page shell,
  screenshot background, pyramid or editorial content. The local level SVG is
  embedded as a data URI so the SVG image needs no external resource.

To regenerate inert documents and assets, run from `cloud/web`:

```powershell
$OutputDirectory = Join-Path $env:TEMP 'coffeecito-landing-fixtures'
node tests/local/landing-assets.cjs $OutputDirectory
# INT-01 changes only slide 3; preserve approved kanban/coach byte-for-byte:
node tests/local/landing-assets.cjs $OutputDirectory inicio
Copy-Item -LiteralPath (Join-Path $OutputDirectory 'inicio.svg') -Destination 'public/landing'
```

The renderer refuses network fetches, clears Supabase/Turnstile environment
variables in its own process, and does not mount effects. Production CSS is
embedded using existing PostCSS/parser dependencies; responsive rules are
omitted to freeze the source composition at 1280 x 700. Nested SVG elements
retain their namespace. `landing-compositions.css` adds capture-only cropping,
scaling and soft shadows; it never changes the private application styles.
The stage and removed panel backgrounds are transparent. No bitmap screenshot,
scripts, sessions or backend data are embedded. Keep the generated HTML for
inspection and review the SVGs as images in the integrated browser, including
the actual landing at mobile widths. Assets must be regenerated after relevant
UI changes; they do not update automatically with the product.

The landing uses its own `ProductSlideshow`, separate from `EditorialFeed`.
It retains LANDING-01's Swiper autoplay/visibility/focus/touch/reduced-motion
policy, including rearming after transitions and clearing stale pause flags. Product delay is
5000 ms; editorial delay stays 7000 ms. Product slides have no tracker, arrows,
expanded dialog, or editorial API request. Keyboard arrows work while the
carousel is focused, including when reduced motion disables autoplay.

`/` remains Home after the existing Auth/access/legal gates. For anonymous
visitors it shows the new public landing. `/ingresar` retains the original
AuthGate login markup and handlers; authenticated entry returns to `/`.

Local preview without environment configuration does not certify real OAuth,
Turnstile completion, or authenticated navigation. Do not treat a source-level
regression test as a remote login smoke.
