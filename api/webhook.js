/**
 * 🔍 Vehicle Info Tracker - Telegram Bot (Webhook version for Vercel)
 * By Ahir Ankush
 *
 * Features:
 *  - /start, vehicle lookup flow
 *  - /stats  (admin only) - usage dashboard
 *  - /broadcast <msg> (admin only) - send a message to every user who has used the bot
 *  - /language - toggle Hindi / English
 *  - "Buy Followers/Likes/Views" inline button linking to therajsmm.com
 *
 * Data (users list, stats counters, language prefs) is stored in Upstash Redis
 * (free tier) since Vercel serverless functions don't keep memory between requests.
 *
 * IMPORTANT: We do NOT rely on bot.on('message', ...) event listeners. On Vercel,
 * once this function sends an HTTP response, the instance can be frozen/killed
 * even if an event-listener callback is still awaiting something. So we directly
 * handle the incoming update object and `await` every step, only responding to
 * Telegram once ALL work is fully done.
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { Redis } = require('@upstash/redis');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // your Telegram numeric user ID (string)
const API_URL = 'https://vehicle-info-api-acko.vercel.app/info';
const PROMO_URL = 'https://therajsmm.com';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing! Set it in Vercel Project Settings -> Environment Variables.');
}
if (!ADMIN_CHAT_ID) {
  console.error('⚠️ ADMIN_CHAT_ID not set - /stats and /broadcast will be disabled for everyone.');
}

const bot = new TelegramBot(BOT_TOKEN);
const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

// Best-effort in-memory state (fine for short-lived warm instances; not durable).
const awaitingVehicleNumber = new Set();

// ==== Redis keys ====
const USERS_KEY = 'bot:users';
const statsDailyKey = (d) => `bot:stats:daily:${d}`;
const statsMonthlyKey = (m) => `bot:stats:monthly:${m}`;
const STATS_TOTAL_KEY = 'bot:stats:total';
const langKey = (chatId) => `bot:lang:${chatId}`;

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthStr() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function trackUser(chatId) {
  try {
    await redis.sadd(USERS_KEY, String(chatId));
  } catch (e) {
    console.error('trackUser redis error:', e.message);
  }
}

async function trackSearch() {
  try {
    await Promise.all([
      redis.incr(STATS_TOTAL_KEY),
      redis.incr(statsDailyKey(todayStr())),
      redis.incr(statsMonthlyKey(monthStr())),
    ]);
  } catch (e) {
    console.error('trackSearch redis error:', e.message);
  }
}

async function getLang(chatId) {
  try {
    const lang = await redis.get(langKey(chatId));
    return lang === 'en' ? 'en' : 'hi'; // default Hindi
  } catch (e) {
    return 'hi';
  }
}

async function setLang(chatId, lang) {
  try {
    await redis.set(langKey(chatId), lang);
  } catch (e) {
    console.error('setLang redis error:', e.message);
  }
}

function isAdmin(fromId) {
  return ADMIN_CHAT_ID && String(fromId) === String(ADMIN_CHAT_ID);
}

// ==== Text dictionary (Hindi / English) ====
const TEXTS = {
  hi: {
    welcome: '👋 *Welcome to Vehicle Info Tracker!*\n\nRegistered vehicle details nikalne ke liye niche button dabao.',
    vehicleInfoBtn: '🚗 Vehicle Info',
    askNumber: '📝 Vehicle number bhejo.\n\nExample: `DL01AB1234`',
    invalidFormat: '⚠️ Invalid vehicle number format! Minimum 8 characters chahiye (e.g. DL01AB1234). Dobara bhejo.',
    scanning: '🔎 Scanning... please wait.',
    notFound: '⚠️ Vehicle not found in database. Please check the registration number and try again.',
    errorPrefix: '❌ *Error fetching vehicle data.*\n\n',
    errorStatus: (s) => `Status: ${s}\nPlease check the vehicle number and try again.`,
    errorTimeout: 'Request timed out. Please try again.',
    askAgain: 'Ek aur vehicle check karna hai? /start dabao.',
    langPrompt: '🌐 Apni pasand ki bhasha chuno:',
    langSet: '✅ Bhasha Hindi set kar di gayi.',
    notAdmin: '⛔ Ye command sirf admin use kar sakta hai.',
    broadcastUsage: 'Usage: `/broadcast tumhara message yaha`',
    broadcastDone: (sent, failed, total) => `📢 Broadcast bhej diya.\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n👥 Total users: ${total}`,
  },
  en: {
    welcome: '👋 *Welcome to Vehicle Info Tracker!*\n\nTap the button below to look up registered vehicle details.',
    vehicleInfoBtn: '🚗 Vehicle Info',
    askNumber: '📝 Send the vehicle number.\n\nExample: `DL01AB1234`',
    invalidFormat: '⚠️ Invalid vehicle number format! Minimum 8 characters required (e.g. DL01AB1234). Please resend.',
    scanning: '🔎 Scanning... please wait.',
    notFound: '⚠️ Vehicle not found in database. Please check the registration number and try again.',
    errorPrefix: '❌ *Error fetching vehicle data.*\n\n',
    errorStatus: (s) => `Status: ${s}\nPlease check the vehicle number and try again.`,
    errorTimeout: 'Request timed out. Please try again.',
    askAgain: 'Want to check another vehicle? Tap /start.',
    langPrompt: '🌐 Choose your preferred language:',
    langSet: '✅ Language set to English.',
    notAdmin: '⛔ This command is admin-only.',
    broadcastUsage: 'Usage: `/broadcast your message here`',
    broadcastDone: (sent, failed, total) => `📢 Broadcast sent.\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n👥 Total users: ${total}`,
  },
};

const OWNER_FOOTER = '\n\n━━━━━━━━━━━━━━━━━━\n👤 *Owner:* @heyrajprajapati';

// Inline "Buy Followers/Likes/Views" button - added to relevant messages.
const promoButtonRow = [{ text: '📈 Buy Followers/Likes/Views', url: PROMO_URL }];

function formatLabel(label) {
  return label
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatVehicleData(vehicleNumber, data) {
  let header = `🚘 *VEHICLE INFO*\n*Number:* \`${vehicleNumber}\`\n━━━━━━━━━━━━━━━━━━\n`;
  let body = '';

  if (typeof data === 'object' && data !== null) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        body += `▪️ *${formatLabel(key)}:* ${value}\n`;
      }
    });
  }

  if (!body) {
    body = 'No details available for this vehicle.\n';
  }

  return header + body + OWNER_FOOTER;
}

// ==== /start command ====
async function handleStart(chatId) {
  awaitingVehicleNumber.delete(chatId);
  await trackUser(chatId);
  const lang = await getLang(chatId);
  const t = TEXTS[lang];

  await bot.sendMessage(chatId, t.welcome + OWNER_FOOTER, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: t.vehicleInfoBtn, callback_data: 'vehicle_info' }],
        promoButtonRow,
      ],
    },
  });
}

// ==== /language command ====
async function handleLanguageCommand(chatId) {
  const lang = await getLang(chatId);
  const t = TEXTS[lang];
  await bot.sendMessage(chatId, t.langPrompt, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇮🇳 हिंदी', callback_data: 'lang_hi' },
          { text: '🇬🇧 English', callback_data: 'lang_en' },
        ],
      ],
    },
  });
}

// ==== /stats command (admin only) ====
async function handleStatsCommand(chatId, fromId) {
  const lang = await getLang(chatId);
  const t = TEXTS[lang];

  if (!isAdmin(fromId)) {
    await bot.sendMessage(chatId, t.notAdmin);
    return;
  }

  try {
    const [totalUsers, totalSearches, todaySearches, monthSearches] = await Promise.all([
      redis.scard(USERS_KEY),
      redis.get(STATS_TOTAL_KEY),
      redis.get(statsDailyKey(todayStr())),
      redis.get(statsMonthlyKey(monthStr())),
    ]);

    const msg =
      `📊 *Bot Stats*\n\n` +
      `👥 Total Users: ${totalUsers || 0}\n` +
      `🔍 Total Searches: ${totalSearches || 0}\n` +
      `📅 Today: ${todaySearches || 0}\n` +
      `🗓️ This Month: ${monthSearches || 0}`;

    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('stats error:', e.message);
    await bot.sendMessage(chatId, '❌ Stats fetch failed: ' + e.message);
  }
}

// ==== /broadcast command (admin only) ====
async function handleBroadcastCommand(chatId, fromId, fullText) {
  const lang = await getLang(chatId);
  const t = TEXTS[lang];

  if (!isAdmin(fromId)) {
    await bot.sendMessage(chatId, t.notAdmin);
    return;
  }

  const message = fullText.replace(/^\/broadcast/i, '').trim();
  if (!message) {
    await bot.sendMessage(chatId, t.broadcastUsage, { parse_mode: 'Markdown' });
    return;
  }

  let userIds = [];
  try {
    userIds = await redis.smembers(USERS_KEY);
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Could not load user list: ' + e.message);
    return;
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < userIds.length; i++) {
    try {
      await bot.sendMessage(userIds[i], message);
      sent++;
    } catch (e) {
      failed++;
    }
    // Small pause every 25 messages to stay safely under Telegram's rate limits.
    if (i % 25 === 24) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await bot.sendMessage(chatId, t.broadcastDone(sent, failed, userIds.length), { parse_mode: 'Markdown' });
}

// ==== Button click handler ====
async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;

  if (query.data === 'vehicle_info') {
    awaitingVehicleNumber.add(chatId);
    const lang = await getLang(chatId);
    const t = TEXTS[lang];

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, t.askNumber, { parse_mode: 'Markdown' });
    return;
  }

  if (query.data === 'lang_hi' || query.data === 'lang_en') {
    const newLang = query.data === 'lang_hi' ? 'hi' : 'en';
    await setLang(chatId, newLang);
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, TEXTS[newLang].langSet);
    return;
  }

  await bot.answerCallbackQuery(query.id).catch(() => {});
}

// ==== Handle plain text messages ====
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const fromId = msg.from ? msg.from.id : chatId;
  const text = msg.text ? msg.text.trim() : '';

  if (!text) return;

  await trackUser(chatId);

  if (text.startsWith('/start')) {
    await handleStart(chatId);
    return;
  }
  if (text.startsWith('/language')) {
    await handleLanguageCommand(chatId);
    return;
  }
  if (text.startsWith('/stats')) {
    await handleStatsCommand(chatId, fromId);
    return;
  }
  if (text.startsWith('/broadcast')) {
    await handleBroadcastCommand(chatId, fromId, text);
    return;
  }
  if (text.startsWith('/')) return; // unknown command, ignore

  if (!awaitingVehicleNumber.has(chatId)) return;

  const lang = await getLang(chatId);
  const t = TEXTS[lang];

  const vehicleNumber = text.toUpperCase().replace(/\s+/g, '');

  if (vehicleNumber.length < 8) {
    await bot.sendMessage(chatId, t.invalidFormat);
    return;
  }

  const loadingMsg = await bot.sendMessage(chatId, t.scanning);
  await trackSearch();

  try {
    const response = await axios.get(API_URL, {
      params: { vehicle: vehicleNumber },
      timeout: 20000,
    });

    const data = response.data;
    const vehicleData = data.data || data;

    if (data.success === false || !vehicleData) {
      await bot.editMessageText(t.notFound + OWNER_FOOTER, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [promoButtonRow] },
      });
    } else {
      const formatted = formatVehicleData(vehicleNumber, vehicleData);
      await bot.editMessageText(formatted, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [promoButtonRow] },
      });
    }
  } catch (error) {
    console.error('API Error:', error.message);

    let errorText = t.errorPrefix;
    if (error.response) {
      errorText += t.errorStatus(error.response.status);
    } else if (error.code === 'ECONNABORTED') {
      errorText += t.errorTimeout;
    } else {
      errorText += error.message;
    }

    await bot
      .editMessageText(errorText, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
      })
      .catch((editErr) => console.error('editMessageText failed:', editErr.message));
  } finally {
    awaitingVehicleNumber.delete(chatId);
    await bot.sendMessage(chatId, t.askAgain);
  }
}

// ==== Vercel serverless entry point ====
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('✅ Vehicle Info Bot webhook is alive. Set the webhook via /api/set-webhook.');
    return;
  }

  const update = req.body;

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error('Update handling error:', err.message);
  }

  res.status(200).send('OK');
};
