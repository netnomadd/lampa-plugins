(function () {
    'use strict';

    if (window.post2mpv_plugin) return;
    window.post2mpv_plugin = true;

    var PREFIX = 'post2mpv_';
    var DEFAULT_ADDRESS = '127.0.0.1:7531';
    var DEFAULT_HOTKEY = 'P';
    var lastHotkeyAt = 0;
    var pendingSend = false;
    var pendingTimer = null;

    function storageGet(name, def) {
        return Lampa.Storage.get(PREFIX + name, def);
    }

    function storageSet(name, value) {
        Lampa.Storage.set(PREFIX + name, value);
    }

    function isEnabled() {
        return storageGet('enabled', true) !== false;
    }

    function mode() {
        return String(storageGet('mode', 'hotkey') || 'hotkey');
    }

    function migrate() {
        if (!storageGet('address', '') && storageGet('host', '')) {
            storageSet('address', String(storageGet('host', '127.0.0.1')) + ':' + String(storageGet('port', '7531')));
        }

        if (window.localStorage.getItem(PREFIX + 'skip_inner') == null && window.localStorage.getItem(PREFIX + 'only') != null) {
            storageSet('skip_inner', storageGet('only', true));
        }
    }

    function buildUrl() {
        var address = String(storageGet('address', DEFAULT_ADDRESS) || DEFAULT_ADDRESS).trim();

        if (!address) address = DEFAULT_ADDRESS;
        if (!/^https?:\/\//i.test(address)) address = 'http://' + address;
        if (address.charAt(address.length - 1) !== '/') address += '/';

        return address;
    }

    function parseParams(str) {
        str = String(str || '').trim();
        if (!str) return [];

        if (str.charAt(0) === '[') {
            try {
                var arr = JSON.parse(str);
                if (Array.isArray(arr)) return arr.map(String);
            } catch (e) {}
        }

        return str.split(/\s+/).filter(Boolean);
    }

    function headerValue(headers, names) {
        if (!headers) return '';

        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (headers[name]) return headers[name];

            for (var key in headers) {
                if (headers.hasOwnProperty(key) && key.toLowerCase() === name.toLowerCase()) {
                    return headers[key];
                }
            }
        }

        return '';
    }

    function collectParams(object) {
        var params = parseParams(storageGet('params', ''));
        var title = object && (object.title || object.name);

        if (title) params.push('--force-media-title=' + String(title));

        var headers = object && object.headers;
        if (headers && typeof headers === 'object') {
            var referrer = headerValue(headers, ['Referer', 'Referrer']);
            if (referrer) params.push('--referrer=' + referrer);

            for (var key in headers) {
                if (!headers.hasOwnProperty(key) || !headers[key]) continue;
                if (key.toLowerCase() === 'referer' || key.toLowerCase() === 'referrer') continue;
                params.push('--http-header-fields=' + key + ': ' + headers[key]);
            }
        }

        if (storageGet('timecode', true) && object && object.timeline && object.timeline.time > 0) {
            params.push('--start=' + Math.floor(object.timeline.time));
        }

        return params;
    }

    function extractUrl(object) {
        if (!object) return '';

        var url =
            object.url ||
            object.src ||
            (object.stream && object.stream.link) ||
            (object.video && object.video.link) ||
            '';

        if (url && Lampa.Torserver && typeof Lampa.Torserver.toPlayUrl === 'function') {
            url = Lampa.Torserver.toPlayUrl(url);
        }

        return url;
    }

    function isWaitingPlay() {
        try {
            var name = Lampa.Controller && Lampa.Controller.enabled && Lampa.Controller.enabled().name;
            if (name === 'loading') return true;
        } catch (e) {}

        return Boolean(document.querySelector('.media-loading--standalone, .loading-layer'));
    }

    function clearPendingSend() {
        pendingSend = false;
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
    }

    function consumePendingSend() {
        if (!pendingSend) return false;
        clearPendingSend();
        return true;
    }

    function schedulePendingExpire() {
        if (pendingTimer) clearTimeout(pendingTimer);

        pendingTimer = setTimeout(function () {
            pendingTimer = null;
            if (!pendingSend) return;
            if (isWaitingPlay()) {
                schedulePendingExpire();
                return;
            }
            pendingSend = false;
        }, 3000);
    }

    function armPendingSend() {
        pendingSend = true;
        schedulePendingExpire();
    }

    function sendToPost2Mpv(object) {
        var url = extractUrl(object);

        if (!url) {
            Lampa.Noty.show('post2mpv: не удалось получить URL');
            return;
        }

        var action = String(storageGet('action', 'play') || 'play');
        var body = {
            url: url,
            action: action,
            params: collectParams(object),
            args: [],
            output: ''
        };

        if (storageGet('log', false) === true) body.log = true;

        var headers = {
            'Content-Type': 'application/json'
        };

        var token = String(storageGet('token', '') || '').trim();
        if (token) headers['X-POST2MPV-TOKEN'] = token;

        fetch(buildUrl(), {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json().catch(function () {
                    return {};
                });
            })
            .then(function (data) {
                if (data && data.job_id) {
                    Lampa.Noty.show('post2mpv: отправлено (job_id=' + data.job_id + ')');
                } else {
                    Lampa.Noty.show('post2mpv: отправлено');
                }
            })
            .catch(function (e) {
                console.log('post2mpv error', e);
                Lampa.Noty.show('post2mpv: ошибка запроса (' + (e && e.message ? e.message : e) + ')');
            });
    }

    function activateFocused() {
        var focused =
            document.querySelector('.selector.focus') ||
            document.querySelector('.selector.hover');

        if (focused && window.$) {
            $(focused).trigger('hover:enter');
            return;
        }

        if (Lampa.Controller && typeof Lampa.Controller.enter === 'function') {
            Lampa.Controller.enter();
        }
    }

    function isTyping(e) {
        var ev = e && e.event;
        if (!ev) return false;

        var target = ev.target;
        if (!target) return false;

        var tag = (target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    }

    function hotkeyCode() {
        var key = String(storageGet('hotkey', DEFAULT_HOTKEY) || DEFAULT_HOTKEY).toUpperCase();
        if (!key || key.length !== 1) key = DEFAULT_HOTKEY;
        return key.charCodeAt(0);
    }

    function onKeydown(e) {
        if (!isEnabled() || mode() !== 'hotkey') return;
        if (e.enabled === false || isTyping(e)) return;
        if (e.code !== hotkeyCode()) return;

        var now = Date.now();
        if (now - lastHotkeyAt < 400) return;
        lastHotkeyAt = now;

        if (e.event && typeof e.event.preventDefault === 'function') e.event.preventDefault();

        armPendingSend();
        activateFocused();
    }

    function interceptPlay(object) {
        if (!isEnabled()) return false;

        if (mode() === 'hotkey' && consumePendingSend()) {
            sendToPost2Mpv(object);
            return true;
        }

        if (mode() === 'play') {
            sendToPost2Mpv(object);
            return storageGet('skip_inner', true) !== false;
        }

        return false;
    }

    function hookPlayer() {
        if (!Lampa.Player || typeof Lampa.Player.play !== 'function') return;

        var originalPlay = Lampa.Player.play.bind(Lampa.Player);

        Lampa.Player.play = function (object) {
            if (interceptPlay(object)) return;
            return originalPlay(object);
        };

        if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
            Lampa.Listener.follow('torrent_file', function (e) {
                if (e && e.type === 'list_open') clearPendingSend();
            });
        }
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'post2mpv',
            name: 'post2mpv',
            icon: '<svg height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M8 5.14v14l11-7-11-7z"/><path fill="#fff" d="M3 3h2v18H3z"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'enabled',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Включено',
                description: 'Если выключено, плагин не перехватывает воспроизведение и не реагирует на горячую клавишу. Enter снова открывает обычный (в том числе внешний) плеер'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'mode',
                type: 'select',
                values: {
                    hotkey: 'По горячей клавише',
                    play: 'При запуске плеера'
                },
                default: 'hotkey'
            },
            field: {
                name: 'Режим отправки',
                description: 'Горячая клавиша: Enter/клик — обычный плеер, P на выбранной ссылке — только post2mpv. «При запуске» отправляет каждую выбранную ссылку'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'hotkey',
                type: 'select',
                values: {
                    P: 'P',
                    O: 'O',
                    H: 'H',
                    X: 'X',
                    Z: 'Z',
                    Q: 'Q'
                },
                default: DEFAULT_HOTKEY
            },
            field: {
                name: 'Горячая клавиша',
                description: 'Наведите на файл/озвучку и нажмите клавишу: ссылка уйдёт в post2mpv, внешний плеер не откроется. Не занимает F/S/M из lampa-desktop'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'skip_inner',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Не открывать встроенный плеер',
                description: 'Только для режима «При запуске плеера»: не открывать ни встроенный, ни внешний плеер Lampa'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'address',
                type: 'input',
                values: '',
                placeholder: DEFAULT_ADDRESS,
                default: DEFAULT_ADDRESS
            },
            field: {
                name: 'Адрес сервера',
                description: 'host:port, например 127.0.0.1:7531'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'token',
                type: 'input',
                values: '',
                placeholder: '',
                default: ''
            },
            field: {
                name: 'Токен доступа',
                description: 'Заголовок X-POST2MPV-TOKEN, если на сервере задан токен'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'params',
                type: 'input',
                values: '',
                placeholder: '--fullscreen --volume=70',
                default: ''
            },
            field: {
                name: 'Параметры mpv',
                description: 'Дополнительные аргументы через пробел, например --fullscreen --profile=gpu-hq'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'action',
                type: 'select',
                values: {
                    play: 'play (mpv)',
                    download: 'download (yt-dlp)',
                    translate: 'translate (vot2mpv)'
                },
                default: 'play'
            },
            field: {
                name: 'Действие',
                description: 'Что сделать с ссылкой на стороне post2mpv'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'timecode',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Передавать таймкод',
                description: 'Добавлять --start= из прогресса просмотра Lampa'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'post2mpv',
            param: {
                name: PREFIX + 'log',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Лог mpv',
                description: 'Поле log=true в запросе: вывод процесса в journal post2mpv'
            }
        });
    }

    function init() {
        migrate();
        addSettings();
        hookPlayer();

        if (Lampa.Keypad && Lampa.Keypad.listener) {
            Lampa.Keypad.listener.follow('keydown', onKeydown);
        }
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
