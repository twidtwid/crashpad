# CrashPad Deployment

CrashPad is currently hosted on a Fly.io Sprite named `crashpad`.

- Public URL: `https://crashpad-bq3fs.sprites.app`
- Remote app directory: `/home/sprite/crashpad`
- Runtime port: `8080`
- Local development port: `4173`
- Sprite CLI: `/Users/toddhome/.local/bin/sprite`

## Safety Model

Crash reports at the repository root are private fixtures and must not be deployed. Refresh the Sprite from committed `HEAD` with an explicit archive instead of copying or tarring the full working tree.

The deploy archive should contain only:

- `package.json`
- `index.html`
- `privacy.html`
- `stats.html`
- `examples/`
- `scripts/`
- `src/`

Before refreshing the Sprite, check:

```sh
git status --short
git rev-parse --short HEAD
npm run ci
```

If the worktree is dirty, state the exact deploy surface and get confirmation before deploying. If the user only asked to refresh the existing public Sprite and the worktree is clean, deploy committed `HEAD`.

## Refresh The Sprite

Create a public-safe archive from `HEAD`:

```sh
git archive --format=tar.gz -o /tmp/crashpad-sprite.tar.gz HEAD \
  package.json index.html privacy.html stats.html examples scripts src
```

Upload, unpack, restart, and verify inside the Sprite:

```sh
/Users/toddhome/.local/bin/sprite exec -s crashpad \
  --file /tmp/crashpad-sprite.tar.gz:/tmp/crashpad-sprite.tar.gz \
  -- sh -lc '
set -eu
cd /home/sprite/crashpad
tar -xzf /tmp/crashpad-sprite.tar.gz
ps -eo pid=,comm=,args= |
  awk "\$2 == \"node\" && /scripts\\/server[.]js/ { print \$1 }
       \$2 == \"npm\" && \$3 == \"start\" { print \$1 }" |
  xargs -r kill || true
sleep 1
HOST=0.0.0.0 PORT=8080 nohup npm start >/tmp/crashpad.log 2>&1 &
for attempt in 1 2 3 4 5; do
  curl -fsS http://127.0.0.1:8080/ >/dev/null && exit 0
  sleep 1
done
cat /tmp/crashpad.log
exit 1
'
```

Use `-- sh -lc` after `sprite exec`; otherwise flags like `--short` or `-la` can be parsed as Sprite CLI flags instead of remote command flags.

## Verify Public Output

After the remote health check passes, verify the public Sprite:

```sh
curl -fsS https://crashpad-bq3fs.sprites.app/ -o /tmp/crashpad-sprite-index.html
curl -fsS https://crashpad-bq3fs.sprites.app/stats -o /tmp/crashpad-sprite-stats.html
curl -fsS https://crashpad-bq3fs.sprites.app/src/app.js -o /tmp/crashpad-sprite-app.js
curl -fsS https://crashpad-bq3fs.sprites.app/api/samples
curl -fsS https://crashpad-bq3fs.sprites.app/api/stats
rg -n "CrashPad|src/app.js" /tmp/crashpad-sprite-index.html
rg -n "statsGrid|src/stats.js" /tmp/crashpad-sprite-stats.html
rg -n "renderCrashStory|renderCollectionContext|renderSymbolicationReadiness" /tmp/crashpad-sprite-app.js
```

Expected sample API response contains only `examples/qlthumbnail.ips`.

## Troubleshooting

- `curl http://127.0.0.1:4173/` fails inside the Sprite because hosted runtime uses `PORT=8080`.
- Avoid `pkill -f "node scripts/server.js"` inside a shell command. The pattern can match the deployment shell and terminate the refresh command.
- Check server output with:

```sh
/Users/toddhome/.local/bin/sprite exec -s crashpad -- sh -lc 'cat /tmp/crashpad.log'
```

- Check the process list with:

```sh
/Users/toddhome/.local/bin/sprite exec -s crashpad -- sh -lc 'ps aux'
```
