// server.js — WhatsApp Booking System for Render (Fixed Version)

const express = require('express');
const { Pool } = require('pg');
const twilio = require('twilio');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

// Use Render's assigned port or default to 3000 for local dev
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

// Helper function to normalize WhatsApp phone numbers
function normalizeWhatsAppNumber(phoneNumber) {
  if (!phoneNumber) {
    console.error('Phone number is required');
    return null;
  }
  
  // Remove any existing 'whatsapp:' prefix
  let cleanNumber = phoneNumber.replace(/^whatsapp:/, '');
  
  // Ensure it starts with '+'
  if (!cleanNumber.startsWith('+')) {
    console.error('Phone number must include country code with +');
    return null;
  }
  
  // Add 'whatsapp:' prefix
  return `whatsapp:${cleanNumber}`;
}

// Helper function to truncate text for database storage
function truncateText(text, maxLength = 500) {
  if (!text) return '';
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

// GET endpoint for webhook testing
app.get('/webhook', (req, res) => {
  res.status(200).send('Webhook endpoint is live');
});

// WhatsApp webhook handler - FIXED VERSION
app.post('/webhook', async (req, res) => {
  // Step 1: ALWAYS respond 200 OK immediately to prevent Twilio timeout
  res.status(200).send('OK');
  
  try {
    const { Body, From, To } = req.body;
    
    // Log incoming message
    console.log(`WhatsApp message from ${From}: ${Body}`);
    
    // Step 2: Truncate message for database storage (prevents 22001 error)
    const MAX_MESSAGE_LENGTH = 500;
    const userMessage = truncateText(Body, MAX_MESSAGE_LENGTH);
    
    // Step 3: Save to conversations table with error handling
    try {
      await pool.query(
        `INSERT INTO conversations (user_phone, user_message, ai_response)
         VALUES ($1, $2, '')`,
        [From, userMessage]
      );
    } catch (dbErr) {
      console.error('Database insert error:', dbErr);
      // Continue processing even if DB insert fails
    }
    
    // Step 4: Generate AI response with length limits
    let responseText = '';
    try {
      const chat = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are an appointment-booking assistant. Keep responses under 100 words and be helpful and friendly.' 
          },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 100 // Reduced to prevent long responses
      });
      responseText = chat.choices[0].message.content.trim();
      
      // Truncate AI response for database storage
      responseText = truncateText(responseText, MAX_MESSAGE_LENGTH);
      
    } catch (aiErr) {
      console.error('OpenAI error:', aiErr);
      responseText = 'Sorry, I\'m having trouble right now. Please try again later or call us directly.';
    }
    
    // Step 5: Update AI response in database with error handling
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
        [responseText, From]
      );
    } catch (updateErr) {
      console.error('Database update error:', updateErr);
      // Continue with message sending even if DB update fails
    }
    
    // Step 6: Send reply via Twilio with proper number formatting (prevents 21211 error)
    try {
      // Normalize phone numbers to proper WhatsApp format
      const normalizedFrom = normalizeWhatsAppNumber(From);
      const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER || normalizeWhatsAppNumber(To);
      
      if (!normalizedFrom || !twilioWhatsAppNumber) {
        throw new Error('Invalid phone number format');
      }
      
      await twilioClient.messages.create({
        body: responseText,
        from: twilioWhatsAppNumber,  // Your Twilio WhatsApp number
        to: normalizedFrom           // Customer's WhatsApp number
      });
      
      console.log(`Reply sent to ${normalizedFrom}: ${responseText}`);
      
    } catch (twilioErr) {
      console.error('Twilio send error:', twilioErr);
      // Log the error but don't crash the application
    }
    
  } catch (err) {
    console.error('General webhook error:', err);
    // Don't throw - we already sent 200 OK to Twilio
  }
});

// Voice call fallback handler
app.post('/voice', (req, res) => {
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(
      'Thank you for calling. A representative will assist you shortly.'
    );
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Voice handler error:', err);
    res.status(500).send('Error processing voice call');
  }
});

// Fetch user appointments
app.get('/api/appointments/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    
    // Normalize phone number for database lookup
    const normalizedPhone = phone.replace(/^whatsapp:/, '');
    
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
       WHERE u.phone = $1 OR u.phone = $2
       ORDER BY a.appointment_date DESC`,
      [phone, normalizedPhone]
    );
    
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch appointments error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Create new appointment (bonus endpoint)
app.post('/api/appointments', async (req, res) => {
  try {
    const { phone, service_name, appointment_date, appointment_time, price } = req.body;
    
    if (!phone || !service_name || !appointment_date || !appointment_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Normalize phone number
    const normalizedPhone = phone.replace(/^whatsapp:/, '');
    
    // Check if user exists, create if not
    let userResult = await pool.query(
      'SELECT id FROM users WHERE phone = $1',
      [normalizedPhone]
    );
    
    let userId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query(
        'INSERT INTO users (phone, name) VALUES ($1, $2) RETURNING id',
        [normalizedPhone, 'WhatsApp User']
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
    }
    
    // Create appointment
    const appointment = await pool.query(
      `INSERT INTO appointments 
       (user_id, service_name, appointment_date, appointment_time, price, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') 
       RETURNING *`,
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

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp Booking System server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});

module.exports = app;
