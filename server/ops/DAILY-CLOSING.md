# Daily closing

The accounting day runs from local midnight inclusive to the next local midnight exclusive using the store’s configured timezone. Asia/Kolkata is the default. Expected drawer cash is opening cash plus cash sales and cash Udhar collections, less cash supplier payments, cash refunds and cash expenses. All calculations use integer paise. Cash difference is the physical cash count minus the expected amount. The saved closing contains the movement breakdown as of the save.

| Movement | Source and date |
| --- | --- |
| Sale receipt | Amount and timestamp saved when payment is recorded at POS, COD delivery, pickup or online payment verification. Changes to the bill after collection do not change the recorded receipt. |
| Udhar collection | Payment date and method from the customer ledger. Order-linked balance adjustments and credit sales are excluded from cash collections. |
| Supplier payment | Posting time and method from invoice payment allocations. Allocations from a split payment contribute their respective amounts. The mirrored supplier-history entry and purchase return credits are excluded. |
| Customer refund | Processing time, net refund and recorded method from the processed return. Exchange-only returns and store credit do not move money through the drawer, UPI or bank. |
| Expense | Payment date and method from the active Accounting → Expenses record. |

UPI and bank each show inflow, outflow and net movements separately from the drawer. Bank includes bank transfers and cheques. Gateway payments appear under other non-cash. Missing payment methods appear under **Method unrecorded** and are excluded from the drawer result. New Udhar collections and expenses record a payment method. The API defaults older clients’ new submissions to cash when they omit it.

Record a drawer expense once under **Accounting → Expenses**. Daily Closing includes it automatically and rejects new manual expense lines. Historical manual lines remain on saved records for reference. A correction for an older closing recalculates the totals from Accounting. Record any genuinely missing expenses in Accounting first and reuse records already posted there.

Older paid orders use the existing POS creation, payment verification or delivery timestamp where available, with creation time as the last fallback. Their saved bill total is used when the received amount was never recorded. Legacy supplier payment history without allocations is read by payment date. For older invoices with a paid snapshot but no corresponding payment history, the invoice creation date and stored method are used as a fallback. Where a supplier has unallocated historical payment history, that history takes precedence over its ambiguous older invoice snapshots to prevent counting both.

## Drafts, finalization and corrections

Save a draft with the drawer counts, then finalize the saved version. Finalization captures fresh posted movements. Opening a finalized day displays its saved snapshot. If an owner records a correction, the newest revision is shown alongside the original drawer count and the correction history. The original finalized snapshot and prior corrections remain preserved.

| API | Version and behavior |
| --- | --- |
| `POST /daily-closing` with `status: "draft"` | Omit the version or pass 0 when creating a draft. For an existing draft, send its exact version. Each save advances it. Draft writes against a finalized day return HTTP 409. |
| `POST /daily-closing/:id/finalize` | Send the version of the saved draft. A concurrent or later retry with that same version returns the original finalized snapshot, even after a correction. A stale version returns HTTP 409. |
| `POST /daily-closing/:id/corrections` | The store owner sends the latest correction version, or the finalized version for the first correction, with a reason. Optional drawer counts and notes replace the previous values for the revision. The new snapshot uses current posted movements. The previous snapshot, revised snapshot, reason, actor and timestamp are saved with an audit log entry in a single transaction. |

The one-step `POST /daily-closing` with `status: "closed"` remains available to existing callers for a day with no closing yet. An exact replay returns that first finalized snapshot. A normal save with different values cannot replace it. Records from before versioning start at version 0.

## Business dates and legacy key review

Sales reports, POS date filters and order exports use the same store-local boundaries. Timestamp fields remain UTC. Order reports and exports group by order creation, and cash closing groups receipts by payment time. An order placed and paid on different days can appear on different business dates in those views. Date-only expense and Udhar entries use the start of the selected store-local day as their UTC timestamp.

New closing keys use UTC midnight to encode the selected calendar date. The closing APIs also return `businessDate` for display and read recognized historical local-midnight keys in place. If multiple recognized keys exist for the same day, the summary prefers the finalized record. History preserves each record. A legacy key whose date cannot be determined is flagged for review.

Run `npm run --silent closings:date-review` from `server` to list proposed keys, per-tenant collisions and unresolved records before any remap. Append `-- <tenantObjectId>` to limit the scan. The command uses the configured `MONGODB_URI` in read-only mode with automatic index and collection creation disabled. Review the generated report before changing dates, especially when a store timezone may have changed. The application reads existing keys in place.
