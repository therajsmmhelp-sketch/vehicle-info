/**
 * 🔍 Vehicle Info Tracker - Telegram Bot (Webhook version for Vercel)
 * By Ahir Ankush
 *
 * This file replaces polling with a webhook. Telegram calls this endpoint
 * (POST /api/webhook) whenever a user sends a message/button click.
 * No long-running process needed -> works on Vercel's free serverless plan.
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ==== CONFIG ====
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = 'https://vehicle-info-api-acko.vercel.app/info';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing! Set it in Vercel Project Settings -> Environment Variables.');
}

// No polling, no built-in webhook listener - we call bot.processUpdate() ourselves below.
const bot = new TelegramBot(BOT_TOKEN);

// Tracks which chats are currently expected to send a vehicle number.
// NOTE: Serverless functions are stateless between invocations on Vercel's
// free plan (each request may run on a fresh instance), so this in-memory
// Set is only a best-effort convenience, not a durable store. See README
// for a note on making this persistent if you need it to be 100% reliable.
const awaitingVehicleNumber = new Set();

// ==== /start command ====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  awaitingVehicleNumber.delete(chatId); // reset any previous state

  bot.sendMessage(
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
});

// ==== Button click handler ====
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === 'vehicle_info') {
    awaitingVehicleNumber.add(chatId);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      '📝 Vehicle number bhejo.\n\nExample: `DL01AB1234`',
      { parse_mode: 'Markdown' }
    );
  }
});

// ==== Handle plain text messages (vehicle number input) ====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  // Ignore commands and non-text, and only act if we're expecting a number
  if (!text || text.startsWith('/')) return;
  if (!awaitingVehicleNumber.has(chatId)) return;

  const vehicleNumber = text.toUpperCase().replace(/\s+/g, '');

  if (vehicleNumber.length < 8) {
    await bot.sendMessage(
      chatId,
      '⚠️ Invalid vehicle number format! Minimum 8 characters chahiye (e.g. DL01AB1234). Dobara bhejo.'
    );
    return; // keep awaiting state on, let them retry
  }

  const loadingMsg = await bot.sendMessage(chatId, '🔎 Scanning... please wait.');

  try {
    const response = await axios.get(API_URL, {
      params: { vehicle: vehicleNumber },
      timeout: 15000,
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
    });
  } finally {
    // Ask again if they want another lookup
    awaitingVehicleNumber.delete(chatId);
    await bot.sendMessage(chatId, 'Ek aur vehicle check karna hai? /start dabao.');
  }
});

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

// ==== Vercel serverless entry point ====
// Telegram sends a POST request with the update JSON body every time
// something happens (message, button click, etc.)
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('✅ Vehicle Info Bot webhook is alive. Set the webhook via /api/set-webhook.');
    return;
  }

  try {
    await bot.processUpdate(req.body);
  } catch (err) {
    console.error('processUpdate error:', err.message);
  }

  // Always respond 200 quickly so Telegram doesn't retry the same update.
  res.status(200).send('OK');
};
