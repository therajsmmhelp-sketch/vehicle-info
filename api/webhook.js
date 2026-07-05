/**
 * 🔍 Vehicle Info Tracker - Telegram Bot (Webhook version for Vercel)
 * By Ahir Ankush
 *
 * IMPORTANT: We do NOT rely on bot.on('message', ...) event listeners here.
 * On Vercel, once this function sends an HTTP response, the serverless
 * instance can be frozen/killed - even if an event-listener callback is
 * still awaiting something (like an axios call). So instead we directly
 * handle the incoming update object and `await` every step, only sending
 * the response to Telegram once ALL work (including the vehicle API call
 * and message edit) is fully done.
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = 'https://vehicle-info-api-acko.vercel.app/info';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing! Set it in Vercel Project Settings -> Environment Variables.');
}

// No polling, no webHook:true - we manually feed updates in in module.exports below.
const bot = new TelegramBot(BOT_TOKEN);

// Best-effort state (see README note on statelessness across invocations).
const awaitingVehicleNumber = new Set();

// ==== Format vehicle data nicely for Telegram ====
function formatLabel(label) {
  return label
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatVehicleData(vehicleNumber, data) {
  let text = `✅ *Vehicle Data Found: ${vehicleNumber}*\n\n`;

  if (typeof data === 'object' && data !== null) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        text += `*${formatLabel(key)}:* ${value}\n`;
      }
    });
  }

  if (text === `✅ *Vehicle Data Found: ${vehicleNumber}*\n\n`) {
    text += 'No details available for this vehicle.';
  }

  return text;
}

// ==== /start command ====
async function handleStart(chatId) {
  awaitingVehicleNumber.delete(chatId);

  await bot.sendMessage(
    chatId,
    '👋 *Welcome to Vehicle Info Tracker!*\n\nRegistered vehicle details nikalne ke liye niche button dabao.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚗 Vehicle Info', callback_data: 'vehicle_info' }],
        ],
      },
    }
  );
}

// ==== Button click handler ====
async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;

  if (query.data === 'vehicle_info') {
    awaitingVehicleNumber.add(chatId);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      '📝 Vehicle number bhejo.\n\nExample: `DL01AB1234`',
      { parse_mode: 'Markdown' }
    );
  } else {
    // Unknown callback - still ack it so Telegram doesn't show a loading spinner forever.
    await bot.answerCallbackQuery(query.id).catch(() => {});
  }
}

// ==== Handle plain text messages (vehicle number input) ====
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  if (text.startsWith('/start')) {
    await handleStart(chatId);
    return;
  }

  if (!text || text.startsWith('/')) return;
  if (!awaitingVehicleNumber.has(chatId)) return;

  const vehicleNumber = text.toUpperCase().replace(/\s+/g, '');

  if (vehicleNumber.length < 8) {
    await bot.sendMessage(
      chatId,
      '⚠️ Invalid vehicle number format! Minimum 8 characters chahiye (e.g. DL01AB1234). Dobara bhejo.'
    );
    return;
  }

  const loadingMsg = await bot.sendMessage(chatId, '🔎 Scanning... please wait.');

  try {
    const response = await axios.get(API_URL, {
      params: { vehicle: vehicleNumber },
      timeout: 20000,
    });

    const data = response.data;
    const vehicleData = data.data || data;

    if (data.success === false || !vehicleData) {
      await bot.editMessageText(
        '⚠️ Vehicle not found in database. Please check the registration number and try again.',
        { chat_id: chatId, message_id: loadingMsg.message_id }
      );
    } else {
      const formatted = formatVehicleData(vehicleNumber, vehicleData);
      await bot.editMessageText(formatted, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
      });
    }
  } catch (error) {
    console.error('API Error:', error.message);

    let errorText = '❌ *Error fetching vehicle data.*\n\n';
    if (error.response) {
      errorText += `Status: ${error.response.status}\nPlease check the vehicle number and try again.`;
    } else if (error.code === 'ECONNABORTED') {
      errorText += 'Request timed out. Please try again.';
    } else {
      errorText += `${error.message}`;
    }

    await bot.editMessageText(errorText, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
    }).catch((editErr) => console.error('editMessageText failed:', editErr.message));
  } finally {
    awaitingVehicleNumber.delete(chatId);
    await bot.sendMessage(chatId, 'Ek aur vehicle check karna hai? /start dabao.');
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

  // Respond ONLY after all the above awaited work is fully complete -
  // this is what stops Vercel from freezing the function mid-work.
  res.status(200).send('OK');
};
