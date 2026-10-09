# Cloud Logging settings (project pokemon-card-dex-511008)

Set by hand with gcloud; recorded here because the privacy policy (/privacy, "접속 기록") relies on it.

## Exclusion `oauth-callbacks` on the `_Default` sink

Sign-in callbacks carry the one-time `code` and `state` in their query string, so Cloud Run's request
logs must not keep them (Security, M6 step 3).

```
gcloud logging sinks update _Default --project pokemon-card-dex-511008 \
  --add-exclusion='name=oauth-callbacks,description=Sign-in callback URLs carry the one-time code and state (Security),filter=resource.type="cloud_run_revision" AND httpRequest.requestUrl:"/api/v1/auth/" AND (httpRequest.requestUrl:"/callback?" OR httpRequest.requestUrl:"/authorize?")'
```

- Substring `:` matches only: regex `=~` does not work in exclusion filters.
- Check: `gcloud logging sinks describe _Default --project pokemon-card-dex-511008 --format="yaml(exclusions)"`
- Retention: the `_Default` bucket keeps logs 30 days (the policy says so).
- Vercel still sees the callback path in its own short-lived request logs (the policy says so too);
  the code in it is single-use and already spent.
