const https = require('https');

const MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'google/gemma-3-27b-it:free',
    'openai/gpt-oss-120b:free',
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free'
];

function httpsPost(url, token, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const body = JSON.stringify(data);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(body),
                'HTTP-Referer': 'https://kinovibe.vercel.app', 
                'X-Title': 'KinoVibe'
            }
        };
        const req = https.request(options, (res) => {
            let rawData = '';
            res.on('data', chunk => rawData += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: rawData }));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeFilterArray(input, ignoredValues = []) {
    const ignoredSet = new Set(ignoredValues.map((v) => String(v).trim().toLowerCase()));
    let values = [];

    if (Array.isArray(input)) {
        values = input;
    } else if (typeof input === 'string') {
        values = input.split(',');
    }

    return [...new Set(
        values
            .map((value) => String(value).trim())
            .filter((value) => value && !ignoredSet.has(value.toLowerCase()))
    )];
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(200).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return res.status(200).json({ error: 'OPENROUTER_API_KEY не налаштований. Додайте його до .env.local або у Vercel.' });
    }

    const { year, genre, years, genres, wishes } = req.body || {};
    if (!wishes) {
        return res.status(200).json({ error: 'Відсутнє поле: wishes' });
    }

    const selectedYears = normalizeFilterArray(years ?? year, ['any', 'будь-який рік', 'не має значення']);
    const selectedGenres = normalizeFilterArray(genres ?? genre, ['any', 'будь-який жанр', 'не має значення']);

    const yearRule = selectedYears.length > 0
        ? `Роки (строго): ${selectedYears.join(', ')}. Відповідь має містити тільки ці роки.`
        : 'Роки: без обмежень.';
    const genreRule = selectedGenres.length > 0
        ? `Жанри (строго): ${selectedGenres.join(', ')}. Кожен фільм повинен відповідати хоча б одному із цих жанрів.`
        : 'Жанри: без обмежень.';

    const prompt = `Ти експерт з підбору фільмів. Поверни список РЕАЛЬНИХ, ІСНУЮЧИХ ПОВНОМЕТРАЖНИХ ФІЛЬМІВ (не серіали), які максимально відповідають запиту.

Запит користувача:
- Теми/атмосфера: "${wishes}"
- ${yearRule}
- ${genreRule}

Жорсткі правила:
1) Не вигадуй назви, роки або сюжети. Тільки реальні фільми.
2) Якщо задані роки - не виходь за межі цих років.
3) Якщо задані жанри - кожен фільм має підходити щонайменше під один із жанрів.
4) Тематична близькість до запиту обов'язкова: відкидай слабко релевантні варіанти.
5) Вкажи оригінальну англійську назву точно як на IMDb.

Поверни ТІЛЬКИ JSON-масив без markdown. Кількість: від 6 до 14 фільмів (або менше, якщо строгі критерії сильно обмежують вибір).
Кожен елемент:
{
  "title": "Original English Title",
  "year": "2023",
  "plot": "Короткий правдивий опис українською (2-3 речення)"
}`;

    let allErrors = [];

    for (const model of MODELS) {
        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.25
        };

        let result;
        let data;
        let success = false;
        
        for (let retry = 0; retry < 3; retry++) {
            try {
                result = await httpsPost('https://openrouter.ai/api/v1/chat/completions', apiKey, payload);
                try { data = JSON.parse(result.body); } catch { data = {}; }

                if (result.status === 401) {
                    return res.status(200).json({ error: 'Недійсний OpenRouter API Key.' });
                }

                if (result.status === 200 && data?.choices?.[0]?.message?.content) {
                    success = true;
                    break;
                }
                
                const msg = data?.error?.message || `HTTP ${result.status}`;
                if (msg.includes('Provider returned error') || msg.includes('overloaded') || result.status === 429 || result.status >= 500) {
                    // Пауза 1 секунда перед ретраєм
                    await sleep(1000);
                } else {
                    allErrors.push(`[${model}] ${msg}`);
                    break;
                }
            } catch (e) {
                allErrors.push(`[${model}] Запит впав: ${e.message}`);
                break;
            }
        }
        
        if (!success) {
            const finalMsg = data?.error?.message || (result ? `HTTP ${result.status}` : 'Fail');
            if (!allErrors.some(e => e.includes(`[${model}]`))) {
                allErrors.push(`[${model}] ${finalMsg} (exhausted)`);
            }
            continue;
        }

        let text = data.choices[0].message.content;
        if (!text) { allErrors.push(`[${model}] порожня відповідь`); continue; }

            text = text.trim();
            if (text.startsWith('```json')) text = text.substring(7);
            else if (text.startsWith('```')) text = text.substring(3);
            if (text.endsWith('```')) text = text.substring(0, text.length - 3);
            text = text.trim();

            let parsed;
            try { 
                parsed = JSON.parse(text); 
                if (!Array.isArray(parsed) && typeof parsed === 'object') {
                    const firstKey = Object.keys(parsed)[0];
                    if (Array.isArray(parsed[firstKey])) {
                        text = JSON.stringify(parsed[firstKey]);
                    }
                }
            } catch (e) {}

            return res.status(200).json({ text });
    }

    return res.status(200).json({ error: `Всі безкоштовні нейромережі недоступні. Деталі: ${allErrors.join(' | ')}` });
};
