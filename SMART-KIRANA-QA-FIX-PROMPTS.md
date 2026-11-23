# Smart Kirana trial QA aur fix prompts

**20 November 2026 · Real-data trial abhi block hai.** UI ka kaam Prompt 01 se start karo. Trial ke pehle backup restore aur billing, stock, Udhar aur cash-closing ke P0 checks pass karo.

## Test results

| Check | Result |
| --- | --- |
| Backend Vitest, isolated MongoDB replica set | 15/15 pass |
| Frontend Vitest | 6/6 pass |
| Chromium responsive, role navigation aur keyboard checks | 8/8 pass, mocked APIs |
| Production build aur default ESLint | Pass. Explicit JSX lint mein 101 errors, including checkout crash ka missing import |
| Additional business API checks | 14 failures reproduced on disposable data |
| 390 px guest journey, real API | Add to Cart crash reproduced. Test-only missing import ke saath pickup order HTTP 201, stock 100 → 99 aur reload ke baad tracking pass. Unsubmitted cart reload par empty hua |
| Desktop owner journey, real API | Login aur dashboard redirect pass. POS blank phone par HTTP 400. Valid phone par HTTP 201 aur stock ek baar reduce hua |
| Production dependency audit | Server par 10 flagged packages (2 critical, 6 high, 2 moderate), client par 1 high |

Project ke configured database aur real customer records ko QA ke liye use nahi kiya gaya. Browser follow-up mein missing import Vite ke test process mein inject kiya gaya. Application source mein redesign ya fix apply nahi kiya gaya. Hosting, actual owner device/network latency, full disaster recovery aur external payment settlement abhi verify nahi hue. Existing browser suite role layout, routes aur accessibility ke selected cases cover karti hai. Uske pass hone se financial calculations verify nahi hoti.

Har prompt ko alag run karo. Fix ke saath listed regression test add karo aur current suites rerun karo. Legacy records ke liye pehle read-only reconciliation report banao. Correction ya migration chahiye to isolated restore par dry run karo aur affected records, mismatches aur rollback steps show karo. Ledger history ko correction entries se preserve karo.

## 01 — Register aur Login redesign · UI se shuru karo

Screenshot 1 mein narrow dark card, chhote labels aur low-contrast placeholders form ko padhna mushkil banate hain. Screenshot 2 ki readable light surfaces, clear split aur prominent CTA design reference hain.

> Smart Kirana ke `/register` aur `/login` ko ek original light auth layout mein redesign karo. Desktop par ek restrained pale-blue branding panel aur white form area use karo. Mobile par compact brand header aur single-column form rakho. Blue primary action, dark readable text, 16 px inputs, visible focus aur kam se kam 44 px ke primary controls rakho. Register mein Store Details aur Your Account groups, slug preview, optional phone hint aur clear password rules dikhayo. Login mein Email Address, Password, show/hide aur Remember me rakho. Existing fields, validation, submission, session aur role redirects preserve karo. Validation input ke paas dikhe, safe entered values server error par retained rahein aur submit ka pending state clear ho. Reference ke business name, illustration aur credentials copy mat karo. 360, 390, 768 aur 1440 px par screenshots aur keyboard flow verify karo. Registration success, duplicate slug, invalid login aur network-error state verify karo.

## 02 — Complete backup aur verified restore · P0

**Observed A05.** Full backup mein Udhar ledger absent tha aur store metadata mein sirf name aur slug the. Source mein stock ledger export 5,000 rows par cap hai. Repository mein recovery path verify nahi hua.

> `/backup/full` aur production recovery ko reliable banao. Tenant settings, linked business collections, full stock aur Udhar history, payments, returns, closings aur required uploads ke liye versioned manifest with counts and checksums banao. Owner download mein credentials aur session secrets exclude karo. Authorized disaster recovery ko encrypted, access-controlled backups par rakho. Point-in-time consistency, automatic scheduling, backup failure alerts aur documented RPO/RTO rakho. Isolated restore mein 5,001 ledger rows, store settings, original record links aur public/private media verify karo. Fixture ka order total, inventory aur Udhar balance restore se pehle aur baad reconcile karo. Corrupt archive, interrupted restore aur wrong tenant cases test karo.

## 03 — Add to Cart crash fix karo · P0

**Observed browser failure.** 390 px par real storefront product detail ka Add to Cart click error screen par gaya. Browser ne `Trash2 is not defined` report kiya. Source mein icon use hota hai aur import missing hai.

> `client/src/pages/customer/ProductDetail.jsx` mein missing Trash2 import correct karo. Mobile aur desktop browser regression mein product kholna, first item add karna, cart drawer se checkout tak jana aur same product ki quantity change/remove karna cover karo. Real isolated API path par pickup order create aur refresh ke baad tracking verify karo. Console mein uncaught exception aur ErrorBoundary fallback check karo.

## 04 — Customer cart reload par preserve karo · P1

**Observed browser failure.** Test-only cart crash bypass ke baad cart mein ek item tha. Product page reload karne par cart count zero ho gaya.

> Cart draft ko store aur account/guest scope ke saath persist karo. Product/variant IDs aur quantities restore karo. Restore par current stock, price aur coupon revalidate karo. Shared browser mein accounts ya stores ke beech cart state cross na ho. Guest cart aur login transition ki policy explicit rakho. Same-store refresh, outdated variant, account switch aur confirmed order ke baad cart clear test karo. Local draft mein personal checkout details ya payment data store mat karo.

## 05 — JSX lint coverage sahi karo · P1

**Observed tooling gap.** Default lint passed. `npm exec -- eslint src/ --ext .js,.jsx --rule 'react/jsx-no-undef:error' --quiet` ne 101 errors report kiye, including undefined `Trash2`.

> Client lint script ko .js aur .jsx dono include karne ke liye update karo. Undefined JSX identifiers ki lint rule keep karo. Existing unused imports aur invalid JSX text escapes ko targeted edits se resolve karo. Clean package install par lint, test aur build run karo. Verify karo ki fixture mein intentionally missing component reference lint failure banata hai.

## 06 — Stocked variants preserve karo · P0

**Observed A07.** Product edit ne omitted variant ke saath 8 units hata diye. API ne HTTP 200 diya.

> `PUT /products/:id` aur Product Form mein existing variant IDs preserve karo. Omitted variants ko retain karo ya unsafe replacement par 409 return karo. Archive explicit action ho aur existing inventory, reservations, bills aur returns ka link usable rahe. Stock change ke liye existing transactional ledger flow use karo. Stale form se newer variant, price ya stock change overwrite hone par conflict feedback do. Test karo ki two-variant product mein one-variant update se doosra variant aur uska 8-unit balance intact rahe. Concurrent sale aur edit ke baad stock ledger reconcile karo.

## 07 — Walk-in POS billing · P0

**Observed A01 and real browser.** Optional phone blank tha. UI ke `0000000000` fallback ko API ne HTTP 400 se reject kiya. Valid number se browser billing HTTP 201 par complete hui.

> POS UI se dummy phone hatao. Cash aur UPI walk-in bill mein empty phone omit karo, aur entered number ho to existing validation apply karo. Udhar sale ke liye valid identified customer required rakho. UI aur API mein field-level error align karo. Browser aur API tests mein blank-phone cash/UPI, invalid supplied number aur blank-phone Udhar cover karo. Successful sale par ek bill aur ek stock movement verify karo.

## 08 — Retry par duplicate bill aur online order roko · P0

**Observed A02/A10.** Same key ke saath POS mein do bills bane. Online checkout ki simultaneous submissions se do orders bane. Dono fixtures mein stock 100 se 98 hua.

> POS aur storefront checkout mein tenant-scoped durable idempotency implement karo. Key ek logical submission ke liye stable rahe aur timeout ke baad retry par reuse ho. Same payload ka retry original order reference return kare, changed payload with same key par 409 de aur unrelated sales distinct rahein. Order, stock, coupon usage aur related ledger writes ek transaction mein consistent rakho. Guest order tracking repeated response ke baad accessible rahe. Browser CORS contract mein needed header support karo. Parallel submit, committed response lost, process restart aur independent identical sales test karo.

## 09 — Credit sale ko Udhar account mein post karo · P0

**Observed A03.** ₹100 credit bill bana, customer balance ₹0 aur ledger entries zero rahe.

> POS credit sale mein same tenant ke explicit Udhar customer ko resolve karo. Sale, debit entry, customer balance aur stock update ek transaction mein save karo. Credit limit apply karo. Customer missing ya ambiguous ho to bill banne se pehle clear error do. Retries par debit duplicate na ho. Legacy open credit bills ki read-only reconciliation list do. Test mein ₹100 bill se ek ₹100 debit aur balance ₹100 bane, aur failed write par bill, stock aur balance rollback hon.

## 10 — Supplier payment aur invoice balance reconcile karo · P0

**Observed A04.** ₹1,000 payment ke baad supplier due ₹0 tha. Invoice ₹1,000 due aur UNPAID raha.

> Supplier account payment aur invoice payment ko shared transactional accounting flow se post karo. Payment allocation explicit rakho, ya documented oldest-first policy follow karo. Allocation references, payment method aur payment timestamp persist karo. Invoice due/status aur supplier due authoritative entries se reconcile karo. Partial, full, multiple invoice, retry aur concurrent payment cases cover karo. Existing mismatches ka read-only report do. ₹1,000 paid invoice aur aggregate due ka expected result ₹0 aur PAID hona chahiye.

## 11 — Discounted bill ka refund correct karo · P0

**Observed A06.** Customer ne ₹80 pay kiye aur ₹100 refund record hua.

> Returns mein original net paid line value calculate karo. Item, bill aur coupon discount allocation ko documented rounding ke saath minor units mein preserve karo. Tax aur non-refundable charges ka treatment explicitly define karo. All returns ka cumulative refund remaining eligible paid amount se cap karo. Pending Udhar, unpaid order, repeated partial return, concurrent approval aur restock cases test karo. ₹100 item aur ₹20 bill discount ki full eligible return ₹80 se zyada refund na de. Existing over-refunds ki review list do.

## 12 — Cash closing mein actual cash movements reconcile karo · P0

**Observed A08.** ₹1,000 opening cash aur ₹100 cash supplier payment par expected cash ₹1,000 aaya. Correct result ₹900 tha.

> Daily closing ko payment aur cash movement timestamps aur methods se calculate karo. Cash sale, Udhar collection, supplier payment, cash refund aur expense ko ek baar reconcile karo. UPI aur bank entries ko drawer cash se exclude karo aur unka alag total dikhao. Manual expense aur accounting entry ki duplication roko. Kal ki invoice par aaj ka cash payment aaj count karo. ₹1,000 opening aur ₹100 cash outflow ke case mein expected cash ₹900 aur actual ₹900 par difference zero ho.

## 13 — Finalized cash closing overwrite roko · P0

**Observed A11.** Second save ne ₹500 closed entry ko ₹20 draft bana diya. Dono responses HTTP 200 the aur sirf ek record bacha.

> Daily Closing mein draft editing aur finalize transitions enforce karo. Closed record ko immutable rakho. Correction ke liye authorized audited flow do jisme old snapshot, reason, actor, timestamp aur revised values preserved hon. Version check lagao. Repeated finalize safely same result de. Stale draft, direct re-save aur concurrent finalize test karo. ₹500 finalized record normal ₹20 draft save ke baad visible aur intact rahe.

## 14 — Store timezone se business dates calculate karo · P0

**Observed A13.** Store Asia/Kolkata tha, server UTC tha. 12 November ki 00:30 IST sale 11 November mein show hui.

> Cash closing, sales reports aur date-filtered exports ko store timezone ke calendar-day boundaries par align karo. Storage timestamps UTC rakho. Store-local start inclusive aur next-day start exclusive use karo. UTC host par 11 November 19:00 UTC ki sale sirf 12 November India business day mein count karo. Midnight boundary, month end aur legacy closing date keys test karo. Existing dates remap karne se pehle collision report banao.

## 15 — P&L mein sold inventory ka cost dikhao · P0

**Observed A12.** Opening stock se ₹100 sale aur ₹60 unit cost par gross profit ₹100 dikha. Fixture ke hisaab se ₹40 expected tha.

> Profit & Loss ke liye period ki purchase total ki jagah sold quantity ka historical COGS use karo. Sale line par cost basis snapshot persist karo aur returns ke accounting treatment ko verify karo. Historical records ki unknown cost ko report mein explicitly mark karo. Opening inventory, unsold purchases, returns aur baad mein badli product cost test karo. ₹100 sale with ₹60 known cost ka gross profit ₹40 aur gross margin 40% ho.

## 16 — Category hierarchy preserve karo · P1

**Observed A14.** Parent category delete hui aur child ka reference deleted ID par reh gaya.

> Category delete se pehle product aur child references check karo. Referenced category ke liye archive ya explicit re-parent flow do. Parent ID ko same tenant mein validate karo aur cycles prevent karo. Concurrent edit/delete aur existing orphaned relationships cover karo. Parent with child case mein ya parent preserved rahe ya child ko approved valid parent mile.

## 17 — Normal shop usage par throttling tune karo · P1

**Observed A09.** Shared IP se normal authenticated reads HTTP 429 mein block hue. Global limit 200 requests per 15 minutes hai, aur prior calls bhi isi bucket mein count hue.

> Global, authenticated business traffic aur sensitive auth/upload limits ko measured workload ke against tune karo. Trusted proxy topology validate karo aur legitimate staff sessions ko shared shop IP par proportionate capacity do. UI retry timing clear dikhaye aur bill draft intact rakhe. Shared-IP cashier and owner workflow, background refresh aur 429 recovery test karo. Abuse protections retain karo.

## 18 — Flagged dependencies remediate karo · P0

> `npm audit --omit=dev` ko server aur client mein run karo. Server par Mongoose aur proxy-addr audit entries critical label hui hain. body-parser, compression, engine.io, multer, sharp aur socket.io-parser high flagged hain. Client mein socket.io-parser high flagged hai. Official advisories aur installed lockfile versions se applicability confirm karo. Compatible patched releases aur lockfile select karo. Clean install ke baad auth, multipart uploads, tenant scoping, Socket.IO aur transaction tests run karo. Outstanding high/critical advisory ki applicability aur mitigation security notes mein document karo.

## 19 — Owner dashboard, POS aur operations UI · UI

> Auth redesign ke typography, spacing aur color tokens ko owner workspace mein extend karo. Light neutral shell, readable text aur role-based sidebar use karo. Owner dashboard par New Bill, today's sales, low stock aur pending orders prioritize karo. POS mein search/barcode field, readable receipt preview aur total/payment controls reachable rakho. Products, Inventory, Orders, Udhar aur Reports clearly grouped hon. Navigation mein duplicate labels hatao. 390 px mobile par readable list or cards use karo aur desktop tables keyboard se operate ho saken. Loading, empty, error and saved states style karo. Existing role permissions, order routes aur money/stock logic preserve karo. Owner, packer, delivery, customer aur super-admin screens ka responsive smoke test run karo.

## 20 — Route loading aur tenant-safe cache · UI performance

> Existing React lazy routes aur RTK Query setup improve karo. Navigation par sidebar/header mounted rakho aur content area mein skeleton use karo. Login ke baad POS, Products aur Orders ko selective prefetch karo. Product/stock/order writes ke baad related views invalidate karo. Logout aur account/tenant switch par prior session cache clear verify karo. Bill, stock aur payment confirmation server success par hi dikhao. Slow network mein route change, expired session refresh aur tenant switch test karo. Staging data aur owner device par baseline aur after numbers capture karo. Measure click feedback, cached navigation, login aur read API p95 separately.

## 21 — One-week trial deployment aur go/no-go · P0

> Isolated staging deployment setup karo. Always-on HTTPS API, SPA deep-link rewrites, backend ke paas MongoDB replica set, durable uploads aur private proof access configure karo. Hashed assets cache karo aur HTML revalidate karo. HTTPS refresh cookies, CORS, tenant-safe caching aur API readiness validate karo. Deploy/restart ke baad DB, bill, roll-forward/rollback compatibility aur payment proof recovery test karo. Owner ke phone aur counter laptop par login → product → POS → receipt print → stock → refund → closing journey chalao. Guest checkout → tracking aur staff packing/delivery bhi verify karo. Slow internet aur timeout/retry ke cases include karo. Har P0 ka result record karo. Real data use karne se pehle successful isolated restore, reconciled totals, backup-alert verification aur measured staging performance required rakho.

