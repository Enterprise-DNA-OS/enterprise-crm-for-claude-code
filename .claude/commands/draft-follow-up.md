---
description: Draft the follow-up email for a deal, a quiet customer or an untouched lead, from the full record, into drafts/. Never sent from here.
---

1. Read the whole record first: `npm run crm -- opp <ref>` or `account <name>` or the lead's row. The draft is written from the trail, not a template.
2. Check the contact is emailable. An opted-out contact gets no draft, full stop; say so and suggest the phone call instead.
3. Write the draft to `drafts/<ref-or-account>-<date>.md`: subject line, body, one ask. Reference the last real conversation (the activity log has it), name the next step and the date already on the deal.
4. Plain language, short, no filler, no pressure phrases. It should read like the rep wrote it on a good day.
5. Report the file path and the one-line summary. A person reads it, sends it from their own mail, and then logs it: `log <ref> "sent follow-up" --kind=email --contact=<name>`.

Nothing sends from this repo. That is a feature: the day a wrong email goes out unread is the day the automation cost more than it saved.
