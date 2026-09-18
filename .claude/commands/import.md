---
description: Bring the business across from Salesforce with the Data Loader exports, accounts, contacts, opportunities, leads. Dry run first, opt-outs enforced from day one, gaps flagged honestly.
---

The operator has CSVs exported from Salesforce (Data Loader, or Setup then Data Export). The full walkthrough is [docs/replace-salesforce.md](../../docs/replace-salesforce.md); the short version:

1. Four files, any subset works (accounts first if contacts or opportunities reference them):
   - **Account.csv**: Id, Name, Type, Industry, BillingCity, BillingCountry, Phone, Website
   - **Contact.csv**: Id, FirstName, LastName, Title, Email, Phone, AccountId, HasOptedOutOfEmail
   - **Opportunity.csv**: Id, Name, StageName, Amount, CloseDate, AccountId, Probability, LeadSource
   - **Lead.csv**: Id, FirstName, LastName, Company, Title, Email, Phone, Status, LeadSource, State
   Column names match case-insensitively and the common variants are accepted; nothing needs renaming.
2. Dry run first, always:
   `npm run crm -- import salesforce --accounts=Account.csv --contacts=Contact.csv --opportunities=Opportunity.csv --leads=Lead.csv --dry-run`
   Nothing is written. Read the counts and every skip reason; the usual skip is a contact whose AccountId is not in the account file.
3. Then the same command without `--dry-run`. Re-running updates on the Salesforce Id rather than duplicating.
4. After: `stats`, `accounts`, `pipeline`, `lead route`, and set the quotas (`quota set`).

What the import deliberately does on the way in:
- **HasOptedOutOfEmail becomes a locked gate**, not a preference: those contacts can never be emailed from here, and the import says how many it carried.
- **Stage names map to the six stages here**; custom stages land on the nearest one and the stage history starts fresh.
- **Closed lost rows with no reason** arrive marked "imported as closed lost, no reason in the export": honest, and the last time that field is allowed to be empty.
