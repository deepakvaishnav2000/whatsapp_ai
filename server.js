// server.js — WhatsApp Booking System for Render

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
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// WhatsApp webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const { Body, From, To } = req.body;

    // Log incoming message
    console.log(`WhatsApp message from ${From}: ${Body}`);

    // Save to conversations table
    await pool.query(
      `INSERT INTO conversations (user_phone, user_message, ai_response)
       VALUES ($1, $2, '')`,
      [From, Body]
    );

    // Generate AI response
    const chat = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an appointment-booking assistant.' },
        { role: 'user', content: Body }
      ],
      max_tokens: 150
    });
    const responseText = chat.choices[0].message.content.trim();

    // Update AI response in DB
    await pool.query(
      `UPDATE conversations
       SET ai_response = $1
       WHERE id = (
         SELECT id FROM conversations
         WHERE user_phone = $2
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [responseText, From]
    );

    // Send reply via Twilio
    await twilioClient.messages.create({
      body: responseText,
      from: To,
      to: From
    });

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error processing message');
  }
});

// Voice call fallback handler
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(
    'Thank you for calling. A representative will assist you shortly.'
  );
  res.type('text/xml').send(twiml.toString());
});

// Fetch user appointments
app.get('/api/appointments/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const result = await pool.query(
      `SELECT a.id,
              a.appointment_date,
              a.appointment_time,
              a.service_name,
              a.price,
              a.duration_minutes,
              a.status,
              u.name AS customer_name,
              u.email AS customer_email
       FROM appointments a
       JOIN users u ON a.user_id = u.id
       WHERE u.phone = $1
       ORDER BY a.appointment_date DESC`,
      [phone]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch appointments error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
