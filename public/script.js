var subscription = null;
var repeat = 'once';
var selectedDays = [];

var $ = function (id) { return document.getElementById(id); };
var form = $('alarm-form');
var errorEl = $('error');

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

var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function repeatLabel(a) {
  if (a.repeat === 'daily') return '매일';
  if (a.repeat === 'weekdays') return '평일';
  if (a.repeat === 'custom') {
    return DAY_ORDER.filter(function (d) { return a.days.indexOf(d) !== -1; })
      .map(function (d) { return DAY_NAMES[d]; }).join('·');
  }
  return '';
}

// 알림 권한 카드: on(켜짐) / off(꺼짐, 버튼 보임) / info(안내만)
function setPerm(state, text) {
  $('perm-card').classList.toggle('on', state === 'on');
  $('perm-text').textContent = text;
  $('perm-btn').hidden = state !== 'off';
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function renderAlarms(alarms) {
  var list = $('list');
  list.innerHTML = '';
  alarms.forEach(function (a) {
    var li = document.createElement('li');
    var main = document.createElement('div');
    main.className = 'item-main';

    var when = document.createElement('div');
    when.className = 'item-when';
    when.textContent = formatWhen(a.fireAt);
    var label = repeatLabel(a);
    if (label) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '🔁 ' + label;
      when.appendChild(badge);
    }

    var msg = document.createElement('div');
    msg.className = 'item-msg';
    msg.textContent = a.message;

    main.appendChild(when);
    main.appendChild(msg);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '✕';
    del.addEventListener('click', function () {
      api('/api/alarms/delete', { endpoint: subscription.endpoint, id: a.id })
        .then(loadList)
        .catch(function (e) { errorEl.textContent = e.message; });
    });

    li.appendChild(main);
    li.appendChild(del);
    list.appendChild(li);
  });
  $('empty').hidden = alarms.length > 0;
  $('count').textContent = alarms.length ? alarms.length + '개' : '';
}

function renderHistory(history) {
  var ul = $('history');
  ul.innerHTML = '';
  history.forEach(function (h) {
    var li = document.createElement('li');
    var main = document.createElement('div');
    main.className = 'item-main';
    var when = document.createElement('div');
    when.className = 'item-when';
    when.textContent = formatWhen(h.firedAt);
    var msg = document.createElement('div');
    msg.className = 'item-msg';
    msg.textContent = h.message;
    main.appendChild(when);
    main.appendChild(msg);
    li.appendChild(main);
    ul.appendChild(li);
  });
  $('hist-empty').hidden = history.length > 0;
  $('hist-clear').hidden = history.length === 0;
  $('hist-count').textContent = history.length ? history.length + '개' : '';
}

function loadList() {
  if (!subscription) {
    renderAlarms([]);
    renderHistory([]);
    return Promise.resolve();
  }
  return api('/api/alarms/list', { endpoint: subscription.endpoint })
    .then(function (data) {
      renderAlarms(data.alarms);
      renderHistory(data.history);
    })
    .catch(function (e) { errorEl.textContent = e.message; });
}

function enableNotifications() {
  errorEl.textContent = '';
  return Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') {
      setPerm('off', '알림이 막혀 있어요. 핸드폰 설정에서 이 앱의 알림을 허용해 주세요.');
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
        setPerm('on', '알림이 켜져 있어요');
        return loadList();
      });
  }).catch(function (e) {
    errorEl.textContent = '알림을 켜지 못했어요: ' + e.message;
  });
}

// 반복 선택
$('repeat-seg').addEventListener('click', function (e) {
  var btn = e.target.closest('.seg-btn');
  if (!btn) return;
  repeat = btn.dataset.repeat;
  document.querySelectorAll('.seg-btn').forEach(function (b) {
    var on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  $('days-field').hidden = repeat !== 'custom';
});

// 요일 선택
$('days').addEventListener('click', function (e) {
  var btn = e.target.closest('.day');
  if (!btn) return;
  var d = Number(btn.dataset.day);
  var i = selectedDays.indexOf(d);
  if (i === -1) selectedDays.push(d); else selectedDays.splice(i, 1);
  btn.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
});

form.addEventListener('submit', function (e) {
  e.preventDefault();
  errorEl.textContent = '';
  if (!subscription) {
    errorEl.textContent = '먼저 위에서 "알림 켜기"를 눌러 주세요.';
    return;
  }
  var fireAt = new Date($('date').value + 'T' + $('time').value + ':00+09:00').getTime();
  if (!(fireAt > Date.now())) {
    errorEl.textContent = '지금보다 이후의 시간을 골라 주세요.';
    return;
  }
  if (repeat === 'custom' && selectedDays.length === 0) {
    errorEl.textContent = '반복할 요일을 하나 이상 골라 주세요.';
    return;
  }
  api('/api/alarms/add', {
    subscription: subscription,
    fireAt: fireAt,
    message: $('message').value.trim(),
    repeat: repeat,
    days: repeat === 'custom' ? selectedDays.slice() : []
  }).then(function () {
    $('message').value = '';
    return loadList();
  }).catch(function (err) {
    errorEl.textContent = err.message;
  });
});

$('hist-clear').addEventListener('click', function () {
  api('/api/history/clear', { endpoint: subscription.endpoint })
    .then(loadList)
    .catch(function (e) { errorEl.textContent = e.message; });
});

$('perm-btn').addEventListener('click', enableNotifications);

// 앱으로 돌아왔을 때 목록을 새로 불러옵니다 (닫혀 있는 동안 울린 알림 반영).
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') loadList();
});

function pad(n) { return (n < 10 ? '0' : '') + n; }

function init() {
  // 기본 날짜·시간: 내일 아침 8시
  var t = new Date();
  t.setDate(t.getDate() + 1);
  $('date').value = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  $('time').value = '08:00';

  renderAlarms([]);
  renderHistory([]);

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIos() && !isStandalone()) {
      setPerm('info', '아이폰은 사파리 아래쪽 공유 버튼(⬆️) → "홈 화면에 추가"로 설치한 뒤, 홈 화면의 아이콘으로 열어 주세요.');
    } else {
      setPerm('info', '이 브라우저는 알림을 지원하지 않아요. 크롬(안드로이드)이나 사파리(아이폰)를 써 주세요.');
    }
    return;
  }

  navigator.serviceWorker.register('sw.js')
    .then(function () { return navigator.serviceWorker.ready; })
    .then(function (reg) { return reg.pushManager.getSubscription(); })
    .then(function (sub) {
      if (sub && Notification.permission === 'granted') {
        subscription = sub.toJSON();
        setPerm('on', '알림이 켜져 있어요');
        return loadList();
      }
      if (Notification.permission === 'denied') {
        setPerm('off', '알림이 막혀 있어요. 핸드폰 설정에서 이 앱의 알림을 허용해 주세요.');
      } else {
        setPerm('off', '알림이 꺼져 있어요');
      }
    })
    .catch(function (e) {
      errorEl.textContent = '준비 중 문제가 생겼어요: ' + e.message;
    });
}

init();
