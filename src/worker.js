import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_PER_DEVICE = 50;
const MAX_MESSAGE = 60;
const BATCH = 40; // 한 번에 보낼 최대 알림 수 (무료 플랜 요청 제한 때문)
const GIVE_UP_MS = 60 * 60 * 1000; // 1시간 넘게 못 보낸 알림은 포기

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
    const { results } = await env.DB
      .prepare('SELECT id, fire_at AS fireAt, message FROM alarms WHERE endpoint = ? ORDER BY fire_at')
      .bind(body.endpoint)
      .all();
    return json({ alarms: results });
  }

  if (url.pathname === '/api/alarms/add') {
    const { subscription, fireAt } = body;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!validSubscription(subscription)) return json({ error: '알림이 켜져 있지 않아요.' }, 400);
    if (!message || message.length > MAX_MESSAGE) {
      return json({ error: `문구는 1~${MAX_MESSAGE}자로 적어 주세요.` }, 400);
    }
    const now = Date.now();
    if (!Number.isFinite(fireAt) || fireAt <= now) {
      return json({ error: '지금보다 이후의 시간을 골라 주세요.' }, 400);
    }
    if (fireAt > now + 366 * 24 * 60 * 60 * 1000) {
      return json({ error: '1년 안의 날짜만 고를 수 있어요.' }, 400);
    }
    const count = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM alarms WHERE endpoint = ?')
      .bind(subscription.endpoint)
      .first();
    if (count.n >= MAX_PER_DEVICE) {
      return json({ error: `알림은 ${MAX_PER_DEVICE}개까지만 등록할 수 있어요.` }, 400);
    }
    await env.DB
      .prepare('INSERT INTO alarms (endpoint, sub, fire_at, message) VALUES (?, ?, ?, ?)')
      .bind(
        subscription.endpoint,
        JSON.stringify({
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        }),
        Math.floor(fireAt),
        message
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

  return json({ error: '없는 주소예요.' }, 404);
}

async function sendDue(env) {
  const now = Date.now();
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const { results } = await env.DB
    .prepare('SELECT id, sub, message, fire_at AS fireAt FROM alarms WHERE fire_at <= ? ORDER BY fire_at LIMIT ?')
    .bind(now, BATCH)
    .all();

  const doneIds = [];
  for (const row of results) {
    try {
      const payload = await buildPushPayload(
        {
          data: { title: '⏰ 알림', body: row.message },
          options: { ttl: 3600, urgency: 'high' },
        },
        JSON.parse(row.sub),
        vapid
      );
      const res = await fetch(JSON.parse(row.sub).endpoint, payload);
      // 성공했거나, 기기가 구독을 취소해서(404/410) 더는 보낼 수 없으면 목록에서 지운다.
      if (res.ok || res.status === 404 || res.status === 410) {
        doneIds.push(row.id);
      } else if (now - row.fireAt > GIVE_UP_MS) {
        console.log('포기', row.id, res.status);
        doneIds.push(row.id);
      } else {
        console.log('다음 분에 재시도', row.id, res.status);
      }
    } catch (e) {
      console.log('전송 오류', row.id, String(e));
      if (now - row.fireAt > GIVE_UP_MS) doneIds.push(row.id);
    }
  }

  if (doneIds.length) {
    await env.DB.batch(doneIds.map((id) => env.DB.prepare('DELETE FROM alarms WHERE id = ?').bind(id)));
  }
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
