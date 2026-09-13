# Micropod / Apple Container recovery

The harness's cuttlefish runtime runs under **Micropod** (Apple Container
1.3.1). This is the runbook for diagnosing and recovering it without a machine
restart, plus the rules that keep it from wedging again.

## Symptoms

- `docker ps` against `~/.micropod/docker.sock` times out.
- `container list` / `container system df` hang indefinitely.
- Container creates, deletes, and port forwards stop working.
- `container system logs` still returns output (it reads locally).

## Root causes seen

1. **vmnet plugin crash loop (the big one).** An ad-hoc network whose
   `container-network-vmnet` plugin cannot create its interface retries every
   ~10s:

   ```
   container-network-vmnet: helper failed [error=unsupported: "failed to create
   vmnet network with status vmnet_return_t(rawValue: 1001)"] [id=<network>]
   ```

   The repeated failure holds a **pending operation** that blocks every
   container API call, which presents as a full wedge. We hit this with a
   disposable `omega-nat-test` network after kickstarting its plugin.
2. **Stale DNS/NAT on a recreated custom network.** New containers on a
   recreated network could not resolve service names; the e2e helpers work
   around this by pinning dependency IPs.
3. **Fresh volumes and `lost+found`.** Compose-created volumes contain a
   `lost+found` directory, so Postgres's `initdb` refuses to initialise. Remove
   `/data/lost+found` inside the volume before first start.

## Diagnose

```bash
node scripts/ops/micropod-health.mjs            # human summary, exit code
node scripts/ops/micropod-health.mjs --json     # machine readable
container system logs | tail -40                # watch for the crash loop
```

Exit codes: `0` healthy, `2` network crash loop, `3` API unresponsive,
`4` Micropod socket missing.

## Recover

**Crash-looping network (exit 2)** — this is safe and does not touch Apple
daemons:

```bash
node scripts/ops/micropod-net-recover.mjs --auto
# or explicitly:
node scripts/ops/micropod-net-recover.mjs --network <name>
```

It stops that network's launchd job, verifies the crash loop stopped, backs up
(never deletes blindly) and removes the network's state directory, then re-runs
the health check. It refuses to touch `default` or any `cuttlefish*` network.

**API unresponsive with no crash loop (exit 3)** — escalation ladder, stop at
the first step that works:

1. `open -a Micropod` and wait 30s, then re-run the health check.
2. Restart only Micropod's own user services (never Apple daemons):
   ```bash
   launchctl kickstart -k gui/$(id -u)/sh.micropod.docker-shim
   launchctl kickstart -k gui/$(id -u)/com.skunkworq.micropod-sharedfs
   open -a Micropod
   ```
3. Restart the privileged container daemon (needs your password):
   ```bash
   sudo launchctl kickstart -k system/com.apple.containermanagerd.system
   # if that is refused, start it directly:
   sudo nohup /usr/libexec/containermanagerd_system --runmode=privileged >/tmp/cmd.log 2>&1 &
   ```
4. Log out and back in (resets the per-user bootstrap namespace; softer than a
   reboot).
5. Reboot last.

## Do not

These actions caused or worsened the wedge and are forbidden in this repo:

- `launchctl kickstart`/`bootout` of `com.apple.container.container-network-vmnet.*`
  plugins (this is what started the crash loop).
- `pkill`/`kill -9` on `containermanagerd`, `containermanagerd_system`,
  `container-apiserver`, `container-runtime-linux`, or network plugins.
- Force-deleting containers while API calls are timing out; each timed-out
  mutation can leave another pending operation. Fix the runtime first.
- Creating ad-hoc vmnet networks for experiments. If you need one, delete it
  immediately with `container network rm <name>` while the runtime is healthy.
- Running heavy `rm -f`/`up` loops against the shim without health checks
  between steps.

## Prevention in the harness

- `scripts/ops/micropod-health.mjs` is the preflight; run it before any
  operation that mutates Micropod (the cuttlefish OTLP helper calls it
  automatically and refuses to proceed when unhealthy).
- `scripts/ops/micropod-net-recover.mjs` is the only sanctioned recovery for a
  crash-looping network.
- The e2e helpers pin Postgres/MinIO IPs so a DNS regression cannot block them,
  and they recreate only the controlplane (`--no-deps`), never the database.
- `scripts/e2e/docker-e2e.sh` keeps the harness stack in Docker Desktop, so
  harness work does not depend on the Micropod runtime being healthy.
