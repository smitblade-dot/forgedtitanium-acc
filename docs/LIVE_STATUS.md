# Live status (restricted public view)

The page can show genuine agent state without exposing anything operational. It reads **one document**, `status.json`, with an
anonymous GET (`credentials: 'omit'`, `cache: 'no-store'`), every 60 seconds while the tab is visible.

## Where the document comes from
`<meta name="acc-status-url" content="status.json">` in `site/index.html`. The committed value is same-origin, and the committed
`site/status.json` is an empty document, so a fresh deployment shows everything Unknown. The address may be changed only to
another **https** URL (the page rejects `http:`, `//host`, `javascript:` and credentials-in-URL forms and falls back to `status.json`).
The producer is the private ACC reporting service; it is not part of this repository.

## What the document may contain (schema `acc-public-status/1`)
Per agent: the register agent code, name, verified or provisional, a derived state, the reason for that state, the time of the last
report, a count of reports in 24 hours, and up to 10 history entries of `{at_utc, state, mode: dry_run|live|null, delivered_late}`.
Nothing else. The page validates the whole document against this allowlist and **ignores it entirely** if any field, type or
value is unexpected. Text from the document is only ever shown through `textContent`, and agent names always come from the register.

## States
Active, Idle, Failed, Disconnected, Awaiting approval, Unknown. A report older than 24 hours is Unknown. An Active report with no
completion for 2 hours is Unknown, because a start is not proof the agent is still running. Provisional agents have no code and are
always Unknown. Fields that are not published are labelled Not published, never left blank or invented.
