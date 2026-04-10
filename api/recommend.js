const https = require('https');

const MODELS = [
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-120b:free'
];
const REQUEST_TIMEOUT_MS = 18000;
const MAX_MODELS_TO_TRY = 3;
const MAX_RETRIES_PER_MODEL = 2;
const RETRY_DELAY_MS = 450;
const MIN_RECOMMENDATIONS = 4;

function httpsPost(url, token, data, timeoutMs = REQUEST_TIMEOUT_MS) {
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
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
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

function normalizeModelResponse(text) {
    let cleaned = (text || '').trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
    cleaned = cleaned.trim();

    let parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
        const firstKey = Object.keys(parsed)[0];
        if (Array.isArray(parsed[firstKey])) {
            parsed = parsed[firstKey];
        }
    }

    if (!Array.isArray(parsed)) {
        throw new Error('Відповідь моделі не була масивом.');
    }

    return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            title: typeof item.title === 'string' ? item.title.trim() : '',
            year: typeof item.year === 'string' || typeof item.year === 'number' ? String(item.year).trim() : '',
            plot: typeof item.plot === 'string' ? item.plot.trim() : ''
        }))
        .filter((item) => item.title && item.year);
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
    const minResultTarget = Math.max(MIN_RECOMMENDATIONS, Math.min(6, selectedYears.length > 1 ? selectedYears.length : 4));

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
6) Якщо існує кілька релевантних варіантів, не зупиняйся на одному. Заповни список максимально повно.

Поверни ТІЛЬКИ JSON-масив без markdown. Цільова кількість: від ${minResultTarget} до 9 фільмів.
Кожен елемент:
{
  "title": "Original English Title",
  "year": "2023",
  "plot": "Короткий правдивий опис українською (2-3 речення)"
}`;

    let allErrors = [];
    let bestPartialResults = [];

    for (const model of MODELS.slice(0, MAX_MODELS_TO_TRY)) {
        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.25,
            max_tokens: 900
        };

        let result;
        let data;
        let success = false;
        
        for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
            try {
                result = await httpsPost('https://openrouter.ai/api/v1/chat/completions', apiKey, payload, REQUEST_TIMEOUT_MS);
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
                    await sleep(RETRY_DELAY_MS);
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

        const text = data.choices[0].message.content;
        if (!text) {
            allErrors.push(`[${model}] порожня відповідь`);
            continue;
        }

        try {
            const parsed = normalizeModelResponse(text);
            if (parsed.length < MIN_RECOMMENDATIONS) {
                if (parsed.length > bestPartialResults.length) {
                    bestPartialResults = parsed;
                }
                allErrors.push(`[${model}] замало результатів: ${parsed.length}`);
                continue;
            }

            return res.status(200).json({ text: JSON.stringify(parsed) });
        } catch (e) {
            allErrors.push(`[${model}] не вдалося розібрати JSON: ${e.message}`);
        }
    }

    if (bestPartialResults.length > 0) {
        return res.status(200).json({ text: JSON.stringify(bestPartialResults) });
    }

    return res.status(200).json({ error: `Всі безкоштовні нейромережі недоступні. Деталі: ${allErrors.join(' | ')}` });
};
