export const config = { runtime: 'edge' };

const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
];

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Gemini API key not configured on server.' }), { status: 500 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const { year, genre, wishes } = body;
    if (!wishes) {
        return new Response(JSON.stringify({ error: 'Missing required field: wishes' }), { status: 400 });
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
                // 401 — invalid key, no point retrying
                if (geminiRes.status === 401) {
                    return new Response(JSON.stringify({ error: `Недійсний Gemini API Key: ${msg}` }), { status: 502 });
                }
                // 404/400 — model not found/not supported, try next
                const isFallbackable = geminiRes.status === 503 || geminiRes.status === 429 ||
                    msg.includes('not found') || msg.includes('not supported');
                if (!isFallbackable) {
                    return new Response(JSON.stringify({ error: msg }), { status: 502 });
                }
                lastError = msg;
                continue;
            }

            const data = await geminiRes.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty response from Gemini');

            return new Response(JSON.stringify({ text }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (err) {
            lastError = err.message;
        }
    }

    return new Response(JSON.stringify({ error: `Сервери Gemini тимчасово недоступні: ${lastError}` }), { status: 503 });
}
