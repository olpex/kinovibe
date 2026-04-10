export default async function handler(req, res) {
    const { title, year } = req.query;
    if (!title) return res.redirect('/');

    // Формуємо запит: Назва Рік дивитися онлайн українською hd
    const query = `${title} ${year && year !== 'N/A' ? year : ''} дивитися онлайн українською hd`.trim();
    
    try {
        // Робимо "невидимий" запит під капотом до базової HTML-версії пошуковика
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        const html = await response.text();
        
        // Знаходимо перше реальне посилання у видачі за допомогою регулярного виразу
        // DuckDuckGo ховає лінки у форматі href="//duckduckgo.com/l/?uddg=РЕАЛЬНИЙ_ЛІНК"
        const match = html.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/);
        
        if (match && match[1]) {
            // Декодуємо URL (наприклад з https%3A%2F%2Fukrflix.com...) і робимо миттєвий редирект!
            const finalUrl = decodeURIComponent(match[1]);
            return res.redirect(302, finalUrl);
        }

        // Якщо нічого не знайшли - фолбек на звичайний пошук (але з такою логікою це рідкість)
        return res.redirect(302, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    } catch (e) {
        console.error("Watch API Error:", e);
        return res.redirect(302, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    }
}
