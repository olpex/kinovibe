const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
];

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured on server.' });
    }

    const { year, genre, wishes } = req.body || {};
    if (!wishes) {
        return res.status(400).json({ error: 'Missing required field: wishes' });
    }

    const prompt = `Підбери 16 фільмів, які ідеально відповідають цим критеріям користувача.\nРік виходу: ${year}.\nЖанр: ${genre}.\nОсобисті побажання користувача: "${wishes}".\n\nПоверни СУТО JSON масив об'єктів. БЕЗ форматування markdown, БЕЗ пояснень. Тільки валідний JSON.\nКожен об'єкт має містити два ключі:\n'title' (точна офіційна англійська назва фільму, як в базі IMDb).\n'plot' (цікавий і детальний опис фільму УКРАЇНСЬКОЮ мовою).\n\nПриклад відповіді:\n[\n  {"title": "The Matrix", "plot": "Культовий фільм про хакера Нео..."},\n  {"title": "Inception", "plot": "Злодій, який краде корпоративні секрети..."}\n]`;

    const payload = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
    });

    let lastError = '';
    for (const model of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
            const geminiRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });

            if (!geminiRes.ok) {
                const errData = await geminiRes.json().catch(() => ({}));
                const msg = errData?.error?.message || `HTTP ${geminiRes.status}`;

                if (geminiRes.status === 401) {
                    return res.status(502).json({ error: `Недійсний Gemini API Key: ${msg}` });
                }

                const isFallbackable = geminiRes.status === 503 || geminiRes.status === 429 ||
                    msg.includes('not found') || msg.includes('not supported');
                if (!isFallbackable) {
                    return res.status(502).json({ error: msg });
                }
                lastError = msg;
                continue;
            }

            const data = await geminiRes.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty response from Gemini');

            return res.status(200).json({ text });

        } catch (err) {
            lastError = err.message;
        }
    }

    return res.status(503).json({ error: `Сервери Gemini тимчасово недоступні: ${lastError}` });
};
