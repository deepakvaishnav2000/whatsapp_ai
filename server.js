const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const OpenAI = require('openai');
const twilio = require('twilio');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize services
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Database connection
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

db.connect()
    .then(() => console.log('Connected to PostgreSQL database'))
    .catch(err => console.error('Database connection error:', err));

// Available time slots
const TIME_SLOTS = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00', '17:30'
];

// Services offered
const SERVICES = {
    'haircut': { name: 'Haircut', duration: 30, price: 25 },
    'coloring': { name: 'Hair Coloring', duration: 60, price: 75 },
    'styling': { name: 'Hair Styling', duration: 45, price: 45 },
    'treatment': { name: 'Hair Treatment', duration: 90, price: 120 }
};

// Helper function to get or create user
async function getOrCreateUser(phoneNumber, name = null) {
    try {
        let result = await db.query('SELECT * FROM users WHERE phone = $1', [phoneNumber]);

        if (result.rows.length === 0) {
            const insertResult = await db.query(
                'INSERT INTO users (phone, name, created_at) VALUES ($1, $2, NOW()) RETURNING *',
                [phoneNumber, name || 'User']
            );
            return insertResult.rows[0];
        }

        return result.rows[0];
    } catch (error) {
        console.error('Error getting/creating user:', error);
        throw error;
    }
}

// Helper function to check availability
async function checkAvailability(date, time) {
    try {
        const result = await db.query(
            'SELECT COUNT(*) FROM appointments WHERE appointment_date = $1 AND appointment_time = $2 AND status != $3',
            [date, time, 'cancelled']
        );
        return parseInt(result.rows[0].count) === 0;
    } catch (error) {
        console.error('Error checking availability:', error);
        return false;
    }
}

// Helper function to get available slots for a date
async function getAvailableSlots(date) {
    try {
        const bookedSlots = await db.query(
            'SELECT appointment_time FROM appointments WHERE appointment_date = $1 AND status != $2',
            [date, 'cancelled']
        );

        const bookedTimes = bookedSlots.rows.map(row => row.appointment_time);
        return TIME_SLOTS.filter(slot => !bookedTimes.includes(slot));
    } catch (error) {
        console.error('Error getting available slots:', error);
        return TIME_SLOTS;
    }
}

// AI conversation handler
async function handleAIConversation(message, userPhone, conversationHistory) {
    try {
        const systemPrompt = `You are a helpful assistant for a hair salon appointment booking system. You can help customers:
1. Book appointments (ask for service, date, and time)
2. Check available time slots
3. Cancel existing appointments
4. Answer questions about services and pricing

Available services:
- Haircut: $25 (30 min)
- Hair Coloring: $75 (60 min) 
- Hair Styling: $45 (45 min)
- Hair Treatment: $120 (90 min)

Available time slots: ${TIME_SLOTS.join(', ')}
Working days: Monday to Saturday
Closed on Sundays

If a customer wants to book an appointment, collect:
1. Service type
2. Preferred date (format: YYYY-MM-DD)
3. Preferred time

If they need human assistance, tell them to reply with "AGENT" and we'll call them.

Keep responses concise and friendly. If they provide booking details, respond with "BOOKING_REQUEST" followed by the details.`;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: message }
            ],
            max_tokens: 150,
            temperature: 0.7
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API error:', error);
        return "I'm having trouble processing your request right now. Please try again or reply with 'AGENT' for human assistance.";
    }
}

// Save conversation to database
async function saveConversation(userPhone, userMessage, aiResponse) {
    try {
        await db.query(
            'INSERT INTO conversations (user_phone, user_message, ai_response, created_at) VALUES ($1, $2, $3, NOW())',
            [userPhone, userMessage, aiResponse]
        );
    } catch (error) {
        console.error('Error saving conversation:', error);
    }
}

// Get conversation history
async function getConversationHistory(userPhone, limit = 5) {
    try {
        const result = await db.query(
            'SELECT user_message, ai_response FROM conversations WHERE user_phone = $1 ORDER BY created_at DESC LIMIT $2',
            [userPhone, limit]
        );

        const history = [];
        result.rows.reverse().forEach(row => {
            history.push({ role: "user", content: row.user_message });
            history.push({ role: "assistant", content: row.ai_response });
        });

        return history;
    } catch (error) {
        console.error('Error getting conversation history:', error);
        return [];
    }
}

// Create appointment
async function createAppointment(userPhone, service, date, time) {
    try {
        const user = await getOrCreateUser(userPhone);
        const serviceInfo = SERVICES[service];

        if (!serviceInfo) {
            throw new Error('Invalid service');
        }

        const isAvailable = await checkAvailability(date, time);
        if (!isAvailable) {
            throw new Error('Time slot not available');
        }

        const result = await db.query(
            `INSERT INTO appointments (user_id, service_type, service_name, price, appointment_date, appointment_time, duration_minutes, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
            [user.id, service, serviceInfo.name, serviceInfo.price, date, time, serviceInfo.duration, 'confirmed']
        );

        return result.rows[0];
    } catch (error) {
        console.error('Error creating appointment:', error);
        throw error;
    }
}

// WhatsApp webhook handler
app.post('/webhook', async (req, res) => {
    try {
        const { Body, From, ProfileName } = req.body;
        const userPhone = From.replace('whatsapp:', '');
        const message = Body.trim();

        console.log(`Received message from ${userPhone}: ${message}`);

        // Get or create user
        await getOrCreateUser(userPhone, ProfileName);

        let responseMessage = '';

        // Handle special commands
        if (message.toUpperCase() === 'AGENT') {
            // Initiate voice call for human agent
            try {
                await twilioClient.calls.create({
                    to: userPhone,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    url: `${req.protocol}://${req.get('host')}/voice`,
                    method: 'POST'
                });
                responseMessage = "A human agent will call you shortly to assist with your appointment booking.";
            } catch (error) {
                console.error('Error initiating call:', error);
                responseMessage = "Sorry, I couldn't initiate a call right now. Please try again later or continue with text messages.";
            }
        } else if (message.toUpperCase() === 'MENU') {
            responseMessage = `Welcome to our salon! 💇‍♀️

Available services:
• Haircut - $25 (30 min)
• Hair Coloring - $75 (60 min)
• Hair Styling - $45 (45 min)
• Hair Treatment - $120 (90 min)

Reply with:
- Service name to check availability
- "AGENT" for human assistance
- "MENU" to see this menu again`;
        } else {
            // Get conversation history
            const conversationHistory = await getConversationHistory(userPhone);

            // Process with AI
            const aiResponse = await handleAIConversation(message, userPhone, conversationHistory);

            // Check if AI response indicates a booking request
            if (aiResponse.includes('BOOKING_REQUEST')) {
                // Parse booking details (this is a simplified example)
                // In a real implementation, you'd want more robust parsing
                responseMessage = "I'd be happy to help you book an appointment! Please provide:\n1. Service type (haircut, coloring, styling, or treatment)\n2. Preferred date (YYYY-MM-DD)\n3. Preferred time\n\nOr reply 'AGENT' to speak with someone directly.";
            } else {
                responseMessage = aiResponse;
            }

            // Save conversation
            await saveConversation(userPhone, message, responseMessage);
        }

        // Send response via WhatsApp
        await twilioClient.messages.create({
            body: responseMessage,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From
        });

        res.status(200).send('Message processed');

    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Error processing message');
    }
});

// Voice call handler for human agent escalation
app.post('/voice', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();

    twiml.say({
        voice: 'alice',
        language: 'en-US'
    }, 'Hello! Thank you for contacting our salon. A human agent will be with you shortly to help with your appointment booking. Please hold the line.');

    twiml.hold({
        music: 'http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3'
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// API endpoints
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: 'connected'
    });
});

app.get('/api/appointments/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const user = await getOrCreateUser(phone);

        const result = await db.query(
            'SELECT * FROM appointments WHERE user_id = $1 ORDER BY appointment_date DESC, appointment_time DESC',
            [user.id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

app.get('/api/availability/:date', async (req, res) => {
    try {
        const date = req.params.date;
        const availableSlots = await getAvailableSlots(date);
        res.json({ date, availableSlots });
    } catch (error) {
        console.error('Error checking availability:', error);
        res.status(500).json({ error: 'Failed to check availability' });
    }
});

// Daily reminder cron job (runs at 9 AM every day)
cron.schedule('0 9 * * *', async () => {
    try {
        console.log('Running daily appointment reminders...');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const result = await db.query(`
            SELECT a.*, u.phone, u.name 
            FROM appointments a 
            JOIN users u ON a.user_id = u.id 
            WHERE a.appointment_date = $1 AND a.status = $2
        `, [tomorrowStr, 'confirmed']);

        for (const appointment of result.rows) {
            const reminderMessage = `Hi ${appointment.name}! 👋

This is a reminder about your appointment tomorrow:
📅 Date: ${appointment.appointment_date}
⏰ Time: ${appointment.appointment_time}
💇‍♀️ Service: ${appointment.service_name}
💰 Price: $${appointment.price}

We look forward to seeing you! If you need to reschedule or cancel, please reply to this message.`;

            try {
                await twilioClient.messages.create({
                    body: reminderMessage,
                    from: process.env.TWILIO_WHATSAPP_NUMBER,
                    to: `whatsapp:${appointment.phone}`
                });
                console.log(`Reminder sent to ${appointment.phone}`);
            } catch (error) {
                console.error(`Failed to send reminder to ${appointment.phone}:`, error);
            }
        }

    } catch (error) {
        console.error('Error running reminder cron job:', error);
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp booking server running on port ${PORT}`);
});

module.exports = app;