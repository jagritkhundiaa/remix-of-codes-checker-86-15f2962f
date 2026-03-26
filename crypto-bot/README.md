# Crypto Market Intelligence Bot

A multi-module crypto intelligence system for Discord.

Made by TalkNeon

---

## Setup

### 1. Install Dependencies

```bash
cd crypto-bot
pip install -r requirements.txt
```

### 2. Configure

Edit `config.py`:

```python
BOT_TOKEN = "your_bot_token_here"
OWNER_ID = "your_discord_user_id"
ALERT_CHANNEL_ID = "channel_id_for_auto_alerts"
```

### 3. Run

```bash
python main.py
```

---

## Commands

| Command | Description |
|---------|-------------|
| `.start` | System status |
| `.scan` | Manual market scan |
| `.watch <address>` | Track a token |
| `.unwatch <address>` | Remove tracked token |
| `.watchlist` | Show watched tokens |
| `.alerts` | Toggle auto alerts |
| `.bal <address>` | Wallet balance (BTC/ETH/SOL) |
| `.addwallet <addr>` | Track a smart wallet |
| `.rmwallet <addr>` | Remove tracked wallet |
| `.wallets` | List tracked wallets |
| `.perf` | Signal performance stats |
| `.lookup <query>` | Token lookup + score |
| `.help` | Show all commands |

---

## Modules

1. **Market Discovery** — Trending tokens + new pairs via Dexscreener
2. **Liquidity Detection** — New pairs and liquidity injections
3. **Risk Filtering** — RugCheck integration (Solana)
4. **Smart Wallet Tracking** — Monitor wallets for convergence signals
5. **Signal Engine** — Weighted scoring (momentum/volume/liquidity/wallet/risk)
6. **Entry Timing** — Stage classification (early/mid/late/exhaustion)
7. **Arbitrage Monitor** — Cross-chain price difference detection
8. **Outcome Tracking** — Self-evaluation at 5/15/30/60 min intervals
9. **Alert System** — Tiered alerts with cooldowns
10. **Wallet Balance** — Multi-chain balance lookup (BTC/ETH/SOL)

---

## Alert Levels

| Level | Score | Behavior |
|-------|-------|----------|
| LOW | <50 | Log only |
| MEDIUM | 50-69 | Normal alert |
| HIGH | 70-84 | Strong signal |
| CRITICAL | 85+ | Multi-signal alignment |

---

## Data

All data is stored in `data/intel.db` (SQLite).

- Alert history
- Outcome tracking
- Tracked wallets
- Watched tokens
- Cooldown management
