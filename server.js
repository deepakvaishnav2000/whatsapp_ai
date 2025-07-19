// server.js — WhatsApp Booking System for Render (Fixed Version)

const express = require('express');
const { Pool } = require('pg');
const twilio = require('twilio');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

// Use Render’s assigned port or default to 3000 for local dev
const PORT = process.env.PORT || 3000;

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper: Normalize WhatsApp phone numbers
function normalizeWhatsAppNumber(phoneNumber) {
  if (!phoneNumber) {
    console.error('Phone number is required');
    return null;
  }
  let clean = phoneNumber.replace(/^whatsapp:/, '').replace(/\s+/g, '');
  if (!clean.startsWith('+')) {
    console.error('Phone number must include country code with +');
    return null;
  }
  return `whatsapp:${clean}`;
}

// Helper: Truncate text to prevent DB errors
function truncateText(text = '', maxLength = 500) {
  if (text.length <= maxLength) return text;
  console.log(`Truncating text from ${text.length} to ${maxLength} characters`);
  return text.slice(0, maxLength);
}

// Root health endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'WhatsApp Booking System',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: '/webhook',
      voice: '/voice',
      health: '/health'
    }
  });
});

// Health check for Render
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// GET endpoint for webhook testing
app.get('/webhook', (req, res) => {
  res.status(200).send('Webhook endpoint is live');
});

// WhatsApp webhook handler - FIXED VERSION
app.post('/webhook', (req, res) => {
  // 1) Respond empty TwiML to satisfy Twilio
  res.set('Content-Type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // 2) Process asynchronously
  setImmediate(async () => {
    try {
      const { Body, From, To } = req.body;
      console.log(`WhatsApp message from ${From}: ${Body}`);

      // Truncate user message
      const userMessage = truncateText(Body, 500);

      // Insert conversation record
      try {
        await pool.query(
          'INSERT INTO conversations(user_phone, user_message, ai_response) VALUES($1,$2,\'\')',
          [From, userMessage]
        );
      } catch (dbErr) {
        console.error('Database insert error:', dbErr);
      }

      // Generate AI response
      let aiResponse = '';
      try {
        const chat = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are an appointment-booking assistant. Keep responses concise.' },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 100
        });
        aiResponse = truncateText(chat.choices[0].message.content.trim(), 500);
      } catch (aiErr) {
        console.error('OpenAI error:', aiErr);
        aiResponse = 'Sorry, I’m having trouble right now. Please try again later.';
      }

      // Update AI response in DB
      try {
        await pool.query(
          `UPDATE conversations
           SET ai_response = $1
           WHERE id = (
             SELECT id FROM conversations
             WHERE user_phone = $2
             ORDER BY created_at DESC
             LIMIT 1
           )`,
          [aiResponse, From]
        );
      } catch (updateErr) {
        console.error('Database update error:', updateErr);
      }

      // Send reply via Twilio REST API
      try {
        const toNumber = normalizeWhatsAppNumber(From);
        const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
        if (!toNumber || !fromNumber) throw new Error('Invalid WhatsApp number format');
        await twilioClient.messages.create({ body: aiResponse, from: fromNumber, to: toNumber });
        console.log(`Replied to ${toNumber}: ${aiResponse}`);
      } catch (twErr) {
        console.error('Twilio send error:', twErr);
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  });
});

// Voice call fallback handler
app.post('/voice', (req, res) => {
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for calling. A representative will assist you shortly.');
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Voice handler error:', err);
    res.status(500).send('Error processing voice call');
  }
});

// Fetch user appointments
app.get('/api/appointments/:phone', async (req, res) => {
  try {
    const raw = req.params.phone;
    const normalized = raw.replace(/^whatsapp:/, '');
    const result = await pool.query(
      `SELECT a.id, a.appointment_date, a.appointment_time, a.service_name, a.price,
              a.duration_minutes, a.status, u.name AS customer_name, u.email AS customer_email
       FROM appointments a
       JOIN users u ON a.user_id = u.id
       WHERE u.phone = $1 OR u.phone = $2
       ORDER BY a.appointment_date DESC`,
      [raw, normalized]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch appointments error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Create new appointment endpoint
app.post('/api/appointments', async (req, res) => {
  try {
    const { phone, service_name, appointment_date, appointment_time, price } = req.body;
    if (!phone || !service_name || !appointment_date || !appointment_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const normalized = phone.replace(/^whatsapp:/, '');
    let userResult = await pool.query('SELECT id FROM users WHERE phone = $1', [normalized]);
    let userId = userResult.rows[0]?.id;
    if (!userId) {
      const newUser = await pool.query(
        'INSERT INTO users (phone, name) VALUES ($1, $2) RETURNING id',
        [normalized, 'WhatsApp User']
      );
      userId = newUser.rows[0].id;
    }
    const appointment = await pool.query(
      `INSERT INTO appointments
       (user_id, service_name, appointment_date, appointment_time, price, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING *`,
      [userId, service_name, appointment_date, appointment_time, price || 0]
    );
    res.status(201).json(appointment.rows[0]);
  } catch (err) {
    console.error('Create appointment error:', err);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Uncaught exceptions
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
