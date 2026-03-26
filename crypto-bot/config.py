# Crypto Market Intelligence Bot
# Made by TalkNeon

# ── Discord ──────────────────────────────────────────────
BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"
PREFIX = "."
OWNER_ID = "YOUR_OWNER_ID_HERE"

# ── Alert Channel ────────────────────────────────────────
ALERT_CHANNEL_ID = ""  # channel ID for automated alerts

# ── Scan Settings ────────────────────────────────────────
SCAN_INTERVAL = 60          # seconds between discovery scans
LIQUIDITY_MIN = 1000        # minimum USD liquidity to consider
VOLUME_MIN = 500            # minimum 24h volume to consider
ALERT_COOLDOWN = 600        # seconds between alerts for same token
MAX_TRACKED_WALLETS = 50    # max wallets to monitor

# ── Signal Weights (must sum to ~1.0) ────────────────────
WEIGHTS = {
    "momentum": 0.25,
    "volume": 0.20,
    "liquidity": 0.20,
    "wallet": 0.20,
    "risk": 0.15,
}

# ── Alert Thresholds ─────────────────────────────────────
THRESHOLDS = {
    "LOW": 30,
    "MEDIUM": 50,
    "HIGH": 70,
    "CRITICAL": 85,
}

# ── Outcome Tracking ────────────────────────────────────
TRACK_INTERVALS = [5, 15, 30, 60]  # minutes after alert to check price

# ── Chains ───────────────────────────────────────────────
CHAINS = {
    "solana": {
        "rpc": "https://api.mainnet-beta.solana.com",
        "name": "Solana",
        "symbol": "SOL",
        "explorer": "https://solscan.io",
    },
    "ethereum": {
        "rpc": "https://eth.llamarpc.com",
        "name": "Ethereum",
        "symbol": "ETH",
        "explorer": "https://etherscan.io",
    },
    "bsc": {
        "rpc": "https://bsc-dataseed1.binance.org",
        "name": "BSC",
        "symbol": "BNB",
        "explorer": "https://bscscan.com",
    },
    "base": {
        "rpc": "https://mainnet.base.org",
        "name": "Base",
        "symbol": "ETH",
        "explorer": "https://basescan.org",
    },
}

# ── API Endpoints ────────────────────────────────────────
DEXSCREENER_BASE = "https://api.dexscreener.com"
RUGCHECK_BASE = "https://api.rugcheck.xyz/v1"

# ── Embed Color ──────────────────────────────────────────
EMBED_COLOR = 0x2b2d31
