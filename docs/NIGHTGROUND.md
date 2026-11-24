# Nightground frontend redesign

SpotKick is a rapid three-zone penalty duel. Each player shoots and keeps once per round; goals score 1, 2, then 3 points. Solo play is a separate goal streak with a cash-out decision. The likely audience is casual football and arcade players; the intended feeling is anticipation, readable rivalry and quick commitment. This is inferred from the existing rules and assets, not user research.

The interface includes arena lobby, queue, shooter/keeper turns, locked/reveal/resolved states, win/loss/refund, solo setup/run/result, fairness verification, rules and wallet dialogs. Live play needs role, score, round, time and three choices first. Wallet and technical transcripts are secondary.

Art direction: a floodlit penalty club called The Nightground. Reuse the original pixel stadium, kits and nine video/static outcomes. Ink blue #101f29, stadium structure #172d38, chalk #f3f5e8, signage yellow #f6ce55, goal green #97ddb1, error coral #ffaba0. Impact/Arial Narrow gives signage and scores a condensed sporting voice; Trebuchet/Arial handles instructions. Original SVG icons remain. Painted borders and the actual pitch provide structure without decorative gradients or glass.

Desktop composition: headline + instructions, then pitch alongside match setup and touchline. Mobile puts starting controls first; active play compacts the field to keep choices within reach. Results lead their side panel. Settings offer persistent still replays and respect OS reduced motion. Live play cannot pause: menus explain that deadlines continue.

No gameplay protocol, payout, backend or dependency changes. Corrected solo instructions that described multiplayer rules. Added pressed semantics and a check to selected zones, a locked label, visible keyboard focus and touch-sized controls. Existing modal focus trap and Escape behavior retained.

Verification: TypeScript passed. Chrome checks at 375, 539, 768 and 1440 pixels found no horizontal overflow. Automated controlled HTTP/WebSocket responses exercised lobby, stake selection presentation, rules, wallet, settings persistence and focus return, practice entry, shot locking, goal presentation, keeper turn, victory, defeat, lobby return, solo start/shot/cash-out and verifier validation. Reduced-motion presentation was checked. Screenshots are adjacent nightground-*.png files. Run `node scripts/review-nightground.cjs` against the web dev server on port 3182, with local Chrome installed.

These are frontend checks using fixtures, not a live backend acceptance run. The API/database were not running. Real matchmaking, settlement, fairness outcomes, actual device touch behavior and live reconnection were not revalidated. Python was unavailable, so ui-ux-pro-max's search utility could not run; its documented interaction/accessibility guidance was used directly.

## Portfolio direction, second pass

The purpose is to demonstrate frontend craft to reviewers and potential clients. The landing page is now an interactive football poster: oversized condensed lettering, an original cobalt kit-blue field, offset chalk frame, drawn shot trajectory and stamped goal/save feedback. Its warm-up replays work without the API or a wallet, so a reviewer can interact immediately. The warm-up is explicitly labelled as a free replay with the keeper fixed in the centre; it is separate from real match decisions and payouts.

Composition:

```text
Desktop                         Mobile
brand               game menu   brand       menu
ALL NERVE.     tilted stadium   ALL NERVE.
ONE KICK.      + drawn aim      ONE KICK.
enter / rules  three replays    enter / rules
3 rounds ...   replay feedback  stadium + three replays
match setup    touchline        match setup / touchline
```

The previous direction was too focused on organizing a functional game. This pass moves the distinctive, interactive moment into the opening viewport and quiets the lobby setup. The technical details remain in the verifier rather than the visual narrative. Cobalt #2351de joins ink #101e2a, chalk #f1f2df and yellow #f9d65c. A coordinated entrance, user-triggered stamp response and trajectory changes provide motion with a purpose. OS reduced-motion and the saved still-replay setting disable playback. No additional packages or remote fonts are required.

Additional verification: all three warm-up directions, goal/save feedback, selected semantics, navigation to match setup, widths from 320 to 1920 px, and warm-up operation with the API explicitly blocked. The existing fixture-driven main flows were rerun. Screenshots reflect the portfolio revision. `review-nightground.cjs` currently uses port 3186. Production build and TypeScript checks are run separately from the browser script. The live backend limitation described above still applies.

The final display type is now self-hosted Barlow Condensed Black (normal and italic), loaded with Next.js local fonts rather than relying on Impact being installed. Source: https://github.com/google/fonts/tree/main/ofl/barlowcondensed. The bundled SIL Open Font License is in apps/web/public/fonts/OFL.txt. Approximately 224 KB of source font files are included; Next.js manages the generated/preloaded assets. There is no Google Fonts runtime request.
