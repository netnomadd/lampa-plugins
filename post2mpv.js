(function () {
       'use strict';

       var KEY_PREFIX = 'post2mpv_';

       function read(name, def) {
           return Lampa.Storage.get(KEY_PREFIX + name, def);
       }

       function write(name, value) {
           Lampa.Storage.set(KEY_PREFIX + name, value);
       }

       var config = {
           host: read('host', '127.0.0.1'),
           port: read('port', '7531'),
           token: read('token', ''),
           only: read('only', true) // true = только post2mpv, false = post2mpv + встроенный плеер
       };

       function buildUrl() {
           return 'http://' + config.host + ':' + config.port + '/';
       }

       function sendToPost2Mpv(object) {
           var url =
               object.url ||
               object.src ||
               (object.stream && object.stream.link) ||
               (object.video && object.video.link) ||
               '';

           if (!url) {
               Lampa.Noty.show('post2mpv: не удалось получить URL');
               return;
           }

           var body = {
               url: url,
               action: 'play',
               params: [],
               args: [],
               output: ''
           };

           var headers = {
               'Content-Type': 'application/json'
           };

           if (config.token) {
               headers['X-POST2MPV-TOKEN'] = config.token;
           }

           fetch(buildUrl(), {
               method: 'POST',
               headers: headers,
               body: JSON.stringify(body)
           })
               .then(function (res) {
                   if (!res.ok) throw new Error('HTTP ' + res.status);
                   return res
                       .json()
                       .catch(function () {
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
                   Lampa.Noty.show('post2mpv: ошибка запроса (' + e.message + ')');
               });
       }

       function showSettings() {
           var items = [];

           items.push({
               title: 'Адрес сервера',
               subtitle: config.host + ':' + config.port,
               onSelect: function () {
                   Lampa.Input.edit(
                       {
                           title: 'Адрес сервера (host:port)',
                           value: config.host + ':' + config.port,
                           free: true
                       },
                       function (value) {
                           var v = String(value || '').trim();
                           if (!v) return;

                           var parts = v.split(':');
                           config.host = (parts[0] || '127.0.0.1').trim();
                           config.port = (parts[1] || '7531').trim();

                           write('host', config.host);
                           write('port', config.port);

                           showSettings();
                       }
                   );
               }
           });

           items.push({
               title: 'Токен доступа',
               subtitle: config.token ? 'Установлен' : 'Не задан',
               onSelect: function () {
                   Lampa.Input.edit(
                       {
                           title: 'X-POST2MPV-TOKEN',
                           value: config.token,
                           free: true
                       },
                       function (value) {
                           config.token = String(value || '').trim();
                           write('token', config.token);
                           showSettings();
                       }
                   );
               }
           });

           items.push({
               title: 'Режим работы',
               subtitle: config.only
                   ? 'Только post2mpv (без встроенного плеера)'
                   : 'post2mpv + встроенный плеер',
               onSelect: function () {
                   Lampa.Select.show({
                       title: 'Режим работы',
                       items: [
                           { title: 'Только post2mpv (mpv)', id: true },
                           { title: 'post2mpv + встроенный плеер', id: false }
                       ],
                       onSelect: function (choice) {
                           config.only = !!choice.id;
                           write('only', config.only);
                           showSettings();
                       },
                       onBack: function () {
                           showSettings();
                       }
                   });
               }
           });

           Lampa.Select.show({
               title: 'post2mpv',
               items: items,
               onBack: function () {
                   Lampa.Controller.toggle('settings_component');
               }
           });
       }

       // хук в настройки (как в tmdb_proxy.js)
       if (Lampa.Settings && Lampa.Settings.listener) {
           Lampa.Settings.listener.follow('open', function (e) {
               if (e.name === 'post2mpv') {
                   showSettings();
               }
           });
       }

       if (Lampa.SettingsApi && Lampa.SettingsApi.addParam) {
           // пункт в Настройки → Плеер (по аналогии с tmdb_proxy)
           Lampa.SettingsApi.addParam({
               component: 'player',
               param: {
                   name: 'post2mpv',
                   type: 'select',
                   values: {
                       off: 'Отключено',
                       on: 'Настройки post2mpv'
                   },
                   default: 'off'
               },
               field: 'post2mpv',
               onChange: function (value) {
                   if (value === 'on') showSettings();
               }
           });
       }

       // перехват Lampa.Player.play
       var originalPlay =
           Lampa.Player && typeof Lampa.Player.play === 'function'
               ? Lampa.Player.play.bind(Lampa.Player)
               : null;

       Lampa.Player.play = function (object) {
           try {
               sendToPost2Mpv(object);
           } catch (e) {
               console.log('post2mpv send error', e);
           }

           if (config.only || !originalPlay) {
               return;
           }

           return originalPlay(object);
       };
   })();
