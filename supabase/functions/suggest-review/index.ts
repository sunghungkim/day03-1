// 한줄평 추천 Edge Function. verify_jwt는 꺼서 배포한다(로그인이 없는 앱).
// OpenRouter 키는 Supabase Secrets의 openrouter_api_key에서만 읽는다.
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

const len = (s: string) => Array.from(s).length;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 쓸 수 있어요.' }, 405);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: '요청 형식이 올바르지 않아요.' }, 400);
  }

  const name = String(input?.name ?? '').trim();
  const menu = String(input?.menu ?? '').trim();
  const rating = input?.rating == null || input.rating === '' ? null : Number(input.rating);

  if (!name || len(name) > 30) return json({ error: '식당 이름은 1~30자로 입력해 주세요.' }, 400);
  if (len(menu) > 30) return json({ error: '메뉴는 30자 이하로 입력해 주세요.' }, 400);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return json({ error: '별점은 1~5 사이로 선택해 주세요.' }, 400);
  }

  const apiKey = Deno.env.get('openrouter_api_key');
  if (!apiKey) return json({ error: '서버에 AI 키가 설정되어 있지 않아요.' }, 500);

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
    return json({ review });
  }
  return json({ error: failure }, 502);
});
