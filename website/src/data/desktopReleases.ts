// Changelog for the MyClaw.One desktop app. The 0.1.x line (May 2026 →)
// is the new build at https://github.com/microblue/myclaw-desk/releases.
// The 1.x entries below are the legacy product line at
// https://github.com/microblue/myclaw-desktop-releases/releases — kept
// here as historical context.

export type DesktopChangeKind = 'highlight' | 'fix'

export interface DesktopChange {
    kind: DesktopChangeKind
    text: string
}

export interface DesktopRelease {
    version: string
    date: string // ISO yyyy-mm-dd
    changes: DesktopChange[]
}

const DESKTOP_RELEASES: DesktopRelease[] = [
    {
        version: '0.1.27',
        date: '2026-05-08',
        changes: [
            {
                kind: 'highlight',
                text: 'New build line. Ships openclaw + Studio pre-installed inside the installer, so first launch no longer waits on `npm install` to finish — the splash goes from "Installing…" to a working chat in seconds rather than 10+ minutes.',
            },
            {
                kind: 'highlight',
                text: 'Faster Windows install. Total file count cut from ~36k to ~21k (-42%) and installer size from 246 MB to 191 MB (-22%) by switching the embedded Studio to Next.js standalone output, dropping the bundled npm + Node headers we no longer need at runtime, and broader pruning of build-time artifacts. Translates directly to less time waiting on Windows Defender to scan every file the installer writes.',
            },
            {
                kind: 'highlight',
                text: 'Auto-update via electron-updater + delta blockmaps. From 0.1.22 onward, future releases arrive as ~tens-of-MB delta downloads instead of the full installer.',
            },
            {
                kind: 'highlight',
                text: 'OpenRouter provider key bundled with the installer — chat works out of the box without you pasting a key. Default model pinned to anthropic/claude-haiku-4.5 via OpenRouter.',
            },
            {
                kind: 'fix',
                text: 'Studio now waits for the gateway\'s WebSocket handler to actually be ready before connecting, instead of racing it on TCP-up. Fixes the "ws closed before connect: connect failed" log line that appeared on first launch when the gateway took 10–15 seconds to finish plugin init after binding its port.',
            },
            {
                kind: 'fix',
                text: 'Studio gateway auth token is now seeded into ~/.openclaw/openclaw.json on first launch, so Studio finds the token it needs to talk to the local gateway. Previously surfaced as "no access token for openclaw connection".',
            },
            {
                kind: 'highlight',
                text: 'Version label is now visible: shown next to the brand on the splash and in the OS window title after the swap to Studio.',
            },
        ],
    },
    {
        version: '1.7.4',
        date: '2026-04-30',
        changes: [
            {
                kind: 'fix',
                text: 'Hotfix #3 for OAuth login: 1.7.3 fixed the browser-launch problem for OpenAI Codex + Anthropic + most providers via stdout snooping, but Google Gemini OAuth uses a separate code path inside openclaw that does NOT print the auth URL when its own browser launcher silently fails — leaving the spinner stuck at "Requesting secure login code". MyClaw now monkey-patches child_process.spawn inside the openclaw subprocess so any explorer.exe / open / xdg-open / wslview launch announces the URL to stdout, where MyClaw\'s main process picks it up and opens the system browser via shell.openExternal. Covers Google, OpenAI, Apple and any future provider uniformly.'
            }
        ]
    },
    {
        version: '1.7.3',
        date: '2026-04-30',
        changes: [
            {
                kind: 'fix',
                text: 'Hotfix #2 for OAuth login: after 1.7.2 cleared the TTY guard, the flow still hung at "Getting auth code" because openclaw\'s own browser launcher (which spawns explorer.exe / open / xdg-open from inside Electron\'s utilityProcess) was failing silently and no browser window was opening. MyClaw now intercepts the auth URL from openclaw\'s stdout and opens it directly via Electron\'s shell.openExternal — works for OpenAI Codex and most providers.'
            }
        ]
    },
    {
        version: '1.7.2',
        date: '2026-04-30',
        changes: [
            {
                kind: 'fix',
                text: 'Hotfix: Google / Apple OAuth login now works again. openclaw 2026.4.x added a hard "interactive TTY required" guard at the top of `models auth login` that fired before the OAuth flow could run, breaking sign-in for every browser-based provider. MyClaw now spawns openclaw through a small shim that spoofs the TTY check; the actual OAuth flow (openUrl + callback listener) needs no real TTY.'
            }
        ]
    },
    {
        version: '1.7.1',
        date: '2026-04-29',
        changes: [
            {
                kind: 'highlight',
                text: 'Uninstaller now offers a scope picker: full clean (default, removes all data), keep configuration, or keep everything. Default silent uninstall now actually wipes %APPDATA%\\myclaw-desktop on Windows — earlier builds left it behind, causing reinstalls to skip the first-launch wizard.'
            },
            {
                kind: 'highlight',
                text: 'First-launch runtime install now shows a determinate progress bar driven by package-extraction count and an honest 1–10 minute time estimate, so users can tell the install is making progress instead of staring at a sliding spinner.'
            },
            {
                kind: 'highlight',
                text: 'Bundled Node.js runtime is now shipped on Linux and macOS too (was Windows-only), so first-launch openclaw install no longer depends on a system-installed Node.'
            },
            {
                kind: 'fix',
                text: 'Bumped openclaw to 2026.4.26, picking up upstream\'s last four patch releases.'
            }
        ]
    },
    {
        version: '1.7.0',
        date: '2026-04-28',
        changes: [
            {
                kind: 'highlight',
                text: 'New Settings status panel: a glance-able view of "what is installed and what is configured" — runtime version, provider count, channel count — plus one-click buttons to repair the runtime or re-sign in to a provider. Advanced diagnostics tucked into a collapsible section so the main view stays clean.'
            },
            {
                kind: 'highlight',
                text: 'OAuth flows are now delegated to openclaw\'s own `models auth login` CLI instead of being re-implemented in MyClaw. ~2000 lines of OAuth protocol code removed from the desktop app, fixing Apple/macOS sign-in failures caused by Dock-launched apps having a minimal PATH.'
            },
            {
                kind: 'highlight',
                text: 'Channel doctor validation now runs through Electron\'s utilityProcess instead of shelling out to a global `node` binary, eliminating ENOENT failures on user machines without a system-wide Node install.'
            },
            {
                kind: 'highlight',
                text: 'Bundled `@google/gemini-cli-core` into the runtime install so Google OAuth has a guaranteed local oauth2.js — first-launch sign-in no longer depends on user PATH, network, or pre-existing global installs.'
            },
            {
                kind: 'fix',
                text: 'Bootstrap workspace files (.md templates) are now merged only after the gateway is running, eliminating "missing after retries" warnings caused by racing the gateway\'s own seed step.'
            },
            {
                kind: 'fix',
                text: 'Removed the unused "Reset OpenClaw data" menu item and the auto-login hint popup that ran every launch.'
            },
            {
                kind: 'highlight',
                text: 'Cross-platform install-smoke tests: macOS DMG and Linux AppImage now have dedicated CI workflows verifying that packaged binaries actually launch and complete first-launch openclaw runtime install on a clean machine.'
            },
            {
                kind: 'fix',
                text: '中文界面 "Agents" 统一翻译为 "智能体"。'
            }
        ]
    },
    {
        version: '1.6.4',
        date: '2026-04-28',
        changes: [
            {
                kind: 'fix',
                text: 'Self-heals broken installs from v1.6.2/1.6.3: an install-complete marker is now written only after both install passes succeed; missing/mismatched marker on launch triggers a clean reinstall instead of starting a half-broken runtime that crashed the gateway with module-not-found errors.'
            }
        ]
    },
    {
        version: '1.6.3',
        date: '2026-04-28',
        changes: [
            {
                kind: 'fix',
                text: 'Fixed runtime install on clean Windows boxes without Git Bash on PATH (plugin postinstall scripts using bash-only `2>/dev/null || true` syntax now skipped via two-pass install with --ignore-scripts).'
            },
            {
                kind: 'fix',
                text: 'Fixed npm pruning openclaw + 446 transitive deps during plugin install pass; runtime now writes a manifest declaring all top-level deps before the second install pass.'
            }
        ]
    },
    {
        version: '1.6.2',
        date: '2026-04-28',
        changes: [
            {
                kind: 'fix',
                text: 'Fixed runtime install crash on Windows machines without a global Node.js installation (preinstall script could not find \'node\' on PATH).'
            },
            {
                kind: 'highlight',
                text: 'Initialization splash now shows a progress bar with a live stage label and scrolling install log, so first-launch progress is visible at a glance.'
            }
        ]
    },
    {
        version: '1.6.1',
        date: '2026-04-28',
        changes: [
            {
                kind: 'fix',
                text: 'Fixed a crash on first launch on Windows where the app would silently exit after installing the runtime, before the gateway could start.'
            },
            {
                kind: 'fix',
                text: 'Hardened main-process startup with crash handlers so any future top-level errors surface cleanly instead of leaving the app idle.'
            }
        ]
    },
    {
        version: '1.6.0',
        date: '2026-04-24',
        changes: [
            {
                kind: 'highlight',
                text: 'MyClaw is now a dashboard, not a fork — we no longer patch openclaw at build time or write into `~/.openclaw/extensions/`. First launch fetches the pinned openclaw via `npm install` and starts it with a minimal config; everything else is openclaw’s own runtime defaults plus whatever you configure through the UI.'
            },
            {
                kind: 'highlight',
                text: 'Version range instead of exact pin — if you upgrade openclaw yourself, MyClaw respects it (within a tested-compatible range) instead of clobbering your install.'
            },
            {
                kind: 'highlight',
                text: 'Plugin install delegated to `openclaw plugins install` — we don’t copy local files anymore, we just ask the CLI.  Matches what upstream expects.'
            }
        ]
    },
    {
        version: '1.5.0',
        date: '2026-04-23',
        changes: [
            {
                kind: 'highlight',
                text: 'Stripped bundled openclaw — first launch fetches the pinned version into `~/.myclaw/runtime/` via bundled Node + npm.  Installer is smaller and you always get the openclaw version this release was tested with.'
            },
            {
                kind: 'highlight',
                text: 'Splash-style progress window during first-launch init — shows npm install progress so you know it’s not frozen.'
            },
            {
                kind: 'highlight',
                text: 'Bundled npm with Node so subsequent updates can `npm install` without needing a system Node toolchain.'
            }
        ]
    },
    {
        version: '1.4.4',
        date: '2026-04-23',
        changes: [
            {
                kind: 'highlight',
                text: 'Reset your OpenClaw data from the app menu — wipes `~/.openclaw` (config, memory, skills) with a confirmation dialog on macOS, Linux and Windows. Useful when an agent\u2019s state is corrupt or you just want a clean slate.'
            },
            {
                kind: 'highlight',
                text: 'Opt-in reset during Windows install/uninstall — a new wizard page lets you wipe `~/.openclaw` when upgrading or removing the app. Unchecked by default; your data stays put unless you ask.'
            },
            {
                kind: 'fix',
                text: 'Windows installer: fixed three NSIS regressions from the reset feature (`FileFunc.nsh` include, page function scoping, `${isUpdated}` evaluation) so the installer builds and runs cleanly.'
            }
        ]
    },
    {
        version: '1.4.3',
        date: '2026-04-22',
        changes: [
            {
                kind: 'highlight',
                text: 'Maintenance release with assorted under-the-hood improvements and updated dependencies. See the GitHub release page for the full asset list (Windows, Linux x64/ARM64 AppImage / .deb / .rpm).'
            }
        ]
    },
    {
        version: '1.4.2',
        date: '2026-04-19',
        changes: [
            {
                kind: 'highlight',
                text: 'Sleep prevention (opt-in) — keeps the OS awake while MyClaw is running so long-lived messaging channels don\u2019t drop when the machine would otherwise sleep. Off by default to protect laptop batteries.'
            },
            {
                kind: 'highlight',
                text: 'Smart reconnect after wake — Gateway is restarted automatically when its WebSocket is still dead after a Windows suspend/resume, instead of waiting out the heartbeat timeout.'
            },
            {
                kind: 'highlight',
                text: 'Windows power-outage recovery — first-run guide to enable launch-at-startup and auto-login so MyClaw is back up on its own after an unexpected reboot. Revisitable from the tray menu.'
            }
        ]
    },
    {
        version: '1.4.1',
        date: '2026-04-18',
        changes: [
            {
                kind: 'fix',
                text: 'Fixed Windows Gateway hang after 1.4.0 — disabled the Bonjour/mDNS advertiser that was stalling the startup handshake on machines with Apple Bonjour, VPN, or Hyper-V network adapters (symptom: 20-second connect timeout loop).'
            }
        ]
    },
    {
        version: '1.4.0',
        date: '2026-04-16',
        changes: [
            {
                kind: 'highlight',
                text: 'Upgraded OpenClaw runtime to 2026.4.12.'
            },
            {
                kind: 'highlight',
                text: 'Updated channel plugins: WeChat 2.1.8 and Lark / WeCom / DingTalk to their latest stable releases.'
            }
        ]
    },
    {
        version: '1.2.0',
        date: '2026-04-07',
        changes: [
            {
                kind: 'highlight',
                text: 'Compatible with OpenClaw 2026.4.5\u2019s new channel SDK layout (Discord, Telegram, Slack, WhatsApp). Falls back to 4.2 paths automatically for older Gateways.'
            },
            {
                kind: 'fix',
                text: 'Discord guild config migration — the old per-channel `allow` flag is rewritten to the new `enabled` shape on startup so Gateway stops failing config validation.'
            },
            {
                kind: 'fix',
                text: 'Bundler reliability on Windows: corrected promotion ordering and surfaced previously-silent dependency copy errors.'
            }
        ]
    },
    {
        version: '1.1.7',
        date: '2026-04-07',
        changes: [
            {
                kind: 'fix',
                text: 'WhatsApp login no longer stalls at the end of pairing — fixed a credential/connection race that caused a ~15-second hang before the flow completed.'
            },
            {
                kind: 'fix',
                text: 'Dev-mode startup loads the right OpenClaw build (with all bundled dependencies) instead of the pnpm internal store, which was missing ~379 runtime deps.'
            },
            {
                kind: 'fix',
                text: 'QQ Bot and Feishu plugins now bundle into the correct directory names.'
            },
            {
                kind: 'highlight',
                text: 'Plugin bundling supports decoupled directory name vs plugin id, unblocking plugins whose manifest id differs from their folder.'
            }
        ]
    },
    {
        version: '1.1.6',
        date: '2026-04-06',
        changes: [
            {
                kind: 'highlight',
                text: 'First release tracked in this changelog. Earlier beta history is available on GitHub.'
            }
        ]
    }
]

export default DESKTOP_RELEASES