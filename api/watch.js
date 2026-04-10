export default async function handler(req, res) {
    const { title, year, imdbID } = req.query;
    if (!title) return res.redirect('/');

    const safeYear = year && year !== 'N/A' ? year : '';
    const query = `${imdbID ? `${imdbID} ` : ''}"${title}" ${safeYear} дивитися онлайн українською`.trim();
    
    try {
        // Робимо "невидимий" запит під капотом до базової HTML-версії пошуковика
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        const html = await response.text();
        
        // DuckDuckGo ховає лінки у форматі href="//duckduckgo.com/l/?uddg=РЕАЛЬНИЙ_ЛІНК"
        const rawMatches = Array.from(html.matchAll(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/g));
        const decodedUrls = rawMatches.map((item) => {
            try {
                return decodeURIComponent(item[1]);
            } catch {
                return item[1];
            }
        });

        if (decodedUrls.length > 0) {
            const preferred = decodedUrls.find((url) =>
                !/imdb\.com|wikipedia\.org|rottentomatoes\.com/i.test(url)
            );
            return res.redirect(302, preferred || decodedUrls[0]);
        }

        // Якщо нічого не знайшли - фолбек на звичайний пошук (але з такою логікою це рідкість)
        return res.redirect(302, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    } catch (e) {
        console.error("Watch API Error:", e);
        return res.redirect(302, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    }
}
