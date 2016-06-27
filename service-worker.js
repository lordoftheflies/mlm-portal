/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
console.info('Service worker disabled for development, will be generated at build time.');
console.info('But, now I\'m implementing push notifications.');


console.log('Service worker for notifications started.', self);
self.addEventListener('install', function (event) {
    self.skipWaiting();
    console.log('Notification service-worker installed', event);
});
self.addEventListener('activate', function (event) {
    console.log('Notification service-worker  activated', event);
});
self.addEventListener('push', function (event) {
    console.log('Notification service-worker received a push message.', event);
    var title = 'Push message';
    var payload = event.data ? event.data.text() : 'no payload';
    event.waitUntil(self.registration.showNotification(title, {
        body: payload,
        icon: 'images/favicon-64x64.png',
        tag: 'topflavon-notification'
    }));
});
self.addEventListener('notificationclick', function (event) {
    console.log('Notification click: tag ', event.notification.tag);
    event.notification.close();
    var url = '/content-view/ROOT';
    event.waitUntil(clients.matchAll({
        type: 'window'
    })
            .then(function (windowClients) {
                for (var i = 0; i < windowClients.length; i++) {
                    var client = windowClients[i];
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
            .catch(function (error) {
                console.log('Notification click failed: ', error);
            }));
});

