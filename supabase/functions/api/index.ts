// 앱의 모든 요청이 지나가는 Edge Function. verify_jwt는 끄고 배포한다(자체 로그인을 쓴다).
// 표는 service_role만 읽고 쓸 수 있다. 브라우저는 이 함수에 세션 토큰을 보내고, 함수가 권한을 확인한다.
// 비밀번호는 DB에서 bcrypt로 암호화해 저장하고, 어디서도 원문을 볼 수 없다.
// OpenRouter 키는 Supabase Secrets의 openrouter_api_key에서만 읽는다.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SESSION_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[A-Za-z0-9가-힣_]{3,20}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

const len = (s: string) => Array.from(s).length;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

type Member = { id: string; username: string; is_admin: boolean };

function checkPassword(password: string) {
  if (len(password) < 4) fail(400, '비밀번호는 4자 이상으로 입력해 주세요.');
  if (new TextEncoder().encode(password).length > 72) fail(400, '비밀번호가 너무 길어요.');
}

async function startSession(memberId: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db
    .from('sessions')
    .insert({ token_hash: await sha256Hex(token), member_id: memberId, expires_at: expires });
  if (error) throw error;
  return token;
}

async function authenticate(token: unknown): Promise<Member> {
  if (typeof token !== 'string' || token.length !== 64) return fail(401, '로그인이 필요해요.');
  const { data, error } = await db
    .from('sessions')
    .select('expires_at, members(id, username, is_admin)')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle();
  if (error) throw error;
  const m = Array.isArray(data?.members) ? data?.members[0] : data?.members;
  if (!data || !m || new Date(data.expires_at) < new Date()) return fail(401, '로그인이 필요해요. 다시 로그인해 주세요.');
  return m as Member;
}

const requireAdmin = (me: Member) => {
  if (!me.is_admin) fail(403, '관리자만 할 수 있어요.');
};

async function suggestReview(input: Record<string, unknown>) {
  const name = str(input.name).trim();
  const menu = str(input.menu).trim();
  const rating = input.rating == null || input.rating === '' ? null : Number(input.rating);
  if (!name || len(name) > 30) fail(400, '식당 이름은 1~30자로 입력해 주세요.');
  if (len(menu) > 30) fail(400, '메뉴는 30자 이하로 입력해 주세요.');
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail(400, '별점은 1~5 사이로 선택해 주세요.');

  const apiKey = Deno.env.get('openrouter_api_key');
  if (!apiKey) fail(500, '서버에 AI 키가 설정되어 있지 않아요.');

  const facts = [`식당: ${name}`, menu && `메뉴: ${menu}`, rating !== null && `별점: 5점 만점에 ${rating}점`]
    .filter(Boolean)
    .join('\n');

  // 무료 모델은 가끔 빈 답을 주므로 최대 2번 시도한다.
  let failure = 'AI가 한줄평을 만들지 못했어요. 다시 눌러 주세요.';
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openrouter/free',
          max_tokens: 1000, // 무료 모델이 생각(reasoning)에 토큰을 쓰는 경우를 위해 넉넉히
          messages: [
            {
              role: 'system',
              content:
                '너는 동네 맛집 기록에 들어갈 한줄평을 쓴다. 반드시 한국어 한 문장, 40자 이내로, 따옴표·이모지·설명 없이 문장만 출력한다.',
            },
            { role: 'user', content: facts },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      failure = 'AI 서버에 연결하지 못했어요.';
      continue;
    }
    if (!res.ok) {
      failure = 'AI가 지금 응답하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      continue;
    }
    const data = await res.json().catch(() => null);
    const raw: string = data?.choices?.[0]?.message?.content ?? '';
    let review = raw.trim().split('\n')[0].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    if (!review) continue;
    if (len(review) > 40) review = Array.from(review).slice(0, 40).join('');
    return { review };
  }
  return fail(502, failure);
}

async function handle(input: Record<string, unknown>) {
  const action = str(input.action);

  if (action === 'signup') {
    const username = str(input.username).trim();
    const password = str(input.password);
    if (!USERNAME.test(username)) fail(400, '아이디는 3~20자의 한글·영문·숫자·밑줄(_)만 쓸 수 있어요.');
    checkPassword(password);
    const { data, error } = await db.rpc('app_signup', { p_username: username, p_password: password });
    if (error) {
      if (error.code === '23505') fail(409, '이미 쓰고 있는 아이디예요.');
      throw error;
    }
    return { token: await startSession(data as string), username, is_admin: false };
  }

  if (action === 'login') {
    const username = str(input.username).trim();
    const password = str(input.password);
    if (!username || !password || username.length > 40 || password.length > 100) fail(400, '아이디와 비밀번호를 입력해 주세요.');
    const { data, error } = await db.rpc('app_login', { p_username: username, p_password: password });
    if (error) throw error;
    if (data.status === 'locked') fail(429, '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.');
    if (data.status !== 'ok') fail(401, '아이디 또는 비밀번호가 맞지 않아요.');
    return { token: await startSession(data.member_id), username: data.username, is_admin: data.is_admin };
  }

  // 여기부터는 로그인한 사람만 쓸 수 있다.
  const me = await authenticate(input.token);

  switch (action) {
    case 'me':
      return { username: me.username, is_admin: me.is_admin };

    case 'logout': {
      await db.from('sessions').delete().eq('token_hash', await sha256Hex(str(input.token)));
      return { ok: true };
    }

    case 'list': {
      const [restaurants, comments, counts, mine] = await Promise.all([
        db.from('restaurants').select('*, members(username)').order('created_at', { ascending: false }),
        db.from('comments').select('*, members(username)').order('created_at', { ascending: true }),
        db.from('reaction_counts').select('*'),
        db.from('reactions').select('restaurant_id, kind').eq('member_id', me.id),
      ]);
      for (const r of [restaurants, comments, counts, mine]) if (r.error) throw r.error;
      const myVotes: Record<string, string> = {};
      for (const v of mine.data!) myVotes[v.restaurant_id] = v.kind;
      // 작성자 아이디를 카드에 붙인다. 작성자 기록이 없는 예전 카드는 author가 null이다.
      const list = restaurants.data!.map(({ members, member_id: _memberId, ...r }) => ({
        ...r,
        author: (Array.isArray(members) ? members[0] : members)?.username ?? null,
      }));
      // 댓글에도 작성자 아이디를 붙인다. 작성자 기록이 없는 예전 댓글은 author가 null이다.
      const commentList = comments.data!.map(({ members, member_id: _memberId, ...c }) => ({
        ...c,
        author: (Array.isArray(members) ? members[0] : members)?.username ?? null,
      }));
      return { restaurants: list, comments: commentList, counts: counts.data, myVotes };
    }

    case 'add_restaurant': {
      const name = str(input.name).trim();
      const menu = str(input.menu).trim();
      const location = str(input.location).trim();
      const review = str(input.review).trim();
      const rating = Number(input.rating);
      if (!name) fail(400, '식당 이름을 입력해 주세요.');
      if (len(name) > 30) fail(400, '식당 이름은 30자 이하로 써 주세요.');
      if (len(menu) > 30) fail(400, '메뉴는 30자 이하로 써 주세요.');
      if (len(location) > 50) fail(400, '위치는 50자 이하로 써 주세요.');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, '별점을 선택해 주세요.');
      if (len(review) > 100) fail(400, '한줄평은 100자 이하로 써 주세요.');
      const { error } = await db
        .from('restaurants')
        .insert({ name, menu: menu || null, location: location || null, rating, review: review || null, member_id: me.id });
      if (error) throw error;
      return { ok: true };
    }

    case 'delete_restaurant': {
      requireAdmin(me);
      const id = str(input.id);
      if (!UUID.test(id)) fail(400, '잘못된 요청이에요.');
      const { error } = await db.from('restaurants').delete().eq('id', id); // 댓글·좋아요는 함께 지워진다
      if (error) throw error;
      return { ok: true };
    }

    case 'add_comment': {
      const restaurantId = str(input.restaurant_id);
      const body = str(input.body).trim();
      if (!UUID.test(restaurantId)) fail(400, '잘못된 요청이에요.');
      if (!body) fail(400, '댓글을 입력해 주세요.');
      if (len(body) > 100) fail(400, '댓글은 100자 이하로 써 주세요.');
      const { error } = await db.from('comments').insert({ restaurant_id: restaurantId, body, member_id: me.id });
      if (error) {
        if (error.code === '23503') fail(404, '이미 삭제된 맛집이에요.');
        throw error;
      }
      return { ok: true };
    }

    case 'delete_comment': {
      requireAdmin(me);
      const id = str(input.id);
      if (!UUID.test(id)) fail(400, '잘못된 요청이에요.');
      const { error } = await db.from('comments').delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    }

    case 'react': {
      const restaurantId = str(input.restaurant_id);
      const kind = str(input.kind);
      if (!UUID.test(restaurantId) || !['like', 'dislike'].includes(kind)) fail(400, '잘못된 요청이에요.');
      const { error } = await db.from('reactions').insert({ restaurant_id: restaurantId, kind, member_id: me.id });
      if (error) {
        if (error.code === '23505') fail(409, '이미 이 카드에 눌렀어요.');
        if (error.code === '23503') fail(404, '이미 삭제된 맛집이에요.');
        throw error;
      }
      return { ok: true };
    }

    case 'suggest_review':
      return await suggestReview(input);

    case 'admin_members': {
      requireAdmin(me);
      const { data, error } = await db
        .from('members')
        .select('id, username, is_admin, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return { members: data };
    }

    case 'admin_reset_password': {
      requireAdmin(me);
      const memberId = str(input.member_id);
      const password = str(input.password);
      if (!UUID.test(memberId)) fail(400, '잘못된 요청이에요.');
      checkPassword(password);
      const { error } = await db.rpc('app_set_password', { p_member_id: memberId, p_password: password });
      if (error) throw error;
      return { ok: true };
    }

    default:
      return fail(400, '알 수 없는 요청이에요.');
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 쓸 수 있어요.' }, 405);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: '요청 형식이 올바르지 않아요.' }, 400);
  }

  try {
    return json(await handle(input ?? {}));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('api error', err);
    return json({ error: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' }, 500);
  }
});
