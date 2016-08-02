/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
var hostName = 'http://localhost:8084/topflavon-backend';
//var hostName = 'https://localhost:8443/topflavon-backend';
//var hostName = 'http://185.51.67.30:8080/topflavon-backend';
//var hostName = 'https://185.51.67.30:8443/topflavon-backend';
console.info('Start notification service-worker ...', hostName);

console.log('Service worker for notifications started.', self);
self.addEventListener('install', function (event) {
    self.skipWaiting();
    console.log('Notification service-worker installed', event);
});
self.addEventListener('activate', function (event) {
    console.log('Notification service-worker  activated', event);
});
self.addEventListener('push', function (event, a, b, c) {
    console.log('Notification service-worker received a push message.', event);
    var title = 'Push message';
//    var payload = event.data ? event.data.text() : 'no payload';
//                    value: "http://185.51.67.30:8080/topflavon-backend"
//                    value: "http://localhost:8084/topflavon-backend"
//    var accountId = document.querySelector('my-app#app').session.token;
//    event.waitUntil(
    self.registration.pushManager.getSubscription()
            .then(function (sub) {
                var endpointUrl = sub.endpoint.split('/');
                var subscriptionId = endpointUrl[endpointUrl.length - 1];
                var notificationBackendUrl = hostName + '/mailbox/notifications?subscriptionId=' + encodeURIComponent(subscriptionId);
                console.log('Fetch notifications from ' + notificationBackendUrl);
                fetch(notificationBackendUrl)
                        .then(function (response) {
//            if (response.status < 400) {
//            console.log('got ', response);
//                cache.put(url, response.clone());
//            }
                            return response.json();
                        })
                        .then(function (payload) {
                            payload.forEach(function (currentValue, index, arr) {
                                console.log('Notify user', payload);
                                self.registration.showNotification(currentValue.fromName + ": " + currentValue.subject, {
                                    body: currentValue.message,
                                    icon: '/images/favicon-64x64.png',
                                    tag: 'topflavon-notification-' + currentValue.id
                                });
                            }, self);
                        })
                        .catch(function (e) {
                            console.log("Error fetching notifications", e.stack);
                        });

            })
            .catch(function (e) {
                console.log("Error subscription id", e.stack);
            });
//            );

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

