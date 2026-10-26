# Pre-launch checklist (manual)

Do this on a real spare domain before mailing a large list.

1. **SMTP** — SES (or other) credentials tested green in setup. Region matches the verified identity.
2. **DNS** — SPF, DKIM, DMARC pass in the Domain check. Wait for propagation if needed.
3. **From / postal / unsub** — Real from address, postal address, unsubscribe mailbox.
4. **Test inboxes** — Send tests only to yourself (Gmail, Outlook, iCloud).
5. **mail-tester.com** — One send; aim for a high score; fix SPF/DKIM/content issues it reports.
6. **Warm-up** — Start with a schedule/warm-up; do not blast the full list on day one.
7. **Suppression** — Confirm bounced/unsubscribed addresses stay suppressed.
8. **Stop rules** — Confirm a high bounce window pauses the run (safety stop).
9. **Backup** — Note `data/backups/`; know how to restore (`docs/operations.md`).
10. **VPN** — If you use one, confirm SMTP still connects after reconnect (auto-resume).
