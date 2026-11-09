verified: false

# Hosting Support Playbook (General Guidance)

> Status: UNVERIFIED general guidance. This playbook is written ONLY from
> standard, public hosting-support knowledge. It is NOT Hostarise-verified
> policy, it does not describe any Hostarise plan, price, or procedure, and
> it must never be quoted to a customer as a Hostarise fact. Use it as a
> starting checklist for investigation; confirm every finding against the
> actual account, domain, or service before acting or replying.

## DNS propagation

- DNS changes can take up to 24–48 hours to propagate fully worldwide,
  although they often appear much sooner.
- Check the nameservers first: confirm the domain is using the expected
  nameservers before investigating records, because a wrong nameserver
  makes every other record check meaningless.
- Compare the live DNS answer (for example with a public DNS lookup) with
  the records configured in the hosting panel.

## SSL / HTTPS errors

- Check the certificate expiry date first; an expired certificate is the
  most common cause of a sudden browser warning.
- Check the certificate chain: an incomplete or mis-ordered chain breaks
  trust in some browsers even when the certificate itself is valid.
- Check for mixed content: a page loaded over HTTPS that still loads images,
  scripts, or styles over plain HTTP will show as not fully secure.
- Confirm the domain covered by the certificate matches the domain the
  visitor is using (including www vs non-www).

## WordPress white screen (blank page)

- A white screen usually means a PHP fatal error with error display turned
  off. Check the PHP error log (or enable error display temporarily in a
  safe way) to find the actual error instead of guessing.
- Common causes: a faulty or recently updated plugin, a theme error, or a
  PHP version incompatibility.
- Narrow it down by deactivating plugins (all at once, then one by one) and
  switching to a default theme, testing after each step.

## Email not receiving

- Check the MX records: mail is delivered to wherever the MX records point,
  so a wrong or missing MX record means mail never reaches the mailbox.
- Check SPF, DKIM, and DMARC records: missing or wrong records cause
  senders' mail to be rejected or marked as spam.
- Check the recipient's spam/junk folder, and check whether the mailbox is
  full or over quota.
- Ask the sender for any bounce message: the bounce text usually names the
  exact reason (for example, rejected, mailbox full, or authentication
  failure).
