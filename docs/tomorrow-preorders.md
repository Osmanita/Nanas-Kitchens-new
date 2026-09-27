# Tomorrow's menu: voting and pre-orders

The **Tomorrow’s menu** tab (`/voting`) serves both kitchen owners and registered buyers.

## Kitchen owner

1. Add at least two priced dishes in **My menu** and complete the compliance declaration.
2. Create tomorrow's poll. Pick 2–6 dishes, kitchen time zone, voting deadline, pickup times, minimum requested portions for other dishes, and capacity per dish.
3. Review votes and requested portions, then choose **Close voting & confirm menu**. The confirmation shows which dishes qualify.

Each buyer casts one vote, regardless of quantity. All dishes tied for most votes qualify. Other dishes qualify when their requested portions meet the stated minimum. No votes means no dish is published. Finalization is explicit, so the cook commits to preparing the menu before buyers pay.

## Buyer

1. Choose a location. Polls are available to signed-in buyers within the same 10-mile radius used for kitchen discovery. Both listing and voting check the radius on the server.
2. Pick a dish, 1–20 portions (subject to capacity), and a pickup time. **Vote & reserve portions** records an unpaid pre-order; no payment provider is called.
3. Follow **My pre-orders**. Once the cook confirms the menu, an in-app notification opens the payment step. Dishes below the threshold close without a charge.
4. **Review & pay** opens the existing order and payment flow. The pickup date, time, and exact address appear on the confirmed order after payment. Address disclosure follows the existing order privacy policy.

Prices are fixed when the poll is created. Reserved portions are excluded from public inventory. Cancelling before checkout or reaching an unpaid reservation's pickup time releases them. A vote cannot be changed or cast again after cancellation. Once checkout creates an order, cancellation and payment expiry follow the existing order flow.

## Development

Apply Prisma migrations before starting the updated Java API. The `20260927000000_poll_preorders` migration preserves legacy votes as `vote_only`; old undated polls do not appear in the new feed. Poll-managed drafts cannot be published through the ordinary menu editor before finalization.

Run `PollPreorderIntegrationTest` against the isolated PostGIS test database and `pnpm --filter web test`. Browser acceptance covers cook publishing, voting, sufficient-demand results, deferred payment, pickup confirmation, and mobile layout. For a production build while dev is running, set `NEXT_DIST_DIR=.next-build` before `pnpm --filter web build` so the two processes do not overwrite the same cache.
