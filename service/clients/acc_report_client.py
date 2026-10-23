"""FORGEDTITANIUM ACC-R008 reference client for agents (Python standard library only).

Signs and posts an agent report to the ACC server. This is a reference for a future,
approved integration. It is NOT wired into Travel Intelligence and makes no call unless run.

Usage:
  ACC_AGENT_SECRET=<secret> python3 acc_report_client.py --url http://127.0.0.1:8787 \
      --key-id k_xxxxxxxxxxxx --file report.json
The secret is read from the environment only, never from the command line.
"""
import argparse, base64, hashlib, hmac, json, os, secrets, sys, urllib.request
from datetime import datetime, timezone

PATH = "/v1/events"


def _b64url_decode(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(secret_b64url, method, path, timestamp, nonce, body):
    canonical = "\n".join([method.upper(), path, timestamp, nonce, hashlib.sha256(body).hexdigest()])
    return hmac.new(_b64url_decode(secret_b64url), canonical.encode(), hashlib.sha256).hexdigest()


def post_report(base_url, key_id, secret_b64url, report, timeout=10):
    body = json.dumps(report, separators=(",", ":")).encode()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = secrets.token_urlsafe(24)
    req = urllib.request.Request(base_url.rstrip("/") + PATH, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-ACC-Key-Id": key_id,
        "X-ACC-Timestamp": ts,
        "X-ACC-Nonce": nonce,
        "X-ACC-Signature": sign(secret_b64url, "POST", PATH, ts, nonce, body),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--key-id", required=True)
    ap.add_argument("--file", required=True)
    a = ap.parse_args()
    secret = os.environ.get("ACC_AGENT_SECRET")
    if not secret:
        sys.exit("ACC_AGENT_SECRET is not set")
    with open(a.file, encoding="utf-8") as f:
        report = json.load(f)
    status, body = post_report(a.url, a.key_id, secret, report)
    print(status, json.dumps(body))
    sys.exit(0 if status == 200 else 1)


if __name__ == "__main__":
    main()
