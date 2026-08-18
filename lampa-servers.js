(function () {
    'use strict';

    if (window.lampa_servers_plugin) return;
    window.lampa_servers_plugin = true;

    var STORAGE_KEY = 'lampa_servers_list';
    var ELECTRON_KEY = 'lampaServers';
    var ICON =
        '<svg height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path fill="#fff" d="M4 5h16a1 1 0 0 1 1 1v4H3V6a1 1 0 0 1 1-1zm-1 7h18v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6zm3 2.5a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H6zm0-7a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H6z"/>' +
        '</svg>';

    var servers = [];

    function hasElectronStore() {
        return Boolean(window.electronAPI && window.electronAPI.store && window.electronAPI.store.get && window.electronAPI.store.set);
    }

    function currentUrl() {
        try {
            return window.location.origin + (window.location.pathname === '/' ? '' : window.location.pathname.replace(/\/+$/, ''));
        } catch (e) {
            return String(window.location.href || '').replace(/\/+$/, '');
        }
    }

    function normalizeUrl(raw) {
        var value = String(raw || '').trim();
        if (!value) return '';
        if (!/^https?:\/\//i.test(value)) value = 'http://' + value;

        try {
            var parsed = new URL(value);
            var path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
            return parsed.origin + path;
        } catch (e) {
            return value.replace(/\/+$/, '');
        }
    }

    function sameUrl(a, b) {
        return normalizeUrl(a) === normalizeUrl(b);
    }

    function hostTitle(url) {
        try {
            return new URL(normalizeUrl(url)).host;
        } catch (e) {
            return normalizeUrl(url);
        }
    }

    function readLocal() {
        var list = Lampa.Storage.get(STORAGE_KEY, '[]');
        return Array.isArray(list) ? list : [];
    }

    function writeLocal(list) {
        Lampa.Storage.set(STORAGE_KEY, list);
    }

    function sanitizeList(list) {
        var seen = {};
        var result = [];

        (list || []).forEach(function (item) {
            var url = normalizeUrl(item && (item.url || item));
            if (!url || seen[url]) return;

            seen[url] = true;
            result.push({
                title: String((item && item.title) || hostTitle(url)).trim() || hostTitle(url),
                url: url
            });
        });

        return result;
    }

    function ensureCurrent(list) {
        var url = normalizeUrl(currentUrl());
        if (!url) return list;

        var exists = list.some(function (item) {
            return sameUrl(item.url, url);
        });

        if (!exists) {
            list.unshift({
                title: hostTitle(url),
                url: url
            });
        }

        return list;
    }

    function saveServers(done) {
        servers = sanitizeList(servers);
        writeLocal(servers);

        if (!hasElectronStore()) {
            if (done) done();
            return;
        }

        window.electronAPI.store.set(ELECTRON_KEY, servers).then(function () {
            if (done) done();
        }).catch(function () {
            if (done) done();
        });
    }

    function loadServers(done) {
        var local = sanitizeList(readLocal());

        if (!hasElectronStore()) {
            servers = ensureCurrent(local);
            writeLocal(servers);
            if (done) done();
            return;
        }

        window.electronAPI.store.get(ELECTRON_KEY).then(function (remote) {
            var fromElectron = sanitizeList(remote);
            servers = ensureCurrent(fromElectron.length ? fromElectron : local);
            saveServers(done);
        }).catch(function () {
            servers = ensureCurrent(local);
            writeLocal(servers);
            if (done) done();
        });
    }

    function applyUrl(url) {
        url = normalizeUrl(url);
        if (!url) {
            Lampa.Noty.show('Укажите адрес сервера');
            return;
        }

        if (sameUrl(url, currentUrl())) {
            Lampa.Noty.show('Этот сервер уже выбран');
            return;
        }

        Lampa.Noty.show('Переключение на ' + hostTitle(url));

        if (hasElectronStore()) {
            window.electronAPI.store.set('lampaUrl', url).catch(function (e) {
                console.log('lampa-servers store error', e);
                Lampa.Noty.show('Не удалось сменить URL в lampa-desktop');
            });
            return;
        }

        window.location.href = url;
    }

    function selectItems(includeActions) {
        var current = currentUrl();
        var items = servers.map(function (server) {
            return {
                title: server.title,
                subtitle: server.url,
                url: server.url,
                selected: sameUrl(server.url, current)
            };
        });

        if (!includeActions) return items;

        items.push({
            title: 'Добавить сервер',
            add: true
        });

        if (servers.length) {
            items.push({
                title: 'Удалить сервер',
                remove: true
            });
        }

        return items;
    }

    function promptAdd(onBack) {
        Lampa.Input.edit(
            {
                title: 'Адрес сервера',
                value: currentUrl(),
                free: true,
                noskip: true
            },
            function (value) {
                var url = normalizeUrl(value);
                if (!url) {
                    if (onBack) onBack();
                    return;
                }

                Lampa.Input.edit(
                    {
                        title: 'Название',
                        value: hostTitle(url),
                        free: true,
                        noskip: true
                    },
                    function (title) {
                        servers = servers.filter(function (item) {
                            return !sameUrl(item.url, url);
                        });
                        servers.push({
                            title: String(title || hostTitle(url)).trim() || hostTitle(url),
                            url: url
                        });
                        saveServers(function () {
                            Lampa.Noty.show('Сервер сохранён');
                            if (onBack) onBack();
                        });
                    }
                );
            }
        );
    }

    function promptRemove(onBack) {
        if (!servers.length) {
            Lampa.Noty.show('Список серверов пуст');
            if (onBack) onBack();
            return;
        }

        Lampa.Select.show({
            title: 'Удалить сервер',
            items: selectItems(false),
            onSelect: function (item) {
                servers = servers.filter(function (server) {
                    return !sameUrl(server.url, item.url);
                });
                saveServers(function () {
                    Lampa.Noty.show('Сервер удалён');
                    if (onBack) onBack();
                });
            },
            onBack: onBack
        });
    }

    function showSelect(onBack) {
        if (!servers.length) {
            promptAdd(onBack);
            return;
        }

        Lampa.Select.show({
            title: 'Сервер Lampa',
            items: selectItems(true),
            onSelect: function (item) {
                if (item.add) {
                    promptAdd(function () {
                        showSelect(onBack);
                    });
                    return;
                }

                if (item.remove) {
                    promptRemove(function () {
                        showSelect(onBack);
                    });
                    return;
                }

                applyUrl(item.url);
            },
            onBack: onBack
        });
    }

    function addHeaderButton() {
        $('#LAMPA_SERVERS').remove();

        var button = $(
            '<div id="LAMPA_SERVERS" class="head__action selector lampa-servers-switch">' + ICON + '</div>'
        );

        button.on('hover:enter hover:click hover:touch', function () {
            var enabled = Lampa.Controller.enabled().name;
            showSelect(function () {
                Lampa.Controller.toggle(enabled);
            });
        });

        var actions = $('#app > div.head > div > div.head__actions');
        var settings = $('div.head__action.selector.open--settings');

        if (settings.length) button.insertAfter(settings);
        else actions.append(button);
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'lampa_servers',
            name: 'Серверы Lampa',
            icon: ICON
        });

        Lampa.SettingsApi.addParam({
            component: 'lampa_servers',
            param: {
                name: 'lampa_servers_current',
                type: 'static'
            },
            field: {
                name: 'Текущий адрес',
                description: currentUrl()
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'lampa_servers',
            param: {
                name: 'lampa_servers_select',
                type: 'button'
            },
            field: {
                name: 'Выбрать сервер',
                description: 'Список сохранённых адресов. После выбора lampa-desktop перезагрузит страницу'
            },
            onChange: function () {
                showSelect(function () {
                    Lampa.Controller.toggle('settings_component');
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'lampa_servers',
            param: {
                name: 'lampa_servers_add',
                type: 'button'
            },
            field: {
                name: 'Добавить сервер',
                description: 'Например http://192.168.1.10:9118 и http://host.tail.ts.net:9118'
            },
            onChange: function () {
                promptAdd(function () {
                    Lampa.Controller.toggle('settings_component');
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'lampa_servers',
            param: {
                name: 'lampa_servers_remove',
                type: 'button'
            },
            field: {
                name: 'Удалить сервер',
                description: 'Убрать адрес из списка'
            },
            onChange: function () {
                promptRemove(function () {
                    Lampa.Controller.toggle('settings_component');
                });
            }
        });
    }

    function init() {
        loadServers(function () {
            addSettings();
            addHeaderButton();
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
