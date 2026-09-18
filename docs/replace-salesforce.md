# Moving off Salesforce

Salesforce holds four objects your business actually runs on: Accounts, Contacts, Opportunities and Leads. Everything else on the invoice, the editions, the per-seat licences, the add-on clouds, the admin hours, is the machinery around those four tables. This system is the same four tables in Postgres you own, and the move is one afternoon of exports and one command.

## 1. Get your data out

Use Data Loader (free, Salesforce's own tool), the weekly Data Export (Setup, then Data Export), or a report per object exported as CSV. Column names are matched case-insensitively and the common variants are accepted; nothing needs renaming. Standard fields are all this import needs:

- **Account.csv**: Id, Name, Type, Industry, BillingCity, BillingCountry, Phone, Website
- **Contact.csv**: Id, FirstName, LastName, Title, Email, Phone, AccountId, HasOptedOutOfEmail
- **Opportunity.csv**: Id, Name, StageName, Amount, CloseDate, AccountId, Probability, LeadSource, CreatedDate
- **Lead.csv**: Id, FirstName, LastName, Company, Title, Email, Phone, Status, LeadSource, State

Export while your subscription is live. Sandbox and export access end at the subscription boundary, and buying a month of licences to get your own data back is a bad way to spend the money you just saved.

## 2. Import here

Dry run first, always:

```bash
npm run crm -- import salesforce --accounts=Account.csv --contacts=Contact.csv --opportunities=Opportunity.csv --leads=Lead.csv --dry-run
```

Nothing is written. Read the counts and every skip reason; the usual skip is a contact whose AccountId is not in the account file. Then the same command without `--dry-run`.

## 3. What maps

| Salesforce | Here |
|---|---|
| Account (Name, Type, Industry, Billing address) | `accounts`, with the Salesforce Id in `external_ref` |
| Contact, linked by AccountId | `contacts`, linked to the right account |
| HasOptedOutOfEmail | `opted_out`, enforced at the gate: those contacts can never be emailed from here |
| Opportunity: StageName | the six stages here, mapped by name (custom stages land on the nearest) |
| Amount, CloseDate, Probability | `amount_cents`, `close_date`, `probability`, and the weighted pipeline is the same arithmetic |
| Opportunity Owner (by name) | the matching rep, when the export carries names rather than Ids |
| Lead (Company, Status, LeadSource, State) | `leads`, with State as the routing region for `lead route` |
| Closed Won / Closed Lost | `won_on` / `lost_on` set from the close date |
| Reports and dashboards | the SQL views (`v_pipeline`, `v_forecast`, `v_attention`...), `npm run view`, and any question you can phrase |

Re-running the import updates on the Salesforce Id rather than duplicating.

## 4. What does not carry over, deliberately

- **The stage history.** Salesforce's OpportunityFieldHistory is gated and partial; history here starts fresh from the import and is complete from day one.
- **Chatter, files and email threads.** They live where they live. The activity record here starts with the selling you do next, and `log` takes ten seconds.
- **Workflows, flows and validation rules.** The ones that mattered become slash commands or gates (`opp won` refusing an unpriced deal is a validation rule; it just lives in the open). Ask `/customise` for the ones you miss.
- **Custom objects.** Real ones become real tables: describe them to `/customise` and the migration gets written. Most turn out to be a column, not an object.
- **Einstein scores.** The forecast here is arithmetic you can read: amount times probability, summed inside the quarter. If you want opinions on top, the agent reading your pipeline is better at it than a black box was.

## 5. After the import

```bash
npm run crm -- stats
npm run crm -- accounts
npm run crm -- pipeline
npm run crm -- lead route
npm run crm -- forecast        # after: quota set <rep> --amount=<dollars>
npm run crm -- compliance
```

Quotas do not export from Salesforce; set them once with `quota set`. Then run one week in parallel with the old system and compare the pipeline on Friday. The account count and a spot-check of ten opportunities against the old system are the two things worth an hour.
