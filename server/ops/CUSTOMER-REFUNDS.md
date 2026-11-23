# Customer refund calculation

The original order stores a refund basis for each fulfilled line in integer paise. The basis includes the difference between original MRP and selling price when selling price is lower, the line’s share of the bill discount or coupon, merchandise tax, and the resulting eligible amount. Item-level reductions are already reflected in the selling price. A POS bill discount is stored in the existing order-wide discount field. A storefront coupon applies only to its original eligible products or categories, whose eligibility is captured at checkout. If fulfillment reprices an order before a return, its line allocations follow the final fulfilled bill.

Order-wide discounts are distributed in proportion to eligible selling line values. Tax already charged on merchandise is distributed in proportion to each line’s value after discount. For both allocations, floor each exact share to a whole paise, then give remaining paise to the largest fractional remainders. Equal remainders follow original bill line order. Delivery charges are excluded from the refund. The current order model records delivery as the only separate non-merchandise charge.

For a line with `Q` fulfilled units and eligible amount `V`, the first `k` approved units are worth `floor(V × k / Q)` paise. Each return gets the difference between the new and previous cumulative values, reduced by any excess already recorded against that line. For example, 10,001 paise across three units refunds 3,333, 3,334 and 3,334 paise in approval order. The order-wide cap is the lesser of total eligible line value and the paid bill total after delivery, less the value already processed. For historical records with inconsistent totals, the cap uses the largest recorded value across gross refund, cash or credit plus exchange, and the sum of item refunds.

Only orders marked paid provide a monetary refund budget. Fulfilled unpaid bills and pending Udhar bills can record returned stock at ₹0. Udhar receipts recorded against a customer account do not establish payment for a specific bill, and this flow does not adjust the debt. Store credit and replacement merchandise use the same refund budget. Exchange-only returns record zero net payout, and no-refund returns record zero refund.

Creation displays a provisional amount based on processed history. Approval recalculates it from the current paid and processed amounts. Approvals for the same order are serialized by a write to that order. Refund amounts, approval state and any stock movements commit in the same transaction. Repeated approval of a processed return reuses the finalized record. An active return blocks cancellation or repricing of a partially fulfilled bill, which protects both the original refund basis and the stock balance.

Older orders without saved allocations are reconstructed from the stored sale prices and order totals. When historical coupon eligibility was never stored, the discount is allocated across all fulfilled selling lines. Those line-level amounts are estimates. The order-wide paid cap still applies.

## Historical review list

| Source | Recorded | Eligible | Excess | Review result |
| --- | ---: | ---: | ---: | --- |
| A06 readiness audit | ₹100.00 | ₹80.00 | ₹20.00 | Return creation in a disposable QA database. The evidence does not include an order or return ID. |
| Configured database, 21 November 2026 | | | | Read-only scan found zero customer returns in processed, pending or approved status. |

Run `npm run --silent refunds:review` from `server` to produce the current JSON review list. Append `-- <tenantObjectId>` to scope it to a tenant. The command uses the configured `MONGODB_URI`, disables automatic collection and index creation, and only reads records. Each finding includes the order and return references where available and amounts in paise. A pending or approved status is a stale quote for review. A processed status is a finalized record for reconciliation. Missing links or invalid records are emitted for manual review. The report does not alter historical amounts or trigger payments.
