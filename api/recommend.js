const https = require('https');

// Безкоштовні моделі на OpenRouter
const MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'google/gemma-3-27b-it:free'
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

    // Тепер будемо використовувати іншу змінну
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return res.status(200).json({ error: 'OPENROUTER_API_KEY не налаштований. Додайте його до .env.local або у Vercel.' });
    }

    const { year, genre, wishes } = req.body || {};
    if (!wishes) {
        return res.status(200).json({ error: 'Відсутнє поле: wishes' });
    }

    const prompt = `Підбери 16 фільмів, які ідеально відповідають цим критеріям.\nРік виходу: ${year}.\nЖанр: ${genre}.\nОсобисті побажання користувача: "${wishes}".\n\nТи повинен повернути СУТО JSON масив об'єктів. БЕЗ форматування markdown, БЕЗ пояснень. Тільки валідний JSON.\nКожен об'єкт має містити два ключі:\n'title' (точна офіційна англійська назва фільму, як в базі IMDb).\n'plot' (цікавий і детальний опис фільму УКРАЇНСЬКОЮ мовою).\n\nПриклад ідеальної відповіді:\n[\n  {"title": "The Matrix", "plot": "Культовий фільм про хакера Нео..."}\n]`;

    let lastError = 'невідома помилка';

    for (const model of MODELS) {
        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            response_format: { type: "json_object" } // Змушуємо деякі моделі віддавати чистий JSON
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
                lastError = `[${model}] ${msg}`;
                
                // Переходимо до наступної моделі при будь-якій помилці (перевантаження, немає вільних серверів тощо),
                // окрім 401 (коли ключ гарантовано невірний)
                continue;
            }

            let text = data?.choices?.[0]?.message?.content;
            if (!text) { lastError = `[${model}] порожня відповідь`; continue; }

            // Чистимо текст, якщо ШІ додав Markdown
            text = text.trim();
            if (text.startsWith('```json')) text = text.substring(7);
            else if (text.startsWith('```')) text = text.substring(3);
            if (text.endsWith('```')) text = text.substring(0, text.length - 3);
            text = text.trim();

            // Перевіряємо чи це масив, якщо ШІ повернув об'єкт з масивом
            let parsed;
            try { 
                parsed = JSON.parse(text); 
                if (!Array.isArray(parsed) && typeof parsed === 'object') {
                    // Якщо повернулося { "movies": [...] } 
                    const firstKey = Object.keys(parsed)[0];
                    if (Array.isArray(parsed[firstKey])) {
                        text = JSON.stringify(parsed[firstKey]);
                    }
                }
            } catch (e) {}

            return res.status(200).json({ text });

        } catch (err) {
            lastError = `[${model}] ${err.message}`;
        }
    }

    return res.status(200).json({ error: `Всі безкоштовні нейромережі тимчасово перевантажені: ${lastError}` });
};
