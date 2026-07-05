/**
 * Visit this endpoint ONCE after deploying to Vercel, to tell Telegram
 * where to send updates:
 *
 *   https://<your-project>.vercel.app/api/set-webhook?secret=YOUR_SETUP_SECRET
 *
 * Protected by SETUP_SECRET so randoms can't repoint your bot's webhook.
 */

const TelegramBot = require('node-telegram-bot-api');

module.exports = async (req, res) => {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SETUP_SECRET = process.env.SETUP_SECRET;

  if (!BOT_TOKEN) {
    res.status(500).json({ success: false, error: 'BOT_TOKEN not set in environment variables.' });
    return;
  }

  if (!SETUP_SECRET || req.query.secret !== SETUP_SECRET) {
    res.status(403).json({ success: false, error: 'Forbidden. Add ?secret=YOUR_SETUP_SECRET (matching the SETUP_SECRET env var).' });
    return;
  }

  const bot = new TelegramBot(BOT_TOKEN);
  const webhookUrl = `https://${req.headers.host}/api/webhook`;

  try {
    const result = await bot.setWebHook(webhookUrl);
    const info = await bot.getWebHookInfo();
    res.status(200).json({ success: true, webhookUrl, telegramResponse: result, webhookInfo: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
