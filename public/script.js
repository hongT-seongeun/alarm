var subscription = null;

var form = document.getElementById('alarm-form');
var dateEl = document.getElementById('date');
var timeEl = document.getElementById('time');
var msgEl = document.getElementById('message');
var errorEl = document.getElementById('error');
var listEl = document.getElementById('list');
var emptyEl = document.getElementById('empty');
var permBtn = document.getElementById('perm-btn');
var permText = document.getElementById('perm-text');

function api(path, body) {
  return fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data.error || '문제가 생겼어요.');
      return data;
    });
  });
}

function urlBase64ToUint8Array(base64) {
  var padding = '='.repeat((4 - (base64.length % 4)) % 4);
  var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function formatWhen(ms) {
  return new Date(ms).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function showPermState(on, text) {
  permText.textContent = text;
  permBtn.hidden = on;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function render(alarms) {
  listEl.innerHTML = '';
  alarms.forEach(function (a) {
    var li = document.createElement('li');
    var info = document.createElement('div');
    var when = document.createElement('div');
    when.className = 'item-when';
    when.textContent = formatWhen(a.fireAt);
    var msg = document.createElement('div');
    msg.className = 'item-msg';
    msg.textContent = a.message;
    info.appendChild(when);
    info.appendChild(msg);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '삭제';
    del.addEventListener('click', function () {
      api('/api/alarms/delete', { endpoint: subscription.endpoint, id: a.id })
        .then(loadList)
        .catch(function (e) { errorEl.textContent = e.message; });
    });

    li.appendChild(info);
    li.appendChild(del);
    listEl.appendChild(li);
  });
  emptyEl.style.display = alarms.length ? 'none' : 'block';
}

function loadList() {
  if (!subscription) {
    render([]);
    return Promise.resolve();
  }
  return api('/api/alarms/list', { endpoint: subscription.endpoint })
    .then(function (data) { render(data.alarms); })
    .catch(function (e) { errorEl.textContent = e.message; });
}

function enableNotifications() {
  errorEl.textContent = '';
  return Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') {
      showPermState(false, '알림이 막혀 있어요. 핸드폰 설정에서 이 앱의 알림을 허용해 주세요.');
      return;
    }
    return navigator.serviceWorker.ready
      .then(function (reg) {
        return api('/api/config').then(function (cfg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(cfg.publicKey)
          });
        });
      })
      .then(function (sub) {
        subscription = sub.toJSON();
        showPermState(true, '알림이 켜져 있어요. ✅');
        return loadList();
      });
  }).catch(function (e) {
    errorEl.textContent = '알림을 켜지 못했어요: ' + e.message;
  });
}

form.addEventListener('submit', function (e) {
  e.preventDefault();
  errorEl.textContent = '';
  if (!subscription) {
    errorEl.textContent = '먼저 위에서 "알림 켜기"를 눌러 주세요.';
    return;
  }
  var fireAt = new Date(dateEl.value + 'T' + timeEl.value + ':00+09:00').getTime();
  if (!(fireAt > Date.now())) {
    errorEl.textContent = '지금보다 이후의 시간을 골라 주세요.';
    return;
  }
  api('/api/alarms/add', {
    subscription: subscription,
    fireAt: fireAt,
    message: msgEl.value.trim()
  }).then(function () {
    msgEl.value = '';
    return loadList();
  }).catch(function (err) {
    errorEl.textContent = err.message;
  });
});

permBtn.addEventListener('click', enableNotifications);

function init() {
  render([]);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIos() && !isStandalone()) {
      showPermState(true, '아이폰은 사파리 아래쪽 공유 버튼(⬆️) → "홈 화면에 추가"로 설치한 뒤, 홈 화면의 아이콘으로 열어 주세요.');
    } else {
      showPermState(true, '이 브라우저는 알림을 지원하지 않아요. 크롬(안드로이드)이나 사파리(아이폰)를 써 주세요.');
    }
    return;
  }

  navigator.serviceWorker.register('sw.js')
    .then(function () { return navigator.serviceWorker.ready; })
    .then(function (reg) { return reg.pushManager.getSubscription(); })
    .then(function (sub) {
      if (sub && Notification.permission === 'granted') {
        subscription = sub.toJSON();
        showPermState(true, '알림이 켜져 있어요. ✅');
        return loadList();
      }
      if (Notification.permission === 'denied') {
        showPermState(false, '알림이 막혀 있어요. 핸드폰 설정에서 이 앱의 알림을 허용해 주세요.');
      }
    })
    .catch(function (e) {
      errorEl.textContent = '준비 중 문제가 생겼어요: ' + e.message;
    });
}

init();
