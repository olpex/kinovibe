# 🎬 КіноВайб — Деплой на Vercel

## Швидкий деплой (3 способи)

---

### 🥇 Спосіб 1: Drag & Drop (найпростіший, 1 хвилина)

1. Відкрий [vercel.com/new](https://vercel.com/new)
2. Перетягни папку `kinovibe/` прямо у браузер
3. Натисни **Deploy** → сайт живий! ✅

---

### 🥈 Спосіб 2: GitHub + Vercel (рекомендовано)

```bash
# 1. Ініціалізуй git і запуш на GitHub
cd kinovibe
git init
git add .
git commit -m "feat: КіноВайб initial deploy"
gh repo create kinovibe --public --push --source=.

# 2. На vercel.com → "Import Project" → обери репо → Deploy
```

---

### 🥉 Спосіб 3: Vercel CLI (з токеном)

```bash
# 1. Отримай токен: https://vercel.com/account/tokens
# 2. Запусти деплой
cd kinovibe
npx vercel --token YOUR_TOKEN_HERE --yes --prod
```

---

## Після деплою

Потрібні API ключі (зберігаються в localStorage браузера):
- **OMDb API Key** → [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (безкоштовно)
- **Gemini API Key** → вбудований в код (замінити рядок `const apiKey = ""`)

Натисни ⚙️ в шапці сайту → введи OMDb ключ → готово!
