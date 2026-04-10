const https = require('https');

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

    const prompt = `Ти суворий кінокритик і кінобаза. Твоє завдання - підібрати 1-10 РЕАЛЬНИХ ІСНУЮЧИХ фільмів, які ІДЕАЛЬНО відповідають усім критеріям користувача.
КРИТИЧНО ВАЖЛИВІ ПРАВИЛА (ІНАКШЕ ШТРАФ):
1. ЗАБОРОНЕНО вигадувати фільми! Тільки ті, що дійсно існують і дійсно вийшли.
2. ОБОВ'ЯЗКОВИЙ Рік виходу: ${year}. Якщо немає жодного фільму про це у ці роки - НЕ ПРОПОНУЙ інші роки! Поверни порожній масив [].
3. Жанр: ${genre}.
4. Сюжет/Побажання: "${wishes}". Фільм має ТОЧНО бути про це. Якщо побажання специфічне (напр. "сім'я на природі"), не пропонуй фільми про поліцейських чи зомбі на війні. 
КРАЩЕ ПОВЕРНУТИ ЗОВСІМ ПОРОЖНІЙ МАСИВ [], НІЖ ЗАПРОПОНУВАТИ ФІЛЬМ ІНШОГО РОКУ ЧИ ІНШОГО СЮЖЕТУ!

Ти повинен повернути СУТО JSON масив об'єктів. БЕЗ форматування markdown, БЕЗ вступних слів.
Кожен об'єкт має містити:
'title' (точна оригінальна англійська назва, як на IMDb).
'year' (тільки 4 цифри, наприклад "2023").
'plot' (детальний правдивий опис фільму УКРАЇНСЬКОЮ мовою).

Приклад відповіді:
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
                allErrors.push(`[${model}] ${e.message}`);
                break;
            }
        }
        
        if (!success) {
            if (data?.error?.message?.includes('Provider returned error')) {
                allErrors.push(`[${model}] Provider returned error (retries exhausted)`);
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
