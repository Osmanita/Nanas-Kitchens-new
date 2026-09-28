# Chat reliability

Buyer and seller chat share a 35-second total response deadline. Gemini HTTP requests
have a 12-second timeout and at most two attempts, including the initial request.
Only transient HTTP failures are retried by the SDK; the application never replays
an entire tool conversation, since it may already have saved a menu or order.

Recent history retains up to 20 whole messages within a 60,000-character budget
(the latest message is always retained). Card IDs in retained turns remain intact.
The interface still displays the full conversation.

Both SSE endpoints send `Cache-Control: private, no-store, no-transform`. Preserve
this header through proxies: gzip buffering previously delayed visible tokens until
the response ended. A `status` event flushes the connection immediately, `error`
contains a safe user-facing message/code, and `done` ends the response. Clients must
stop reading on `done` and treat a premature EOF or empty reply as a failure.

Safe diagnostic codes in API logs:

- `CHAT_BUSY`: Gemini returned a server error, including overload (503).
- `CHAT_RATE_LIMITED`: provider quota or request limit (429).
- `CHAT_TIMEOUT`: SDK timeout or total response deadline.
- `CHAT_UNAVAILABLE`: another provider failure or empty response.

Logs include duration and buyer/seller audience, without prompts, API keys or raw
provider exception text. Google availability remains outside the application’s control.
Buyers can use **Browse nearby kitchens** after an error, and sellers can open their
menu editor. Simple nearby searches in English/Turkish with a selected location use
the kitchen API directly; dietary and other constraints still go to the assistant.

Regression checks: `pnpm --filter web test` and, from `apps/api-java`,
`./mvnw -Dtest=ChatStreamTest,ChatControllerTest test` (`mvnw.cmd` on Windows).
