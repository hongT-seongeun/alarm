import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_PER_DEVICE = 50;
const MAX_HISTORY = 20;
const MAX_MESSAGE = 60;
const BATCH = 40; // 한 번에 보낼 최대 알림 수 (무료 플랜 요청 제한 때문)
const GIVE_UP_MS = 60 * 60 * 1000; // 1시간 넘게 못 보낸 알림은 포기
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;
const REPEATS = ['once', 'daily', 'weekdays', 'custom'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function validSubscription(s) {
  return (
    s &&
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    s.keys &&
    typeof s.keys.p256dh === 'string' &&
    typeof s.keys.auth === 'string'
  );
}

// ---- 반복 계산 (한국시간 기준, 한국은 서머타임이 없어서 하루 = 24시간) ----

function allowedDays(repeat, days) {
  if (repeat === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (repeat === 'weekdays') return [1, 2, 3, 4, 5];
  if (repeat === 'custom') return days;
  return [];
}

function dayOfWeekKst(ms) {
  return new Date(ms + KST_MS).getUTCDay(); // 0=일 ... 6=토
}

// fireAt과 같은 시각(시:분)에서, now보다 뒤이면서 허용된 요일인 가장 가까운 시각
export function nextFireAt(fireAt, repeat, days, now) {
  const allowed = allowedDays(repeat, days);
  if (!allowed.length) return null;
  let t = fireAt;
  if (t <= now) t += Math.ceil((now - t) / DAY_MS) * DAY_MS;
  while (t <= now) t += DAY_MS;
  for (let i = 0; i < 7 && !allowed.includes(dayOfWeekKst(t)); i++) t += DAY_MS;
  return t;
}

function parseDays(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

// ---- API ----

async function handleApi(request, env, url) {
  if (url.pathname === '/api/config' && request.method === 'GET') {
    return json({ publicKey: env.VAPID_PUBLIC_KEY });
  }
  if (request.method !== 'POST') return json({ error: '잘못된 요청이에요.' }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '잘못된 요청이에요.' }, 400);
  }

  if (url.pathname === '/api/alarms/list') {
    if (typeof body.endpoint !== 'string') return json({ error: '잘못된 요청이에요.' }, 400);
    const alarms = await env.DB
      .prepare('SELECT id, fire_at AS fireAt, message, repeat_type AS repeat, days FROM alarms WHERE endpoint = ? ORDER BY fire_at')
      .bind(body.endpoint)
      .all();
    const history = await env.DB
      .prepare('SELECT id, fired_at AS firedAt, message FROM history WHERE endpoint = ? ORDER BY id DESC LIMIT ?')
      .bind(body.endpoint, MAX_HISTORY)
      .all();
    return json({
      alarms: alarms.results.map((a) => ({ ...a, days: parseDays(a.days) })),
      history: history.results,
    });
  }

  if (url.pathname === '/api/alarms/add') {
    const { subscription, fireAt } = body;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const repeat = body.repeat === undefined ? 'once' : body.repeat;
    if (!validSubscription(subscription)) return json({ error: '알림이 켜져 있지 않아요.' }, 400);
    if (!message || message.length > MAX_MESSAGE) {
      return json({ error: `문구는 1~${MAX_MESSAGE}자로 적어 주세요.` }, 400);
    }
    if (!REPEATS.includes(repeat)) return json({ error: '반복 방식이 올바르지 않아요.' }, 400);

    let days = [];
    if (repeat === 'custom') {
      const raw = Array.isArray(body.days) ? body.days : [];
      days = [...new Set(raw)];
      if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return json({ error: '반복할 요일을 하나 이상 골라 주세요.' }, 400);
      }
    }

    const now = Date.now();
    if (!Number.isFinite(fireAt) || fireAt <= now) {
      return json({ error: '지금보다 이후의 시간을 골라 주세요.' }, 400);
    }
    if (fireAt > now + 366 * DAY_MS) {
      return json({ error: '1년 안의 날짜만 고를 수 있어요.' }, 400);
    }
    // 반복 알림은 시작일이 허용된 요일이 아니면 가장 가까운 허용 요일로 옮긴다.
    const first = repeat === 'once' ? Math.floor(fireAt) : nextFireAt(Math.floor(fireAt), repeat, days, Math.floor(fireAt) - 1);

    const count = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM alarms WHERE endpoint = ?')
      .bind(subscription.endpoint)
      .first();
    if (count.n >= MAX_PER_DEVICE) {
      return json({ error: `알림은 ${MAX_PER_DEVICE}개까지만 등록할 수 있어요.` }, 400);
    }
    await env.DB
      .prepare('INSERT INTO alarms (endpoint, sub, fire_at, message, repeat_type, days) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(
        subscription.endpoint,
        JSON.stringify({
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        }),
        first,
        message,
        repeat,
        JSON.stringify(days)
      )
      .run();
    return json({ ok: true });
  }

  if (url.pathname === '/api/alarms/delete') {
    if (typeof body.endpoint !== 'string' || !Number.isInteger(body.id)) {
      return json({ error: '잘못된 요청이에요.' }, 400);
    }
    await env.DB
      .prepare('DELETE FROM alarms WHERE id = ? AND endpoint = ?')
      .bind(body.id, body.endpoint)
      .run();
    return json({ ok: true });
  }

  if (url.pathname === '/api/history/clear') {
    if (typeof body.endpoint !== 'string') return json({ error: '잘못된 요청이에요.' }, 400);
    await env.DB.prepare('DELETE FROM history WHERE endpoint = ?').bind(body.endpoint).run();
    return json({ ok: true });
  }

  return json({ error: '없는 주소예요.' }, 404);
}

// ---- 1분마다 실행: 시각이 된 알림 보내기 ----

async function sendDue(env) {
  const now = Date.now();
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const db = env.DB;

  const { results } = await db
    .prepare(
      'SELECT id, endpoint, sub, message, fire_at AS fireAt, repeat_type AS repeat, days FROM alarms WHERE fire_at <= ? ORDER BY fire_at LIMIT ?'
    )
    .bind(now, BATCH)
    .all();

  const statements = [];

  // 한 번만 알림은 지우고, 반복 알림은 다음 시각으로 옮긴다.
  const finish = (row) => {
    const next = row.repeat === 'once' ? null : nextFireAt(row.fireAt, row.repeat, parseDays(row.days), now);
    if (next === null) {
      statements.push(db.prepare('DELETE FROM alarms WHERE id = ?').bind(row.id));
    } else {
      statements.push(db.prepare('UPDATE alarms SET fire_at = ? WHERE id = ?').bind(next, row.id));
    }
  };

  for (const row of results) {
    try {
      const subscription = JSON.parse(row.sub);
      const payload = await buildPushPayload(
        {
          data: { title: '⏰ 알림', body: row.message },
          options: { ttl: 3600, urgency: 'high' },
        },
        subscription,
        vapid
      );
      const res = await fetch(subscription.endpoint, payload);
      if (res.ok) {
        finish(row);
        statements.push(
          db.prepare('INSERT INTO history (endpoint, fired_at, message) VALUES (?, ?, ?)').bind(row.endpoint, now, row.message)
        );
        statements.push(
          db
            .prepare(
              'DELETE FROM history WHERE endpoint = ? AND id NOT IN (SELECT id FROM history WHERE endpoint = ? ORDER BY id DESC LIMIT ?)'
            )
            .bind(row.endpoint, row.endpoint, MAX_HISTORY)
        );
      } else if (res.status === 404 || res.status === 410) {
        // 기기가 구독을 취소해서 더는 보낼 수 없다. 이 기기의 알림을 모두 지운다.
        statements.push(db.prepare('DELETE FROM alarms WHERE endpoint = ?').bind(row.endpoint));
      } else if (now - row.fireAt > GIVE_UP_MS) {
        console.log('포기', row.id, res.status);
        finish(row);
      } else {
        console.log('다음 분에 재시도', row.id, res.status);
      }
    } catch (e) {
      console.log('전송 오류', row.id, String(e));
      if (now - row.fireAt > GIVE_UP_MS) finish(row);
    }
  }

  if (statements.length) await db.batch(statements);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};
