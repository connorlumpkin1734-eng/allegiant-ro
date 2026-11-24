// ROrunner Help Center content.
// Each article is plain text with a tiny markup (rendered by app/help/HelpCenter.tsx):
//   ## Heading / ### Subheading      paragraphs separated by a blank line
//   - bullet      1. numbered step    | table | row |   (first row = header)
//   > Tip: …  > Note: …  > Warning: …  (callout boxes)
//   [[shot:name|Caption]]  screenshot from /help/shots/name.jpg (only shown if listed in SHOTS)
//   **bold**  `code`  [link text](#article-id) or [text](https://…)
// Keep it in step with the app: when a screen or label changes, search this file for it.

export type HelpArticle = {
  id: string;
  section: string;
  title: string;
  summary: string;
  keywords?: string;
  body: string;
};

export const HELP_SECTIONS = [
  "Getting started",
  "Repair orders",
  "Estimates & approval",
  "Doing the work",
  "Invoices & payments",
  "Customers",
  "Reports",
  "Settings",
  "Staff & teams",
  "Your account & billing",
  "Troubleshooting",
  "FAQ",
] as const;

/** Screenshots that exist in /public/help/shots (name.jpg). Markers for anything not listed are skipped. */
export const SHOTS: string[] = [];

export const SUPPORT_EMAIL = "support@rorunner.com";

export const HELP_ARTICLES: HelpArticle[] = [
  // =====================================================================================
  // GETTING STARTED
  // =====================================================================================
  {
    id: "welcome",
    section: "Getting started",
    title: "Welcome to ROrunner",
    summary: "What ROrunner does and how a car moves through it, start to finish.",
    keywords: "overview intro what is how it works tour",
    body: `ROrunner runs the paperwork side of your shop. You write repair orders, send estimates customers approve and sign from their phone, track the work, close out invoices and get paid, all in one place. It works in any browser on a computer, tablet or phone.

## How a car moves through ROrunner

Every repair order (RO) moves through the same stages. You never pick a stage from a list. ROrunner works it out from what's on the RO.

| Stage | What it means | What moves it on |
| Write-up | The RO is open and work is being written up. | Add priced jobs and send the estimate, or approve the jobs yourself. |
| Waiting on customer | An estimate is out and the customer hasn't answered every job. | The customer approves or declines, or you set a job to Approved after a phone call. |
| In the shop | Approved work is being done. | The tech marks the approved jobs Done. |
| Ready for advisor | All approved work is done. Only shown when you have techs. | The advisor uses Close & invoice. |
| Invoiced | The RO is closed and the invoice is made, but it isn't paid yet. | The customer pays online, or you record the payment. |
| Paid | Paid in full. Done. | — |

[[shot:dashboard|The Repair orders screen shows every car and where it stands.]]

## The five-minute version

1. **Set up your shop.** Name, phone, labor rate and sales tax. See [First-time shop setup](#shop-setup).
2. **Write an RO.** Click **+ New repair order**, pick or type the customer and vehicle, and write what they want on Line A. See [Write a repair order](#write-ro).
3. **Add jobs.** Under each line, add the labor and parts. See [Jobs, labor and parts](#jobs-labor-parts).
4. **Send the estimate.** The customer approves and signs on their phone. See [Send an estimate](#send-estimate).
5. **Do the work, then Close & invoice.** See [Close an RO and make the invoice](#close-invoice).
6. **Get paid.** Online through the invoice link, or record cash, check or card at the counter. See [Record a payment](#record-payment).

> Tip: Not sure where to start? On an empty Repair orders screen, click **See a sample** to open a filled-in example RO. Nothing in it is saved, and it doesn't use up a free trial RO, so click anything.

## Who this guide is for

- **Owners and admins:** everything, including [Settings](#settings-shop), [Staff](#staff-add) and [Billing](#billing-subscription).
- **Service advisors:** writing ROs, estimates, invoices and payments.
- **Technicians:** [the technician's guide](#tech-guide) covers what a tech sees and does.

Can't find something? Use the search box at the top, or email ${"support@rorunner.com"}.`,
  },
  {
    id: "create-account",
    section: "Getting started",
    title: "Create your account and sign in",
    summary: "Sign up, confirm your email, and sign in with your email or a username.",
    keywords: "sign up register create account login log in confirm email username",
    body: `## Create an account

1. Go to **rorunner.com** and click **Create account**.
2. Enter your email and a password (at least 6 characters), then type the password again.
3. Check your inbox for a confirmation email from ROrunner and click the link.
4. Come back and **Sign in**.

> Note: If you don't see the email in a few minutes, check spam or promotions. The screen says the same thing whether or not that email already has an account (so nobody can probe which emails are signed up). If you already have an account, use **Sign in** or **Forgot password** instead.

## Sign in

Type your **email or username** and your password, then click **Sign in**.

- **Owners** can set a sign-in username (like \`smithsauto\`) in **Settings → Shop** so they don't have to type their email. See [Shop details](#settings-shop).
- **Staff** (techs and advisors) always sign in with the **username** the owner gave them, not their email.

## Stay signed in

ROrunner keeps you signed in on that browser until you sign out. To sign out, click your initial in the top-right corner, then **Sign out**.

Related: [Forgot password](#forgot-password) · [Sign-in problems](#trouble-sign-in)`,
  },
  {
    id: "shop-setup",
    section: "Getting started",
    title: "First-time shop setup",
    summary: "The one-minute setup screen: shop name, phone, labor rate, sales tax and logo.",
    keywords: "setup welcome onboarding labor rate tax rate logo first time new shop",
    body: `The first time you sign in, ROrunner asks for the few details that print on every estimate, repair order and invoice. It takes about a minute, and you can change any of it later in **Settings**.

[[shot:setup|The welcome screen a new shop sees.]]

## What it asks for

| Field | Example | Notes |
| Logo (optional) | PNG, JPG, WEBP or SVG, up to 5 MB | No logo? Your shop name prints instead. |
| Shop name | Smith's Auto Repair | Prints on every document and in the browser tab. |
| Phone | 214-555-0100 | The number customers should call. |
| Address (optional) | 123 Main St | Prints on documents. |
| Hours (optional) | Mon–Fri 8–5 | Shown at the bottom of customer emails. |
| Labor rate | 120 | Per hour. New labor lines start at this rate. |
| Sales tax % | 8.25 | Charged on taxable lines (parts and shop fees by default). Type 0 if you don't charge tax. |

## Who works in the shop?

- **Just me:** you write the ROs and do the work. ROrunner hides the tech hand-off steps to keep things simple.
- **I have techs or advisors:** turns on staff logins. You'll add each person later in **Settings → Staff**. See [Add techs and advisors](#staff-add).

You can switch between these any time in **Settings → Staff**.

Click **Save and start**. If you're not ready, **Finish later** lets you look around first; ROrunner will remind you.

Next: [Write your first repair order](#write-ro)`,
  },
  {
    id: "find-your-way",
    section: "Getting started",
    title: "Find your way around",
    summary: "The top bar, the four main tabs, alerts and your account menu.",
    keywords: "navigation menu tabs top bar layout screens where is",
    body: `## The top bar

- **Your logo or shop name** (top left).
- **🔔 Alerts:** a red count means something needs you. See [Alerts](#alerts).
- **Your initial** (top right): your account menu, with your name, color theme, change password, change sign-in email and **Sign out**.

## The main tabs

| Tab | What's there | Who sees it |
| Repair orders | Every RO by stage, search, and **+ New repair order**. Techs see it as **My jobs** or **Team jobs**. | Everyone |
| Customers | Your customer list, each customer's vehicles and service history. | Owners, admins, advisors |
| Reports | Sales & tax, and Team numbers (when you have staff). | Owners and admins |
| My stats | Your own numbers. | Techs and advisors |
| Settings | Shop details, pricing, canned jobs, branding, payments and billing, staff. | Owners and admins |

ROrunner remembers which tab you were on if you refresh the page.

## Light or dark

Click your initial, then pick **Light**, **Dark** or **Match my device** under Theme. It's saved to your login, so it follows you to other devices.

## Using ROrunner on a phone

Everything works on a phone. To get an app-style icon on your home screen:

- **iPhone (Safari):** tap the Share button, then **Add to Home Screen**.
- **Android (Chrome):** tap the ⋮ menu, then **Add to Home screen** or **Install app**.

## Updates

When we release an update, a bar appears saying **A new version of the app is available**. Save what you're working on, then click **Refresh now**. ROrunner never refreshes by itself, so you won't lose an RO you're in the middle of writing.`,
  },

  // =====================================================================================
  // REPAIR ORDERS
  // =====================================================================================
  {
    id: "dashboard",
    section: "Repair orders",
    title: "The Repair orders screen",
    summary: "Stages, search, filters and what each label on a card means.",
    keywords: "dashboard list board stages filter search find ro status pill labels",
    body: `This is home base. Every open RO is listed with its vehicle, customer, stage and total.

[[shot:dashboard|Each card shows the vehicle, customer, stage and total.]]

## Find an RO

- **Search** by customer name, phone, VIN, plate or RO number.
- **Stage buttons** across the top (Active, All, Write-up, Waiting on customer, In the shop, Ready for you, Invoiced · unpaid, Paid, Archived) show only ROs in that stage. The number on each is how many there are. A stage with nothing in it is hidden.
- Click a card to open the RO.

## What the labels mean

| Label | Meaning |
| Waiting on customer | An estimate is out and they haven't answered yet. |
| In the shop | Approved work is being done. |
| Waiting on parts | A tech set a job to Waiting on parts. |
| Ready for you | A tech finished all approved work and handed it to you. |
| Sent to advisor | (Tech's view) You handed it off; it's with the advisor. |
| Invoiced · unpaid | Closed and invoiced, waiting on payment. |
| Zelle sent · confirm | The customer says they sent a Zelle payment. Check your bank, then confirm it. See [Zelle](#zelle). |
| Needs a tech | (Lead tech) A team car nobody is on yet. |
| Unassigned | No tech is on it. |
| Archived | Hidden from the normal list. See [Void, archive or delete](#void-archive-delete). |

## Techs: Mine, Team, All

Technicians see **My jobs** with a **Mine / Team / All** switch, depending on how your shop hands out work. See [How techs get work](#tech-work-mode).`,
  },
  {
    id: "write-ro",
    section: "Repair orders",
    title: "Write a repair order",
    summary: "Customer, vehicle, mileage and the customer's concerns, step by step.",
    keywords: "new ro create repair order write up check in customer vehicle concern line",
    body: `1. On **Repair orders**, click **+ New repair order**.
2. **Customer:** start typing in **Been here before? Search name, phone, plate or VIN**. Pick them from the list, or skip the search and fill in the boxes to add someone new. Picking an existing customer fills in their info, and changes you make update their record.
3. **Vehicle:** pick one of their vehicles on file, or choose **+ Add a different vehicle**. Type the year, make and model, or enter the VIN and click **Decode VIN** to fill it in. See [VIN decode and scan](#vin).
4. **Mileage in.** If your shop requires mileage, you can't open the RO without it. See [Require mileage](#settings-shop).
5. **Line A:** write what the customer wants, in their words. Example: *Customer states grinding noise from the front when braking.*
6. Add more lines for each separate thing they want (+ Customer request or + Customer concern).
7. Click **Save repair order**.

[[shot:new-ro|A new RO: customer and vehicle on top, lines below, total on the right.]]

You don't have to price anything yet. A write-up can be just the customer's concerns; the jobs come after the car is looked at.

## Requests vs. concerns

| Kind | Use it for | Example |
| Customer request | Something they already know they want. Nothing to diagnose. | Oil and filter change. Tire rotation. |
| Customer concern | A problem that needs to be diagnosed first. Has a **Cause** box for what you found. | Grinding noise when braking. A/C blowing warm. |
| Technician recommendation | Something found during the inspection that the customer didn't ask about. | Front pads at 2 mm. |

Change a line's kind any time from its ⋯ menu (**Change to customer request / concern**).

## Each line has three parts (the 3 C's)

- **Concern** (or request): what the customer wants, in their words. Only advisors and owners can edit it.
- **Cause:** what the tech found. Concern lines only.
- **Correction:** what was done. Filled in after the work. It prints on the invoice.

## Priority

Set **Safety**, **Soon** or **Can wait** on any line from the **Priority…** menu. Customers see it on the estimate as *Safety — fix now*, *Needs attention soon* or *Can wait*. Use the ↑ ↓ arrows to put lines in the order you want; the letters (A, B, C…) follow the order.

## Shop notes and customer notes

- **Visit details → Notes:** prints on customer documents. Example: *Customer prefers a call before any additional work.*
- **+ Shop note** on a job: private. The customer never sees it.

Next: [Jobs, labor and parts](#jobs-labor-parts)`,
  },
  {
    id: "jobs-labor-parts",
    section: "Repair orders",
    title: "Jobs, labor and parts",
    summary: "Add a job under a line, then its labor hours, parts, fees and discounts.",
    keywords: "job labor parts hours price markup add part add labor fee discount shop supplies tax taxable",
    body: `A **job** is one repair under a line: its name, labor and parts. A line can have more than one job (for example, the brake line might have *Replace front pads and rotors* and *Brake fluid flush*).

## Add a job

1. Under the line, click **+ Add job** (or **+ Canned job** to drop in a saved one; see [Canned jobs](#canned-jobs)).
2. Name it, like *Replace front pads and rotors*.
3. Click **+ Labor** and enter the hours. The rate starts at your shop's labor rate.
4. Click **+ Part** for each part: name or number, quantity and your **cost**. ROrunner fills in the price from your parts pricing. See [Parts pricing](#parts-pricing).

[[shot:job|A job with labor and parts. The total builds on the right.]]

If the labor description is left blank, it takes the job's name, the way a dealer RO reads.

## Change a part's price by hand

Type a different markup or price and that part is marked **Manual price**: shop pricing won't change it anymore. To go back, use **Use shop pricing** on that part.

## Fees and discounts

Under **Fees & Discounts**, click **+ Fee** (starts as *Shop supplies*) or **+ Discount**. Discounts take money off the total; fees and discounts only apply when at least one job on the RO is approved.

## What gets taxed

Each line has a **Tax** checkbox. By default, **parts and fees are taxed** and **labor is not**. Untick or tick it per line to match your state's rules. To change the rate on one RO, use ⋯ → **Change tax rate**.

## Who can change prices

- **Owners and admins:** everything.
- **Service advisors:** everything except the labor rate on a single line, unless you allow it in **Settings → Staff → Pricing permissions**.
- **Technicians:** never see money. If **Technicians can price the parts they add** is on, they can enter part prices on their own recommendations.

## Job approval status

Every job has an **Approval** setting:

| Status | Meaning | Billed? |
| Approved | Go ahead. Customer requests and jobs added at write-up start here. | Yes |
| Needs customer OK | Waiting on the customer. Concerns and recommendations start here. | Only once approved |
| Declined · not doing | The customer said no. Kept on record and listed on the invoice as declined. | No |
| Tech request · needs pricing | A technician's recommendation waiting for you to price it. Customers don't see it. | No |

Next: [Send an estimate](#send-estimate)`,
  },
  {
    id: "vin",
    section: "Repair orders",
    title: "VIN decode and scan",
    summary: "Fill in year, make, model and engine from the VIN, by typing or with your camera.",
    keywords: "vin decode scan camera barcode photo vehicle year make model engine",
    body: `## Type the VIN

Enter the 17-character VIN in the vehicle section and click **Decode VIN**. ROrunner fills in the year, make, model, trim and engine. Check them, then save.

## Scan it with your phone

1. Click **Auto-scan VIN**.
2. Point the camera at the VIN (door jamb sticker or windshield), straight on and in good light, with all 17 characters inside the guide.
3. It captures by itself when it can read it, then asks **Use and decode this VIN?**

If live scanning isn't supported by your browser, use **Take VIN photo instead**: snap a clear, close photo and ROrunner reads the VIN from it.

## If it doesn't work

- *I couldn't find a clear 17-character VIN.* Get closer, hold the phone straight, and use more light. Glare on the windshield is the usual problem; try the door jamb sticker.
- *VIN decoding failed* or *did not respond.* The free government VIN service is busy or down. Type the year, make and model by hand and try decoding later.
- Camera won't open? Your browser needs permission to use the camera. See [Camera and photos](#trouble-camera).`,
  },
  {
    id: "canned-jobs",
    section: "Repair orders",
    title: "Canned jobs",
    summary: "Save a job you do all the time, then drop it onto any RO in one click.",
    keywords: "canned job template saved job menu preset common job",
    body: `A canned job is a saved job: its name, labor hours and parts. Use them for the work you do every week.

## Save one

1. Build the job on any RO the way you like it.
2. Open the job's ⋯ menu and choose **Save as canned job**.
3. Give it a name you'll recognize, like *Front brakes — pads & rotors*.

If you already have one with that name, ROrunner asks whether to replace it.

## Use one

Under a line, click **+ Canned job**, search, and pick it. It's added with **today's** labor rate and parts pricing, and the saved hours and part costs. Check the hours and parts, then send it.

## Rename or delete

**Settings → Canned jobs.** Deleting one doesn't change ROs that already used it.`,
  },
  {
    id: "declined-before",
    section: "Repair orders",
    title: "Work declined on an earlier visit",
    summary: "ROrunner reminds you of work the customer turned down before, so you can offer it again.",
    keywords: "declined last time previous visit follow up recommended service history",
    body: `When you open an RO for a vehicle, ROrunner checks its earlier ROs for jobs the customer declined that haven't been done since. They show in a **Declined last time** box.

- **+ Add to this RO** brings the job back as its own recommendation line, at today's pricing, marked **Needs customer OK**.
- **Hide for now** tucks it away on this RO.

A declined job drops off the list once the same job (by name) is done on a later RO. You'll also see these on the customer's page under **Declined, not done yet**.`,
  },
  {
    id: "photos-videos",
    section: "Repair orders",
    title: "Photos and videos",
    summary: "Show the customer what you found. They see photos and videos with the job on the estimate.",
    keywords: "photo picture video upload camera caption show customer",
    body: `Every job has a **Photos & videos** section.

1. Open the job and tap **Photos & videos**.
2. Add a photo or video from your phone's camera or files.
3. Add a short caption the customer will see, like *Front pads at 2 mm*.

The customer sees them with that job on the estimate. Photos also print with the documents.

> Tip: A 10-second video of a leaking water pump or a worn tire sells the job better than any description.

## If a video won't play

Some phone videos are in a format Chrome on Windows can't play. The customer can still watch them on their phone. On your computer, use **Open / download file** or try Safari.

Deleting a photo or video can't be undone.`,
  },
  {
    id: "save-conflicts",
    section: "Repair orders",
    title: "Saving, and when someone else changed the RO",
    summary: "Save changes, unsaved-change warnings, and what to do when two people edit the same RO.",
    keywords: "save unsaved changes discard conflict someone else changed reload save mine anyway",
    body: `## Save

Click **Save changes** (bottom right). Some things save the moment you tap them: a job's progress (Done, In progress, Waiting on parts), assigning a tech, and sending.

If you try to leave with unsaved changes, ROrunner asks first: **OK** leaves and loses them, **Cancel** keeps you there so you can save.

## "Someone else just changed this RO"

ROrunner checks before saving. If another person, or the customer answering the estimate, saved changes after you opened the RO, you'll see a yellow warning with three choices:

- **Reload:** see their changes. Anything you haven't saved is lost.
- **Save mine anyway:** your version replaces theirs.
- **Keep editing:** do nothing for now.

> Warning: If the customer just answered the estimate, choose **Reload**. Saving yours on top can undo their decisions.`,
  },
  {
    id: "sample-ro",
    section: "Repair orders",
    title: "The sample RO",
    summary: "A filled-in example you can click around in. It's never saved.",
    keywords: "sample example demo practice try",
    body: `When you have no ROs yet, the Repair orders screen offers **See a sample**. It opens a filled-in RO with a customer request, a customer concern and a technician recommendation, priced with your own labor rate and parts pricing.

- Nothing in it is saved, and it doesn't use a free trial RO.
- Click **Close sample** when you're done, then start your own with **+ New repair order**.`,
  },
  {
    id: "void-archive-delete",
    section: "Repair orders",
    title: "Reopen, void, archive or delete an RO",
    summary: "Which one to use, and what each does to your records.",
    keywords: "void archive delete reopen remove cancel hide restore undo close",
    body: `Find these in the RO's ⋯ menu, or on the RO's card on the Repair orders screen.

| Action | What it does | Can you undo it? |
| Reopen RO | Sends a closed RO back to the shop so you can change it. It comes off Invoiced until you close it again. | Close it again. |
| Void | Marks the RO void. It stays in your history and reports skip it. | Yes, it can be reopened later. |
| Archive | Hides the RO from the normal list. Nothing is changed. | Yes, restore it any time. |
| Delete | Permanently removes the RO, its lines, inspection, photos and estimate approvals. | **No.** |

> Warning: ROs with payments recorded can't be deleted, because payments are your money trail. Void or archive those instead.

**Which should I use?** Archive to tidy up. Void when the job didn't happen (wrong car, customer left). Delete only for a mistake you never want to see again, like a duplicate RO.`,
  },

  // =====================================================================================
  // ESTIMATES & APPROVAL
  // =====================================================================================
  {
    id: "send-estimate",
    section: "Estimates & approval",
    title: "Send an estimate",
    summary: "Email or text the customer a link to approve, decline and sign from their phone.",
    keywords: "send estimate email text sms link approval quote",
    body: `1. Price the jobs and set each one to **Needs customer OK** (or leave it **Approved** if they already said yes).
2. Click **Send estimate** (the main button at the bottom, or ⋯ menu).
3. Choose how:
   - **Email it:** check the customer's email. Fix it if needed; it's saved to the customer. Tick the box to include the multipoint inspection if you did one. Click **Send estimate**.
   - **Text it:** ROrunner makes the approval link and writes the message. On a phone it opens your texting app; on a computer, use **Open in your texting app** or **Copy the message**. The text comes from your own phone, so there's no per-text cost.

[[shot:send|Email it or Text it. Texts go from your own phone.]]

Unsaved changes are saved first, so the customer always gets the latest version.

## After it's sent

- The RO moves to **Waiting on customer**.
- You'll see **First opened** with a time once the customer opens the link.
- When they answer, you get an alert and the RO moves on by itself.

## Send it again

Changed something? Send it again. The new link replaces the old one: the old link now says the estimate was superseded, so the customer can't approve an out-of-date version.

## The customer said yes on the phone

You don't need to resend. Set those jobs to **Approved**, then save.

Next: [What the customer sees](#customer-approval)`,
  },
  {
    id: "customer-approval",
    section: "Estimates & approval",
    title: "What the customer sees",
    summary: "The approval page: approve or decline each job, sign with a finger, done.",
    keywords: "customer view approval page sign signature approve decline mobile phone link",
    body: `The customer taps the link and sees your logo, their vehicle, and each job with its price, priority, photos and videos.

[[shot:approval|The customer's estimate page on a phone.]]

1. For each job they tap **✓ Approve** or **✕ Decline**. Jobs you already approved at drop-off show as **Already authorized**.
2. The **Selected total** at the bottom updates as they choose.
3. To approve anything, they type their **full name**, **sign** in the box with a finger, and tick the authorization box.
4. They tap **Sign & approve**.

If they decline everything, no signature is needed. They tap **Submit declined services**.

They see a confirmation, and you get an alert. The signature, name, time and the exact estimate they approved are kept with the RO and print on the invoice under **Work authorization**.

## If they can't open it

See [Customer can't open the estimate link](#trouble-customer-link).`,
  },
  {
    id: "approval-results",
    section: "Estimates & approval",
    title: "After the customer answers",
    summary: "Approved jobs go ahead, declined jobs are kept on record, and the totals update.",
    keywords: "approved declined partially approved results decision authorized total",
    body: `When the customer answers:

- Approved jobs become **Customer approved** and can be worked.
- Declined jobs become **Customer declined**. They stay on the RO and print on the invoice as declined, not charged.
- The sidebar shows **Approved total**, with the **Full estimate (incl. unapproved)** underneath in gray.
- The **Customer estimate decisions** box on the RO shows each decision and the authorized total.

## They changed their mind about a declined job

Open the job and use **Record additional authorization** (or **Include on invoice**). Write how they approved it, like *Customer approved by text on Sept 19*. That note prints on the invoice, and the original signed estimate stays as it was. To undo it, use **Remove override**.

## Found more work after they approved

Add it as a new line or job (it starts as **Needs customer OK**) and send the estimate again. They'll only need to answer the new work.`,
  },
  {
    id: "inspection",
    section: "Estimates & approval",
    title: "Multipoint inspection",
    summary: "A full digital inspection that turns findings into recommendations and goes out with the estimate.",
    keywords: "multipoint inspection mpi checklist tires brakes measurement report share pdf",
    body: `Open an RO and click **Inspection** (in the customer and vehicle details).

## Fill it in

- Each item gets **Good**, **Monitor**, **Service** or N/A. Add notes and measurements (tread depth in 32nds, pad thickness in mm, and so on).
- **Rest of section good** marks everything left in that section Good in one tap.
- Click **Save inspection**.

## Turn findings into work

Every item marked **Monitor** or **Service** has **+ Add to RO**. It adds a technician recommendation line to the RO with the job already created, ready to price. **Add all "Service" items to RO** does them all at once. Items already added show **✓ On the RO**.

## Share it with the customer

- **With the estimate:** when you email the estimate, tick the box to include the inspection.
- **On its own:** ⋯ → **Share with customer** emails a link to the full inspection report.
- **Export PDF:** download a printable copy.

The customer's report shows a summary, everything flagged for Monitor or Service, and your notes. If nothing was flagged, it says *Everything checked out*.`,
  },

  // =====================================================================================
  // DOING THE WORK
  // =====================================================================================
  {
    id: "tech-guide",
    section: "Doing the work",
    title: "The technician's guide",
    summary: "What a tech sees, how to mark work done, recommend repairs and hand the car back.",
    keywords: "technician tech my jobs work order done recommend hand off send to advisor mechanic",
    body: `Techs see the work, never the money: no prices, totals, estimates or invoices.

[[shot:tech|A technician's view of an RO: lines, jobs and progress. No prices.]]

## Your list

**My jobs** shows the cars you're working. Cars you've handed to the advisor drop to the bottom. Depending on how the shop hands out work, you may also see **Team** and **All**. See [How techs get work](#tech-work-mode).

## Working a car

1. Open the RO. Read each line's concern.
2. Write what you found in **Cause**.
3. Set each job's **Progress**: Not started → In progress → **Waiting on parts** (if you're stuck) → **Done**.
4. Before a job can be marked **Done**, write what you did in **Correction**.

Progress saves the moment you tap it.

## Found something else?

Click **+ Recommend repair**. Describe it, set the priority, and add labor and parts if you know them. It goes to the advisor as **Tech request · needs pricing**. Customers never see it until the advisor prices it and sends it.

> Note: You can't change hours on labor the customer already approved. Extra time goes in as a new recommendation.

## Hand it back

When you mark the last approved job **Done**, the RO goes to the advisor (**Sent to advisor**) and they get an alert. Changed your mind? Use **Take back**.

## Your numbers

**My stats** shows your hours flagged, cars finished, hours per car and recommendations sold. Only you, the owner and admins can see them.`,
  },
  {
    id: "dispatch",
    section: "Doing the work",
    title: "Assign a tech (Dispatch)",
    summary: "Put a team or a specific tech on a car from the Dispatch box.",
    keywords: "dispatch assign tech technician team who is on it",
    body: `The **Dispatch** box on an RO shows who's on the car. What it does depends on [how your techs get work](#tech-work-mode):

| Shop setting | Dispatch box |
| Open shop | Every tech can already work it. Tag who's on it so everyone knows. |
| By team | Pick the team that has the car. Everyone on it can work it. Add a specific tech if needed. |
| By technician | Only the techs you add can see and work it. |

You can dispatch while writing up a new RO; it saves with the RO. On a saved RO, picks save as you click.

## Lead technicians

A lead tech sees every car sent to their team and picks who on the team works it. Team cars with no tech yet show at the top of their list under **Needs a tech**.

## Removing a tech who recommended work

A tech who recommended work that isn't done stays on the car by default, so their recommendation doesn't get lost. Tap them again and choose **Remove anyway** to override.`,
  },
  {
    id: "alerts",
    section: "Doing the work",
    title: "Alerts",
    summary: "The bell: who needs what, live. Turn on email copies if you want them.",
    keywords: "alerts notifications bell email notify",
    body: `The 🔔 in the top bar lights up when:

- A tech finishes a car or recommends work.
- A customer approves or declines an estimate.
- An advisor or customer approves work (techs are told).
- A customer says they sent a Zelle payment.
- An invoice gets paid.

Click an alert to open that RO. Opening an RO clears its alerts. **Mark all read** clears the rest.

## Email copies

Each person can turn on email copies of their alerts from the alerts panel. It's per person, so the owner can get emails while techs don't.

Alerts update live. On a phone that's been asleep, they catch up when you come back to the app.`,
  },

  // =====================================================================================
  // INVOICES & PAYMENTS
  // =====================================================================================
  {
    id: "close-invoice",
    section: "Invoices & payments",
    title: "Close an RO and make the invoice",
    summary: "Close & invoice turns the RO into the final invoice with only approved work on it.",
    keywords: "close invoice finish complete close ro final bill mileage out",
    body: `When the work is done:

1. Look over each line: **Correction** filled in, hours and parts right.
2. Enter **Mileage out** if your shop requires it.
3. Click **Close & invoice**.

The send panel opens so you can email the invoice right away. Not ready? Close it and send later.

## What's on the invoice

- Approved jobs, and declined jobs you recorded a separate authorization for.
- Fees and discounts.
- Declined jobs are listed separately as **Not authorized / not charged**.
- Tech requests that were never priced are never billed.
- The customer's signature from the estimate, under **Work authorization**.

## Can't close it?

- *Price or delete the tech's recommendation before closing.* A tech request is still waiting on you. Price it (and send it), or delete it.
- *Enter the mileage out before closing this RO.*
- *Mileage out can't be lower than mileage in.*

## Close without the send panel

In the sidebar, **Close RO** closes it without opening the send panel. **Close RO & mark paid** does both, for a customer who paid at the counter.

## Changed something after closing

Use **Reopen RO**, make the change and close it again. If the invoice was already paid and you add charges, ROrunner warns you; add extra work to a new RO instead.`,
  },
  {
    id: "send-invoice",
    section: "Invoices & payments",
    title: "Send or print an invoice",
    summary: "Email the invoice with a pay link, get a link to text, or print and save a PDF.",
    keywords: "send invoice email print pdf pay link copy link receipt",
    body: `## Email it

Click **Send invoice**, check the customer's email, and send. If you've connected [online payments](#online-payments), the email has a **Pay** button. Once it's paid, sending again sends a receipt.

## Text it or share a link

In the invoice preview, click **Get a pay link**, then **Copy link** and paste it into a text. The customer pays by card (and Zelle if you've set it up) from that link.

## Print or PDF

Click **Print invoice** (or **Print estimate** / **Print repair order**). In the print window, choose your printer, or **Save as PDF** to get a file. Photos load first, so give it a second.

## The document switcher

On any RO, switch between **Estimate**, **Repair Order** and **Invoice** to preview what each looks like. Techs only ever see the repair order.

Change the look in **Settings → Branding**. See [Branding](#settings-branding).`,
  },
  {
    id: "online-payments",
    section: "Invoices & payments",
    title: "Take payments online (Stripe or Square)",
    summary: "Connect your own Stripe or Square account so customers can pay invoices online, straight to your bank.",
    keywords: "stripe square connect card online payment processor fees bank ach deposit payout",
    body: `Customers can pay invoices online by card once you connect your shop's own payment account. **The money goes straight to your bank.** ROrunner never holds your funds and doesn't add anything on top of the processor's normal fees (Stripe cards are 2.9% + 30¢).

## Connect Stripe

1. **Settings → Payments & billing → Connect Stripe account.**
2. Sign in to your shop's Stripe account, or create one on the same screen.
3. Finish Stripe's questions (business info, bank account) and you'll come back to ROrunner.
4. When it says **Connected & ready**, you're set. If it says **Connected — verification pending** or **Onboarding not finished**, Stripe still needs something from you; check your Stripe dashboard, then click **Refresh status**.

## Connect Square

**Settings → Payments & billing → Connect Square**, then approve on Square's page. Your Square account needs an active location that can take card payments.

If both are connected, choose which one invoices use under **Card payments on invoices go through**.

## How a customer pays

They tap **Pay** in the invoice email or the pay link, choose how, and pay on the processor's secure page. When it goes through, the payment shows on the RO by itself and the RO is marked paid. Their processing fee shows in **Reports** as *Processing fees*.

## Refunds

Refund in your Stripe or Square dashboard. Then, on the RO, take the payment off (see [Record a payment](#record-payment)) so ROrunner's balance matches.`,
  },
  {
    id: "zelle",
    section: "Invoices & payments",
    title: "Zelle payments",
    summary: "Let customers pay by Zelle, then confirm it once it's in your bank.",
    keywords: "zelle bank transfer confirm payment manual",
    body: `## Turn it on

**Settings → Shop → Zelle phone or email**: the phone number or email your Zelle is registered to. Save. Invoices and pay links now offer **Pay with Zelle** alongside card.

## How it works

1. The customer chooses **Pay with Zelle** and sees your Zelle info and the amount.
2. They send it from their bank app, then tap **I've sent the payment**.
3. You get an alert, and the RO shows **Zelle sent · confirm**.
4. **Check your bank app.** When the money is there, open the RO and click **Confirm payment received**. Add an optional note, like the last 4 of the transfer.

> Warning: Zelle payments aren't marked paid until you confirm them. Don't confirm until you see the money in your account. Zelle payments can't be reversed by the customer, but they also can't be pulled back by you.`,
  },
  {
    id: "record-payment",
    section: "Invoices & payments",
    title: "Record a payment (cash, check or card at the counter)",
    summary: "Record counter payments, deposits and partial payments, and fix mistakes.",
    keywords: "record payment cash check card terminal deposit partial paid mark paid unpaid remove payment",
    body: `Online payments record themselves. For anything else:

1. Open the RO. In the sidebar under **Payment**, click **Record payment**.
2. **How they paid:** Cash, Check, Card or Other.
3. **Amount paid.** It starts at what's still owed.
4. Optional: check number or a note (like *Visa on the shop terminal*).
5. **Save payment.**

[[shot:payment|Record payment in the RO sidebar.]]

## Deposits and partial payments

Enter less than the full amount. It's saved as a deposit and the rest stays owed. The RO shows **Partly paid**. Paying the rest off marks it paid (and closes it, if it's still open).

## Took a payment by mistake

Click the **×** next to the payment and confirm. It comes off the balance and off the invoice, but stays in the record as cancelled. Only owners and admins can remove a payment.

## Mark paid / unpaid without itemizing

The **Mark paid** switch marks the whole RO paid without recording how. Use **Record payment** instead when you can, so your reports know how you were paid.`,
  },

  // =====================================================================================
  // CUSTOMERS
  // =====================================================================================
  {
    id: "customers",
    section: "Customers",
    title: "Customers and vehicles",
    summary: "Your customer list, each customer's vehicles, service history and declined work.",
    keywords: "customer directory profile history vehicles add customer edit archive delete",
    body: `**Customers** lists everyone. Search by name, phone, VIN, plate or vehicle.

[[shot:customers|The customer list.]]

## Add a customer

Click **+ New customer**, enter their name (and phone and email if you have them) and **Add customer**. You'll add their vehicle on their first RO. Most shops just add customers while writing the RO.

## A customer's page

Click a customer to see:

- **Customer details:** phone, email, address, notes.
- **Vehicles:** each with VIN, plate, latest mileage and **Declined, not done yet** work.
- **Service history:** every RO, filterable by vehicle.

Edit a customer's info from any of their ROs (the Customer section → **Edit**).

## Archive or delete

From the customer's ⋯ menu:

- **Archive** hides them from the list and from the new-RO search. Their history stays. Restore any time.
- **Delete** removes them and their saved vehicles permanently. It can't be undone, and it only works for customers with no repair orders. Customers with history can be archived, not deleted.`,
  },

  // =====================================================================================
  // REPORTS
  // =====================================================================================
  {
    id: "reports-sales",
    section: "Reports",
    title: "Sales & tax report",
    summary: "Sales, sales tax collected, parts profit and what's still owed, by month or week.",
    keywords: "report sales tax collected revenue profit month week csv export outstanding processing fees",
    body: `**Reports → Sales & tax.** Owners and admins only.

[[shot:reports|Sales & tax, by month.]]

## How it counts

- **Sales, tax and profit count when the customer actually pays**, in the period they paid. That's what you report sales tax on.
- **Jobs completed** count in the period the RO was closed.
- **Total outstanding** is work that's done and invoiced but not paid yet.

## The columns

| Column | Meaning |
| Sales (before tax) | Everything billed, before tax. |
| Taxable sales | The part of sales that was taxed. |
| Sales tax collected | What you owe the state. |
| Total collected | Sales plus tax. |
| Processing fees | What Stripe charged on online payments. Zelle, cash and checks show —. |
| Net deposited | Total collected minus fees. |
| Labor / Parts sales / Parts cost / Parts profit / Parts margin | The breakdown. Parts cost is what you entered as cost on the ROs. |
| Gross profit | Sales before tax minus recorded parts cost. Rent, tools and other overhead are not included. |

Switch **View by** between Month and Week, and **Columns** between Summary and All details. Download a spreadsheet with **Download CSV**.

> Tip: Gross profit is only as good as your part costs. If you leave cost at 0, that part counts as pure profit.`,
  },
  {
    id: "reports-team",
    section: "Reports",
    title: "Team report and My stats",
    summary: "Tech and advisor numbers side by side, and each person's own stats.",
    keywords: "team report technician advisor performance hours flagged productivity stats my stats",
    body: `**Reports → Team** (owners and admins) puts everyone side by side for **This week, Last week, This month, Last month or This year**, with the change from the period before.

## Technicians

Hours flagged, cars finished, hours per car, labor sales, recommendations sold (count and dollars), and average days in the shop. Every tech on an RO gets its hours.

## Service advisors

Sales, ROs closed, average RO, hours per RO, gross profit, estimates approved, tech recommendations sold, and how long finished cars wait before being invoiced (**Ready → invoiced**). An RO is credited to whoever wrote it; ROs written by the owner count for the owner.

Everything counts when the RO is closed, using what's on the invoice.

## My stats

Techs and advisors see their own numbers under **My stats**. Nobody sees anyone else's there.`,
  },

  // =====================================================================================
  // SETTINGS
  // =====================================================================================
  {
    id: "settings-shop",
    section: "Settings",
    title: "Shop details",
    summary: "Business info, sign-in username, Zelle, labor rate, tax, mileage and the document footer.",
    keywords: "settings shop business name address phone email hours username labor rate tax rate mileage footer",
    body: `**Settings → Shop.** Remember to click **Save settings** at the top when you're done. ROrunner warns you if you try to leave with unsaved changes.

[[shot:settings|Settings → Shop.]]

| Setting | What it does |
| Business name, address, phone, email | Print on every estimate, RO and invoice. Customers reply to the email. |
| Hours | Shown at the bottom of customer emails. |
| Zelle phone or email | Turns on Zelle as a payment option. See [Zelle](#zelle). |
| Sign-in username | Lets you sign in with this instead of your email. 3–20 letters, numbers or underscores. |
| Default labor rate | New labor lines start at this rate. |
| Default sales-tax rate % | Used on new ROs. Each RO keeps its own rate, so changing this doesn't change old ROs. |
| Require mileage | Mileage in is required to open an RO, and mileage out to close it. |
| Document footer | Prints at the bottom of documents. Type {shop} to print your shop name. |`,
  },
  {
    id: "parts-pricing",
    section: "Settings",
    title: "Parts pricing (flat markup or matrix)",
    summary: "One flat markup, or a matrix where cheap parts get a bigger markup than expensive ones.",
    keywords: "parts pricing markup matrix margin sliding stepped flat preset price parts",
    body: `**Settings → Parts pricing.** Enter your **cost** on each part and ROrunner sets the price.

## Flat markup

Every part gets the same markup. 50% markup on a $40 part sells it for $60.

## Parts matrix

Markup depends on part cost: cheap parts take a bigger markup, expensive parts a smaller one. That's how most shops price.

[[shot:matrix|The parts matrix with a live preview.]]

- **Start from** a preset (lighter, typical independent, or dealer-level) and adjust.
- Each row says: parts costing at least this much get this markup. The table shows the margin and what a part sells for.
- **Sliding (recommended):** markup blends smoothly between rows, so a more expensive part never sells for less than a cheaper one.
- **Stepped:** every part from one row's cost up to the next gets that row's markup. A part just over a step can sell for less than one just under it.

## Markup vs. margin

Markup is on top of cost; margin is the share of the price that's profit. 100% markup = 50% margin. The matrix shows both.

## Overriding one part

Type a price on any part and it's marked **Manual price**, so shop pricing won't change it. Changing your pricing never changes parts already on ROs.`,
  },
  {
    id: "settings-branding",
    section: "Settings",
    title: "Branding: logo and document style",
    summary: "Upload your logo and pick how estimates and invoices look.",
    keywords: "logo branding invoice style template look design colors document",
    body: `**Settings → Branding.**

## Logo

**Upload logo**: PNG, JPG, WEBP or SVG. It goes on estimates, ROs, invoices and customer emails. No logo? Your business name prints as text. A wide logo on a transparent or white background looks best.

## Invoice and estimate style

Pick a layout. The preview shows what it looks like:

| Style | Look |
| Standard | Navy table headers and a colored summary banner. |
| Clean | Minimal and light. Hairline rules, lots of white space. |
| Bold | Full-width brand header band, solid banner, condensed headings. |
| Classic | Boxed sections and a ruled grid, like a traditional shop invoice. |
| Modern | Rounded soft cards and tinted headers. |
| Elegant | Serif type with a double rule. Quiet and formal. |

The style applies to everything customers see, including documents you already sent when they reopen them.`,
  },
  {
    id: "settings-canned",
    section: "Settings",
    title: "Canned jobs settings",
    summary: "Rename or delete your saved jobs.",
    keywords: "canned jobs settings rename delete",
    body: `**Settings → Canned jobs** lists every saved job with its labor and parts summary. Rename or delete them here. New canned jobs are saved from an RO. See [Canned jobs](#canned-jobs).`,
  },

  // =====================================================================================
  // STAFF & TEAMS
  // =====================================================================================
  {
    id: "staff-add",
    section: "Staff & teams",
    title: "Add techs and advisors",
    summary: "Give each person their own login with a username. They set their own password.",
    keywords: "staff add employee technician advisor login username password invite user account",
    body: `1. **Settings → Staff.** Turn on **Enable technician & service advisor logins** if it isn't already, and save.
2. Under **Add staff**, enter their **name**, **email** (only used to reset a forgotten password) and a **username** (what they'll type to sign in, 3–20 letters, numbers or underscores). A ✓ means it's available.
3. Pick their **role**: Technician, Lead technician or Service advisor.
4. Optional: pick a **team**, tick **Can see all shop work**, or give **Full admin access**.
5. Click **Create staff account**.

ROrunner shows a **temporary password** and emails it to them. **Copy login info** now as a backup; it won't be shown again. They sign in with the username and temporary password, then set their own password.

[[shot:staff|Settings → Staff.]]

## Change or remove someone

- Change role, team, what they see or admin access right in the staff table.
- Untick **Active** to lock someone out without deleting them.
- **Remove** deletes their login. Their past work stays on your ROs and reports (as *Former staff*).

## They forgot their password

They click **Forgot password** on the sign-in screen and type their username or email. The reset link goes to the email on their staff account. To change that email, edit it in the staff table.`,
  },
  {
    id: "roles",
    section: "Staff & teams",
    title: "Roles and permissions",
    summary: "What owners, admins, advisors, lead techs and techs can each see and do.",
    keywords: "roles permissions owner admin advisor technician lead tech who can see access",
    body: `| | Owner | Admin | Service advisor | Lead tech | Technician |
| Write ROs, customer concerns | ✓ | ✓ | ✓ | — | — |
| See prices and totals | ✓ | ✓ | ✓ | — | — |
| Send estimates and invoices | ✓ | ✓ | ✓ | — | — |
| Record payments | ✓ | ✓ | ✓ | — | — |
| Remove a payment | ✓ | ✓ | — | — | — |
| Change labor rate on a line | ✓ | ✓ | If allowed | — | — |
| Price parts they add | ✓ | ✓ | ✓ | If allowed | If allowed |
| Cause, correction, job progress | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recommend repairs | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assign techs | ✓ | ✓ | ✓ | Own team | — |
| Customers tab | ✓ | ✓ | ✓ | — | — |
| Reports | ✓ | ✓ | — | — | — |
| My stats | — | — | ✓ | ✓ | ✓ |
| Settings and staff | ✓ | ✓ | — | — | — |
| Billing (subscription) | ✓ | — | — | — | — |

**Admin** is a checkbox on any staff member: *Full admin access — same as the owner.* Use it sparingly.

**Can see all shop work** (foreman) lets a tech see every RO in the shop, not just their own.

Pricing permissions are in **Settings → Staff → Pricing permissions**.`,
  },
  {
    id: "tech-work-mode",
    section: "Staff & teams",
    title: "How techs get work (open shop, teams or assigned)",
    summary: "Choose whether every tech sees every car, each team sees its cars, or techs only see cars assigned to them.",
    keywords: "tech work mode open shop by team by technician dispatch visibility teams",
    body: `**Settings → Staff → How do technicians get work?**

| Mode | How it works | Best for |
| Open shop | Every tech can see and work every RO. No dispatching. | Small shops where everyone grabs the next car. |
| By team | Give each RO to a team; every tech on that team can see and work it. You can still add a specific tech. | Shops with crews (drivability, maintenance, etc.). |
| By technician | Techs only see ROs assigned to them. | Shops that dispatch car by car. |

## Teams

Under **Teams**, type a name and **Add team**. Then pick each tech's team in the staff table. Teams are optional; skip them if you don't need them.

## Lead technicians

Make someone a **Lead technician** and pick the team they lead. They see every RO sent to their team and assign their team's techs to it.

## Per-person override

In the staff table, **Sees** can be set to *Follows shop setting*, *Their own ROs only* or *All shop work* for one person.`,
  },

  // =====================================================================================
  // ACCOUNT & BILLING
  // =====================================================================================
  {
    id: "billing-subscription",
    section: "Your account & billing",
    title: "Free trial and subscription",
    summary: "Five free repair orders, then a flat monthly price. No contract, cancel anytime.",
    keywords: "trial free subscription price billing subscribe cancel plan monthly payment card invoice receipt",
    body: `## Free trial

New shops get **5 free repair orders**, with no card needed. Everything works during the trial. (Opening **See a sample** doesn't use one.)

During the trial, once an RO has lines on it, its customer and vehicle can't be changed. Start a new RO instead.

When the trial ROs are used, your existing ROs are still there to view, but creating or editing is paused until you subscribe.

## Subscribe

**Settings → Payments & billing → Subscribe.** Enter your card in the secure Stripe form. The price is shown on the button.

- **No contract.** No setup fees, no annual commitment.
- **Month to month.** Billed on the day you subscribe.
- **Cancel anytime** in two clicks. You keep access through the month you paid for.
- **Your data is yours.** Download everything any time, even after you cancel.

A receipt is emailed after every payment.

## Manage billing

**Settings → Payments & billing → Manage billing · update card · cancel** opens your billing page, where you can update your card, see invoices or cancel.

## If a payment fails

You'll see **Payment needs attention**. You have **7 days** to update your card (**Update payment method**). After that the shop goes read-only: everything is still viewable, but nothing can be created or changed until billing is fixed. Staff see *Ask the shop owner to update billing.*

## After you cancel

The shop goes read-only at the end of the paid month. **Resubscribe** any time to pick up right where you left off.`,
  },
  {
    id: "export-data",
    section: "Your account & billing",
    title: "Download all your data",
    summary: "Export customers, vehicles, ROs, line items and payments as spreadsheets.",
    keywords: "export download data backup csv zip spreadsheet leave",
    body: `**Settings → Payments & billing → Download all your data → Download (.zip).**

You get spreadsheets of your customers, vehicles, repair orders, line items and payments, plus a complete copy of everything. It works any time, even after you cancel. Open the spreadsheets in Excel, Google Sheets or Numbers.`,
  },
  {
    id: "forgot-password",
    section: "Your account & billing",
    title: "Forgot or change your password",
    summary: "Reset a forgotten password by email, or change it while signed in.",
    keywords: "forgot password reset change password link expired",
    body: `## Forgot it

1. On the sign-in screen, click **Forgot password**.
2. Type your **username or email** and click **Send reset link**.
3. Open the email and click the link. Set a new password (at least 6 characters, typed twice) and click **Update password**.

The screen always says a link is on its way, whether or not the account exists, so nobody can probe for accounts. If no email comes, check spam, then make sure you typed the right username or email.

**Staff:** the link goes to the email on your staff account. If that email is wrong or old, ask the owner to update it in Settings → Staff (or to remove and re-add you).

**"This password reset link is invalid or has expired."** Links work once and expire. Request a new one.

## Change it while signed in

Click your initial (top right) → **Change password**.

## Change your sign-in email (owners)

Your initial → **Change sign-in email**. ROrunner sends a confirmation link to the new address; nothing changes until you click it.`,
  },

  // =====================================================================================
  // TROUBLESHOOTING
  // =====================================================================================
  {
    id: "trouble-sign-in",
    section: "Troubleshooting",
    title: "Can't sign in",
    summary: "Invalid login credentials, can't reach the server, staff sign-in problems.",
    keywords: "cant log in invalid login credentials wrong password locked out sign in problem server",
    body: `| Message | What to do |
| Invalid login credentials. | The username/email or password is wrong. Check caps lock. Staff use their **username**, not their email. Still stuck? Use [Forgot password](#forgot-password). |
| Couldn't reach the server. Check your connection and try again. | Your internet dropped. Check Wi-Fi or signal and try again. |
| Check your email for a link to confirm your account | You haven't confirmed your email yet. Find the confirmation email (check spam) and click it. |
| Signed in but asked to set a password | Normal for new staff: set your own password to replace the temporary one. |

## A staff member can't sign in

- Make sure they're using the **username** you gave them.
- In **Settings → Staff**, check they're **Active**.
- Reset it: have them use **Forgot password** with their username. If their email on file is wrong, fix it in the staff table first.

## Signed in on a different device and it's asking again

Each browser keeps its own sign-in. Private/incognito windows forget it when closed.`,
  },
  {
    id: "trouble-read-only",
    section: "Troubleshooting",
    title: "\"This shop's access is read-only right now\"",
    summary: "Why you can view but not create or edit, and how to fix it.",
    keywords: "read only paused cannot edit cannot create trial limit billing past due canceled subscription",
    body: `You can still see everything, but creating or changing anything is paused. It's one of three things:

| Message | Fix |
| You've exceeded your free trial limit of 5 repair orders. | Subscribe in **Settings → Payments & billing**. |
| This shop's payment method still hasn't been fixed, so the account is now read-only. | A card payment failed more than 7 days ago. **Update payment method** in Settings → Payments & billing. |
| Your subscription is canceled, so the shop is read-only. | **Resubscribe** in Settings → Payments & billing. Everything is right where you left it. |

**Staff** see *Ask the shop owner to update billing.* Only the owner can fix billing.

Once billing is fixed, editing comes back within a few seconds. Refresh the page if it doesn't.`,
  },
  {
    id: "trouble-save",
    section: "Troubleshooting",
    title: "An RO won't save",
    summary: "Every message you might see when saving, and what it means.",
    keywords: "cant save error saving repair order required field message",
    body: `ROrunner scrolls to the problem and outlines it in red. Here's every message:

| Message | Fix |
| Customer name is required. | Type the customer's name. |
| Enter at least the vehicle year, make, or model. | Fill in the vehicle, or decode the VIN. |
| Enter the mileage in to open this RO. | Your shop requires mileage (Settings → Shop). |
| Mileage in should be a whole number, like 45120. | Numbers only. Commas are fine; no decimals. |
| Mileage out can't be lower than mileage in. | Check both numbers. |
| Write at least one customer request or concern, or add a job. | An RO needs something on it. |
| Every job needs a name. | Fill in the Job box at the top of each job. |
| A labor/part line needs a description. | Fill in the box next to Hours/Qty, or remove the empty line. |
| Write the Correction (what was done) on this line before marking the job Done. | Fill in Correction first. |
| The sample can't be saved. | Close it and start your own with + New repair order. |
| You've used all this shop's free repair orders. | See [Read-only](#trouble-read-only). |
| Not saved yet — someone else changed this RO. | See [Saving and conflicts](#save-conflicts). |
| The repair order was saved, but the technician assignment didn't go through. | The RO is safe. Open it and dispatch the tech again. |
| Your session expired. Sign in again. | You were signed out (password changed, or signed out elsewhere). Sign in; unsaved changes on that screen may be lost. |

## Something else, or "Failed to fetch"

That's a dropped connection. Your work is still on screen: check your internet and click Save again. Don't refresh until it saves.`,
  },
  {
    id: "trouble-customer-link",
    section: "Troubleshooting",
    title: "Customer can't open the estimate or pay link",
    summary: "Invalid links, already answered, didn't get the email.",
    keywords: "customer link not working invalid expired estimate not found didnt get email spam pay link",
    body: `| What they see | Why | Fix |
| This approval link is invalid. / Estimate not found. | The link got cut off when it was copied, or the RO was deleted. | Send the estimate again. |
| This estimate was already superseded. | You sent a newer estimate after this one. | Have them open the newest message. |
| This estimate was already approved / declined. | They (or someone with the link) already answered. | Check the RO. If they need to change their answer, edit the jobs yourself, or resend the estimate. |
| This payment link is invalid. | The link was cut off or the RO changed. | Get a fresh link: **Get a pay link** or resend the invoice. |
| Already paid | It's paid. | Nothing to do. |
| They never got the email | Usually spam or a typo in their email. | Check the address on the RO (Customer → Edit), ask them to check spam, or use **Text it** instead. |

> Tip: Texting the link (**Text it**) is the most reliable way to reach customers. It goes from your own phone, so they recognize the number.`,
  },
  {
    id: "trouble-payments",
    section: "Troubleshooting",
    title: "Payment problems",
    summary: "Stripe or Square not connecting, card payments not showing, paid but RO says unpaid.",
    keywords: "stripe not working square not connecting payment not showing paid unpaid processor error",
    body: `## Stripe says "Onboarding not finished" or "verification pending"

Stripe needs more info before it can pay you out. Log in to your Stripe dashboard and finish any steps it lists, then **Refresh status** in Settings → Payments & billing.

## Square won't connect

| Message | Fix |
| Square wasn't connected — the request was cancelled on Square's page. | Click Connect Square again and approve it. |
| That Square connection attempt timed out. | Click Connect Square again. |
| Your Square account has no active location that can take card payments. | Set up a location in your Square dashboard, then connect again. |

## Customer paid online but the RO says unpaid

Online payments usually show within a minute. Refresh the page. If it's been longer, check your Stripe or Square dashboard: if the payment shows as succeeded there, email ${"support@rorunner.com"} with the RO number.

## Invoice went up after it was paid

ROrunner shows *The invoice went up after it was paid.* Either take × off a payment to reopen it, or put the extra work on a new RO (usually cleaner).

## Wrong payment recorded

Click × next to it to cancel it, then record the right one. See [Record a payment](#record-payment).`,
  },
  {
    id: "trouble-camera",
    section: "Troubleshooting",
    title: "Camera, photos and printing",
    summary: "VIN scanner or photo upload won't open the camera; photos missing when printing.",
    keywords: "camera permission blocked photo upload failed print images missing pdf",
    body: `## Camera won't open

Your browser needs permission to use the camera.

- **iPhone:** Settings → Safari → Camera → Allow. Or tap **aA** in Safari's address bar → Website Settings → Camera → Allow.
- **Android (Chrome):** tap the lock icon in the address bar → Permissions → Camera → Allow.
- **Computer:** click the camera or lock icon in the address bar and allow the camera.

Then reload the page.

## Photo or video upload failed

Usually a weak connection. Try again on Wi-Fi. Very long videos take a while; keep them short (10–30 seconds).

## Photos missing when printing

Wait for **Print / Save PDF** to finish loading (it says *Loading images…*). If it says *An image could not be loaded*, close the document, reopen it and print again.`,
  },
  {
    id: "trouble-general",
    section: "Troubleshooting",
    title: "Something looks wrong or stuck",
    summary: "Page won't load, old version, missing changes. The quick fixes that solve most problems.",
    keywords: "not loading stuck blank page broken bug refresh old version cache error",
    body: `Try these in order:

1. **Refresh the page.** Save first if you're mid-RO. Most hiccups clear right up.
2. **Update banner?** If you see *A new version of the app is available*, click **Refresh now**.
3. **Check your connection.** Messages like *Couldn't reach the server* or *Failed to fetch* mean the internet dropped.
4. **Sign out and back in** (your initial → Sign out).
5. **Try another browser** (Chrome, Safari, Edge or Firefox, kept up to date).

## Changes someone else made aren't showing

Refresh. The RO list refreshes itself, but an RO that's already open shows what was there when you opened it.

## Still stuck?

Email ${"support@rorunner.com"} with:

- What you were doing, and the exact message you saw (a screenshot is perfect).
- The RO number, if it's about an RO.
- Phone or computer, and which browser.`,
  },

  // =====================================================================================
  // FAQ
  // =====================================================================================
  {
    id: "faq",
    section: "FAQ",
    title: "Frequently asked questions",
    summary: "Quick answers to the questions shops ask most.",
    keywords: "faq questions common",
    body: `### Does it work on my phone?
Yes. Everything works in your phone's browser. Add it to your home screen for an app icon. See [Find your way around](#find-your-way).

### Do my customers need to download anything or make an account?
No. They tap a link, approve and sign in their browser.

### Can I text estimates instead of emailing?
Yes: **Send estimate → Text it**. It goes from your own phone, so there's no per-text cost.

### Do you take a cut of my payments?
No. Payments go straight to your Stripe or Square account. ROrunner adds nothing on top of their normal fees.

### Can a customer approve some jobs and decline others?
Yes. They approve or decline each job, and only approved work is billed.

### What if the customer approves by phone?
Set the job to **Approved** and save. If it was already declined, use **Record additional authorization** and note how they approved.

### Is labor taxed?
Not by default. Parts and fees are taxed; labor isn't. Change it per line with the **Tax** box.

### Can I change an invoice after it's sent?
Yes. **Reopen RO**, change it, and close it again. Then send the updated invoice.

### Can techs see prices?
No. Techs never see totals, estimates or invoices. If you allow it, they can price the parts they add.

### How many staff can I add?
As many as you need. It's one price for your whole team.

### Can I use my own logo and colors?
Upload your logo and pick a document style in **Settings → Branding**.

### What happens to my data if I cancel?
It stays. The shop goes read-only, and you can download everything any time or resubscribe to pick up where you left off.

### Can I import customers from my old system?
Not by yourself yet. Email ${"support@rorunner.com"} with a spreadsheet export and we'll help.

### Where do I report a bug or ask for a feature?
Email ${"support@rorunner.com"}. Screenshots help.`,
  },
];
