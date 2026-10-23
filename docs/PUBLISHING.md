# Hosting and publishing

## Arrangement
* **Host:** GitHub Pages, deployed by the `Publish ACC frontend` workflow (`actions/deploy-pages`), serving only `site/`.
* **Proposed permanent address:** `https://smitblade-dot.github.io/forgedtitanium-acc/`
* **Cost:** none. GitHub Pages is free for public repositories on a free plan. A private repository needs a paid plan to use Pages.
* **Backend:** none. The authenticated reporting backend stays private and is not referenced anywhere in this repository.
* **Custom domain (optional, later):** would need a domain the owner controls and DNS changes. Not proposed for now; it is an expenditure decision.

## Nothing publishes by itself
`publish.yml` runs only on manual dispatch and only if **both** hold:
1. repository variable `ACC_PUBLISH_APPROVED` is `true` (set by the owner), and
2. the run is started with `confirm = PUBLISH`.
Tests must pass in the same run before the Pages artifact is uploaded. `ci.yml` runs tests and screenshots on every change and never deploys.

## Steps once the owner approves the URL and exposure
1. Make the repository public (or confirm a paid plan if it must stay private). This is the public exposure being approved.
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions > Variables: add `ACC_PUBLISH_APPROVED` = `true`.
4. Actions > Publish ACC frontend > Run workflow > type `PUBLISH`.
5. Check the address above. To withdraw: unset the variable, and unpublish Pages in Settings.

## Rollback
Disable Pages in Settings, or set `ACC_PUBLISH_APPROVED` to anything other than `true`. The site holds no data to clean up.
