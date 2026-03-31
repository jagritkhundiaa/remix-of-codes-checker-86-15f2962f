const _0x129def = _0x4582;
(function (_0x12dde3, _0x205623) {
    const _0x4243df = _0x4582, _0x377f4d = _0x12dde3();
    while (!![]) {
        try {
            const _0x4ed66f = -parseInt(_0x4243df(0x1f2)) / (-0x1230 + 0x1333 * -0x1 + 0x2564) + -parseInt(_0x4243df(0x1f3)) / (0x11fd * 0x2 + -0x623 * 0x1 + -0x1 * 0x1dd5) * (-parseInt(_0x4243df(0x22a)) / (0x1dc7 * 0x1 + -0x1de3 + 0x1f)) + parseInt(_0x4243df(0x1d5)) / (0x23da + -0x913 + -0x1ac3) * (-parseInt(_0x4243df(0x1d7)) / (-0xfd5 + 0x10 * -0x191 + -0x1 * -0x28ea)) + parseInt(_0x4243df(0x220)) / (0xe08 + 0x2 * -0x1256 + 0x16aa * 0x1) + parseInt(_0x4243df(0x221)) / (0x19ba + -0x24a0 + 0xaed) + -parseInt(_0x4243df(0x209)) / (0x1 * 0x1cb7 + -0x9 * 0x295 + -0x572) + parseInt(_0x4243df(0x1c8)) / (0x2142 + -0xd21 + 0x283 * -0x8) * (parseInt(_0x4243df(0x1d3)) / (0x1 * -0x259b + 0x1381 + 0x6c * 0x2b));
            if (_0x4ed66f === _0x205623)
                break;
            else
                _0x377f4d['push'](_0x377f4d['shift']());
        } catch (_0x514202) {
            _0x377f4d['push'](_0x377f4d['shift']());
        }
    }
}(_0x4a33, -0xbc364 + -0xc1ab3 + 0x8f * 0x3d97));
const statusEl = document[_0x129def(0x219) + _0x129def(0x1f9)](_0x129def(0x228)), openBtn = document[_0x129def(0x219) + _0x129def(0x1f9)](_0x129def(0x223)), params = new URLSearchParams(window[_0x129def(0x1fc)][_0x129def(0x1cc)]), sourceTabId = Number[_0x129def(0x1d0)](params[_0x129def(0x1e0)](_0x129def(0x1d1)) || '', 0x6d3 * 0x1 + 0x39a + -0xa63), sourceWindowId = Number[_0x129def(0x1d0)](params[_0x129def(0x1e0)](_0x129def(0x1d6)) || '', 0xe24 + 0x595 + 0x1 * -0x13af), shouldAutoClose = window[_0x129def(0x1fc)][_0x129def(0x1f7)][_0x129def(0x1e8)](_0x129def(0x1e1) + 'l');
function setStatus(_0x57104b, _0x58d4a5 = _0x129def(0x1ff)) {
    const _0x5e0723 = _0x129def;
    if (!statusEl)
        return;
    statusEl[_0x5e0723(0x230) + 't'] = _0x57104b, statusEl[_0x5e0723(0x1ec)] = _0x5e0723(0x1fa) + _0x58d4a5;
}
function isRestrictedUrl(_0x4cdab5) {
    const _0x39fcc6 = _0x129def, _0x54c744 = {
            'GRpEA': _0x39fcc6(0x20b),
            'Pevgc': _0x39fcc6(0x216) + _0x39fcc6(0x206),
            'skZwK': _0x39fcc6(0x21a),
            'QXFVP': _0x39fcc6(0x203),
            'hVxHp': _0x39fcc6(0x1d2) + _0x39fcc6(0x217) + _0x39fcc6(0x20d),
            'Kjtov': _0x39fcc6(0x211) + _0x39fcc6(0x20f) + _0x39fcc6(0x1d8) + _0x39fcc6(0x1dc)
        };
    if (!_0x4cdab5)
        return !![];
    return _0x4cdab5[_0x39fcc6(0x1e5)](_0x54c744[_0x39fcc6(0x229)]) || _0x4cdab5[_0x39fcc6(0x1e5)](_0x54c744[_0x39fcc6(0x1e7)]) || _0x4cdab5[_0x39fcc6(0x1e5)](_0x54c744[_0x39fcc6(0x22d)]) || _0x4cdab5[_0x39fcc6(0x1e5)](_0x54c744[_0x39fcc6(0x202)]) || _0x4cdab5[_0x39fcc6(0x225)](_0x54c744[_0x39fcc6(0x200)]) || _0x4cdab5[_0x39fcc6(0x225)](_0x54c744[_0x39fcc6(0x1cf)]);
}
async function getActiveTab() {
    const _0x4aea17 = _0x129def, _0x24450e = await chrome[_0x4aea17(0x226)][_0x4aea17(0x1e6)]({
            'active': !![],
            'currentWindow': !![]
        });
    return _0x24450e && _0x24450e[_0x4aea17(0x22e)] ? _0x24450e[0x2361 + 0xde1 + 0x3142 * -0x1] : null;
}
async function getTabById(_0x4c896a) {
    const _0x2a2d64 = _0x129def, _0x22dc38 = {
            'bictf': function (_0x5aa2a4, _0x4bfbb0) {
                return _0x5aa2a4 <= _0x4bfbb0;
            }
        };
    if (!Number[_0x2a2d64(0x21b)](_0x4c896a) || _0x22dc38[_0x2a2d64(0x1fd)](_0x4c896a, -0x189e + -0x6f9 + -0x1f97 * -0x1))
        return null;
    try {
        return await chrome[_0x2a2d64(0x226)][_0x2a2d64(0x1e0)](_0x4c896a);
    } catch (_0xa17078) {
        return null;
    }
}
async function getFallbackTabFromWindow(_0x5669a4) {
    const _0x37507f = _0x129def, _0x23777a = {
            'DfImt': function (_0x5eae60, _0x57e802) {
                return _0x5eae60 < _0x57e802;
            },
            'KwGqc': function (_0x48ec42, _0x3f9b68) {
                return _0x48ec42(_0x3f9b68);
            }
        };
    if (!Number[_0x37507f(0x21b)](_0x5669a4) || _0x23777a[_0x37507f(0x1ef)](_0x5669a4, 0x1af1 + -0x436 + 0x16bb * -0x1))
        return null;
    try {
        const _0x3eb515 = await chrome[_0x37507f(0x226)][_0x37507f(0x1e6)]({ 'windowId': _0x5669a4 });
        if (!_0x3eb515 || !_0x3eb515[_0x37507f(0x22e)])
            return null;
        for (const _0x501be3 of _0x3eb515) {
            if (!_0x501be3 || !_0x501be3['id'])
                continue;
            if (_0x23777a[_0x37507f(0x1de)](isRestrictedUrl, _0x501be3[_0x37507f(0x222)] || ''))
                continue;
            return _0x501be3;
        }
    } catch (_0x501486) {
    }
    return null;
}
async function resolveTargetTab() {
    const _0x2d0076 = _0x129def, _0x26d307 = {
            'ucAsp': function (_0x168d54, _0x32d223) {
                return _0x168d54(_0x32d223);
            },
            'IoJIA': function (_0x4a0493) {
                return _0x4a0493();
            }
        }, _0x49254b = await _0x26d307[_0x2d0076(0x1f5)](getTabById, sourceTabId);
    if (_0x49254b)
        return _0x49254b;
    const _0xa53790 = await _0x26d307[_0x2d0076(0x1f5)](getFallbackTabFromWindow, sourceWindowId);
    if (_0xa53790)
        return _0xa53790;
    return _0x26d307[_0x2d0076(0x20e)](getActiveTab);
}
function _0x4a33() {
    const _0x556a23 = [
        'getElement',
        'edge://',
        'isInteger',
        'TUlGm',
        'N_PANEL_AC',
        'ebsite\x20tab',
        'wHREf',
        '3032784pFRHJX',
        '4965646OCKFra',
        'url',
        'openBtn',
        'nd\x20retry.',
        'includes',
        'tabs',
        'No\x20suitabl',
        'status',
        'GRpEA',
        '969XLEVad',
        'fully.',
        'qtQbI',
        'skZwK',
        'length',
        'open\x20panel',
        'textConten',
        '18kicKvO',
        'ected\x20tab.',
        'click',
        'vYuOL',
        'search',
        'stener',
        'ab.',
        'Kjtov',
        'parseInt',
        'tabId',
        'chrome.goo',
        '7699460rSmdCV',
        'Failed\x20to\x20',
        '64Hpapvm',
        'windowId',
        '389260QRqmsM',
        'oft.com/ad',
        'pyumQ',
        'nel\x20on\x20sel',
        'ted.\x20Open\x20',
        'dons',
        '.\x20Reload\x20e',
        'KwGqc',
        'Could\x20not\x20',
        'get',
        '/popup.htm',
        'e\x20tab\x20foun',
        'poJyT',
        'disabled',
        'startsWith',
        'query',
        'Pevgc',
        'endsWith',
        'ulmUs',
        'JmHWO',
        'a\x20normal\x20w',
        'className',
        'is\x20restric',
        'sendMessag',
        'DfImt',
        'Panel\x20open',
        'BKzkG',
        '634302jJyDSK',
        '5462wLqXHC',
        'xtension\x20a',
        'ucAsp',
        'TIVE_TAB',
        'pathname',
        'Opening\x20pa',
        'ById',
        'status\x20',
        '\x20on\x20this\x20t',
        'location',
        'bictf',
        'err',
        'warn',
        'hVxHp',
        'addEventLi',
        'QXFVP',
        'about:',
        'This\x20page\x20',
        'TcnQA',
        'ension://',
        'EULmr',
        'ed\x20success',
        '8531320TaLFCK',
        'rcOdO',
        'chrome://',
        'HIT360_OPE',
        'bstore',
        'IoJIA',
        'dge.micros',
        'WWwoz',
        'microsofte',
        'ooyBU',
        'close',
        'kBTDC',
        'UulRR',
        'chrome-ext',
        'gle.com/we',
        'runtime'
    ];
    _0x4a33 = function () {
        return _0x556a23;
    };
    return _0x4a33();
}
async function openPanel() {
    const _0x8074a9 = _0x129def, _0x5f54ad = {
            'pyumQ': function (_0x58d311, _0x108eff, _0x3e55bd) {
                return _0x58d311(_0x108eff, _0x3e55bd);
            },
            'kBTDC': _0x8074a9(0x1f8) + _0x8074a9(0x1da) + _0x8074a9(0x1c9) + '..',
            'ulmUs': _0x8074a9(0x1ff),
            'ooyBU': function (_0xeafe49) {
                return _0xeafe49();
            },
            'BKzkG': function (_0x57dc65, _0x1e7eb1, _0x287190) {
                return _0x57dc65(_0x1e7eb1, _0x287190);
            },
            'JmHWO': _0x8074a9(0x227) + _0x8074a9(0x1e2) + 'd.',
            'WWwoz': _0x8074a9(0x1fe),
            'TUlGm': function (_0x1165e6, _0x14fc45) {
                return _0x1165e6(_0x14fc45);
            },
            'wHREf': _0x8074a9(0x204) + _0x8074a9(0x1ed) + _0x8074a9(0x1db) + _0x8074a9(0x1eb) + _0x8074a9(0x21e) + '.',
            'UulRR': _0x8074a9(0x20c) + _0x8074a9(0x21d) + _0x8074a9(0x1f6),
            'poJyT': function (_0x15360d, _0x423451, _0x3070f4) {
                return _0x15360d(_0x423451, _0x3070f4);
            },
            'vYuOL': _0x8074a9(0x1f0) + _0x8074a9(0x208) + _0x8074a9(0x22b),
            'rcOdO': function (_0x300ded, _0x395efb, _0x15d0a4) {
                return _0x300ded(_0x395efb, _0x15d0a4);
            },
            'EULmr': _0x8074a9(0x1df) + _0x8074a9(0x22f) + _0x8074a9(0x1fb) + _0x8074a9(0x1ce),
            'qtQbI': function (_0x5af6d1, _0x35f4b8, _0x437e4e) {
                return _0x5af6d1(_0x35f4b8, _0x437e4e);
            },
            'TcnQA': _0x8074a9(0x1d4) + _0x8074a9(0x22f) + _0x8074a9(0x1dd) + _0x8074a9(0x1f4) + _0x8074a9(0x224)
        };
    try {
        openBtn[_0x8074a9(0x1e4)] = !![], _0x5f54ad[_0x8074a9(0x1d9)](setStatus, _0x5f54ad[_0x8074a9(0x214)], _0x5f54ad[_0x8074a9(0x1e9)]);
        const _0x538c05 = await _0x5f54ad[_0x8074a9(0x212)](resolveTargetTab);
        if (!_0x538c05 || !_0x538c05['id']) {
            _0x5f54ad[_0x8074a9(0x1f1)](setStatus, _0x5f54ad[_0x8074a9(0x1ea)], _0x5f54ad[_0x8074a9(0x210)]);
            return;
        }
        if (_0x5f54ad[_0x8074a9(0x21c)](isRestrictedUrl, _0x538c05[_0x8074a9(0x222)] || '')) {
            _0x5f54ad[_0x8074a9(0x1d9)](setStatus, _0x5f54ad[_0x8074a9(0x21f)], _0x5f54ad[_0x8074a9(0x210)]);
            return;
        }
        const _0x5cbf44 = await chrome[_0x8074a9(0x218)][_0x8074a9(0x1ee) + 'e']({
            'type': _0x5f54ad[_0x8074a9(0x215)],
            'tabId': _0x538c05['id']
        });
        if (_0x5cbf44 && _0x5cbf44['ok']) {
            _0x5f54ad[_0x8074a9(0x1e3)](setStatus, _0x5f54ad[_0x8074a9(0x1cb)], 'ok');
            shouldAutoClose && _0x5f54ad[_0x8074a9(0x1d9)](setTimeout, () => window[_0x8074a9(0x213)](), -0xb * -0x265 + 0xf5 * -0xa + -0xf35);
            return;
        }
        _0x5f54ad[_0x8074a9(0x20a)](setStatus, _0x5f54ad[_0x8074a9(0x207)], _0x5f54ad[_0x8074a9(0x210)]);
    } catch (_0x59091b) {
        _0x5f54ad[_0x8074a9(0x22c)](setStatus, _0x5f54ad[_0x8074a9(0x205)], _0x5f54ad[_0x8074a9(0x210)]);
    } finally {
        openBtn[_0x8074a9(0x1e4)] = ![];
    }
}
openBtn && openBtn[_0x129def(0x201) + _0x129def(0x1cd)](_0x129def(0x1ca), openPanel);
function _0x4582(_0xe8c68, _0x54fe4a) {
    _0xe8c68 = _0xe8c68 - (0x30 * -0x58 + 0x20 * -0xb2 + 0x1444 * 0x2);
    const _0x5a7800 = _0x4a33();
    let _0x4123f8 = _0x5a7800[_0xe8c68];
    return _0x4123f8;
}
openPanel();