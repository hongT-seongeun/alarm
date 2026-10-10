self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// 서버가 푸시를 보내면 화면이 꺼져 있어도 이 코드가 실행되어 팝업을 띄웁니다.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data.json();
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ 알림', {
      body: data.body || '',
      icon: '/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
