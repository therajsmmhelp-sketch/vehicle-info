# Vehicle Info Telegram Bot — Webhook + Vercel (Free, 24/7)

Ye polling wale bot ka webhook version hai. Isme koi process hamesha chalu nahi rehta —
Telegram khud is URL ko call karta hai jab bhi user message bhejta hai. Isliye ye
Vercel ke free plan pe 24/7 chal sakta hai, bina kisi server ko manage kiye.

## Deploy karne ke steps

### 1. GitHub pe push karo
Ye poora folder ek GitHub repo mein push karo (Vercel GitHub se deploy karta hai).

```
git init
git add .
git commit -m "vehicle info bot - webhook version"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Vercel pe import karo
1. https://vercel.com pe jaake login karo (GitHub se login kar sakte ho)
2. "Add New" -> "Project" -> apna GitHub repo select karo -> Import
3. Deploy hone do (kuch settings change karne ki zaroorat nahi, Vercel `/api` folder ko
   automatically serverless functions bana deta hai)

### 3. Environment variables set karo
Vercel project -> **Settings -> Environment Variables** mein ye do add karo:

| Key | Value |
|---|---|
| `BOT_TOKEN` | apna naya BotFather token (purana wala revoke karke naya lo) |
| `SETUP_SECRET` | koi bhi random string jo tumhe yaad rahe, jaise `mysecret123xyz` |

Variables add karne ke baad **Redeploy** karo (Deployments tab -> latest deployment ->
"..." menu -> Redeploy), taaki naye env vars apply ho.

### 4. Webhook register karo (sirf ek baar karna hai)
Deploy hone ke baad tumhe ek URL milega jaisa: `https://your-project.vercel.app`

Browser mein ye URL kholo (apna project URL aur secret daal ke):
```
https://your-project.vercel.app/api/set-webhook?secret=mysecret123xyz
```

Agar sab sahi hai to JSON response milega `"success": true` ke saath. Bas — ab bot live hai!

### 5. Test karo
Telegram mein apne bot ko `/start` bhejo — reply aana chahiye.

## Files
- `api/webhook.js` — bot ka pura logic + Telegram updates receive karne ka endpoint
- `api/set-webhook.js` — one-time setup endpoint jo Telegram ko batata hai webhook URL kya hai
- `vercel.json` — function timeout settings
- `.env.example` — kaunse environment variables chahiye (Vercel dashboard mein daalne hain,
  `.env` file yaha kaam nahi karegi)

## Important note (state / "awaiting vehicle number")
Vercel ke serverless functions stateless hote hain — har request naye ya reused instance pe
chal sakti hai, isliye `awaitingVehicleNumber` (in-memory Set) kabhi-kabhi reset ho sakta hai
agar Vercel ne naya instance spin kiya. Zyadatar cases mein (short time gap ke andar reply)
ye theek kaam karega kyunki Vercel warm instances reuse karta hai, lekin agar tumhe 100%
guaranteed reliability chahiye (bahut zyada users / traffic ke liye), to is state ko kisi
free database mein store karna better hoga (jaise Vercel KV, Upstash Redis free tier, ya
Supabase free tier) instead of in-memory Set. Abhi ke scale (chhota personal bot) ke liye
current setup bilkul theek chalega.

## Security reminder
Purana bot token (`8751682165:AAF...`) is zip mein pehle expose ho chuka tha — agar abhi
tak revoke nahi kiya, BotFather pe jaake turant naya token generate karo aur wahi
`BOT_TOKEN` environment variable mein daalo.
