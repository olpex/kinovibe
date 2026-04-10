const https = require('https');

const MODELS = [
    'openai/gpt-oss-120b:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-4-26b-a4b-it:free',
    'qwen/qwen3-coder:free',
    'nousresearch/hermes-3-llama-3.1-405b:free'
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

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(200).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return res.status(200).json({ error: 'OPENROUTER_API_KEY не налаштований. Додайте його до .env.local або у Vercel.' });
    }

    const { year, genre, wishes } = req.body || {};
    if (!wishes) {
        return res.status(200).json({ error: 'Відсутнє поле: wishes' });
    }

    const prompt = `Підбери до 10 фільмів, які ідеально відповідають цим ОБОВ'ЯЗКОВИМ критеріям користувача. Якщо під ці критерії є менше 10 фільмів - поверни скільки є.
ОБОВ'ЯЗКОВИЙ Рік виходу: ${year}. Фільми ПОВИННІ бути випущені САМЕ В ЦЬОМУ РОЦІ (або в цих роках, якщо вказано декілька). КРИТИЧНО ВАЖЛИВО! Ніколи не пропонуй фільми інших років. Якщо ти не можеш знайти фільми саме цих років, краще поверни порожній масив [].
Жанр: ${genre}.
Особисті побажання користувача: "${wishes}".

Ти повинен повернути СУТО JSON масив об'єктів. БЕЗ форматування markdown, БЕЗ пояснень. Тільки валідний JSON.
Кожен об'єкт має містити ТРИ ключі:
'title' (точна офіційна англійська назва фільму, як в базі IMDb).
'year' (рік виходу фільму у форматі 4 цифр, наприклад "2024").
'plot' (цікавий і детальний опис фільму УКРАЇНСЬКОЮ мовою).

Приклад ідеальної відповіді:
[
  {"title": "Dune: Part Two", "year": "2024", "plot": "Пол Атрід об'єднується з фременами..."}
]`;

    let allErrors = [];

    for (const model of MODELS) {
        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        };

        try {
            const result = await httpsPost('https://openrouter.ai/api/v1/chat/completions', apiKey, payload);
            let data;
            try { data = JSON.parse(result.body); } catch { data = {}; }

            if (result.status === 401) {
                return res.status(200).json({ error: 'Недійсний OpenRouter API Key.' });
            }

            if (result.status !== 200) {
                const msg = data?.error?.message || `HTTP ${result.status}`;
                allErrors.push(`[${model}] ${msg}`);
                continue;
            }

            let text = data?.choices?.[0]?.message?.content;
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

        } catch (err) {
            allErrors.push(`[${model}] ${err.message}`);
        }
    }

    return res.status(200).json({ error: `Всі безкоштовні нейромережі недоступні. Деталі: ${allErrors.join(' | ')}` });
};
