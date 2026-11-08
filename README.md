# games-t99-cloud
Cloud lane for the TARGET-99 live-game sampling (Corporate Tambola, Bingo, Snakes and Ladders, Luck by Chance, Lucky Draw, Tic Tac Toe).
Plain scripts on GitHub-hosted machines; no AI model is called, no API credit is used. Secrets (repository secrets, never in files): `X_RUNNER_KEY`, `CLOUDFLARE_D1_TOKEN` (read-only gate), `CLOUDFLARE_ACCOUNT_ID`, optional `OWNER_KEY_<GAME>`.
Run: Actions > "t99 cloud sampling" > Run workflow (games, jobs 1-8, hours up to 5). Ledgers come back as artifacts `ledger-cloudN`.
