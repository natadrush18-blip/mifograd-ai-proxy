process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const {
  GIGACHAT_CLIENT_ID,
  GIGACHAT_CLIENT_SECRET,
  GIGACHAT_SCOPE = 'GIGACHAT_API_PERS',
  PORT = 3000,
} = process.env;

let tokenCache = { value: null, expiresAt: 0 };

async function getGigaChatToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  const basic = Buffer.from(`${GIGACHAT_CLIENT_ID}:${GIGACHAT_CLIENT_SECRET}`).toString('base64');
  const rqUID = crypto.randomUUID();

  const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': rqUID,
      'Authorization': `Basic ${basic}`,
    },
    body: `scope=${encodeURIComponent(GIGACHAT_SCOPE)}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: (data.expires_at || (now + 30 * 60 * 1000)) - 60_000,
  };

  return tokenCache.value;
}

app.post('/chat', async (req, res) => {
  try {
    const { messages, temperature = 0.8, max_tokens = 150 } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages required' });
    }

    const token = await getGigaChatToken();

    const gigaRes = await fetch('https://api.giga.chat/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'GigaChat-2',
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!gigaRes.ok) {
      const text = await gigaRes.text();
      console.error('GigaChat error:', gigaRes.status, text);
      return res.status(gigaRes.status).json({ error: text });
    }

    const data = await gigaRes.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || '';

    res.json({ choices: [{ message: { content } }] });
  } catch (e) {
    console.error('Handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_, res) => {
  res.json({
    status: 'ok',
    service: 'МифоГрад AI proxy',
    has_client_id: !!GIGACHAT_CLIENT_ID,
    has_client_secret: !!GIGACHAT_CLIENT_SECRET,
  });
});

app.listen(PORT, () => console.log(`🚀 Прокси запущен на порту ${PORT}`));
