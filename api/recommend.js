const https = require('https');

const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
];

function httpsPost(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const body = JSON.stringify(data);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let rawData = '';
            res.on('data', chunk => rawData += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: rawData }));
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

// Завжди повертає HTTP 200 — помилки в { error: "..." }, успіх в { text: "..." }
module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(200).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(200).json({ error: 'GEMINI_API_KEY не налаштований на сервері Vercel. Додайте його у Settings → Environment Variables.' });
    }

    const { year, genre, wishes } = req.body || {};
    if (!wishes) {
        return res.status(200).json({ error: 'Відсутнє поле: wishes' });
    }

    const prompt = `Підбери 16 фільмів, які ідеально відповідають цим критеріям користувача.\nРік виходу: ${year}.\nЖанр: ${genre}.\nОсобисті побажання користувача: "${wishes}".\n\nПоверни СУТО JSON масив об'єктів. БЕЗ форматування markdown, БЕЗ пояснень. Тільки валідний JSON.\nКожен об'єкт має містити два ключі:\n'title' (точна офіційна англійська назва фільму, як в базі IMDb).\n'plot' (цікавий і детальний опис фільму УКРАЇНСЬКОЮ мовою).\n\nПриклад відповіді:\n[\n  {"title": "The Matrix", "plot": "Культовий фільм про хакера Нео..."},\n  {"title": "Inception", "plot": "Злодій, який краде корпоративні секрети..."}\n]`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
    };

    let lastError = 'невідома помилка';

    for (const model of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
            const result = await httpsPost(url, payload);
            let data;
            try { data = JSON.parse(result.body); } catch { data = {}; }

            if (result.status === 401) {
                return res.status(200).json({ error: 'Недійсний або анульований Gemini API Key.' });
            }

            if (result.status !== 200) {
                const msg = data?.error?.message || `HTTP ${result.status}`;
                const isFallbackable = result.status === 503 || result.status === 429 ||
                    msg.includes('not found') || msg.includes('not supported') || msg.includes('overloaded');
                if (!isFallbackable) return res.status(200).json({ error: msg });
                lastError = `[${model}] ${msg}`;
                continue;
            }

            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) { lastError = `[${model}] порожня відповідь`; continue; }

            return res.status(200).json({ text });

        } catch (err) {
            lastError = `[${model}] ${err.message}`;
        }
    }

    return res.status(200).json({ error: `Всі моделі Gemini недоступні: ${lastError}` });
};
