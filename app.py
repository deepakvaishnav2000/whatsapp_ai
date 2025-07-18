import os
import json
import asyncio
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import openai
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse
from apscheduler.schedulers.background import BackgroundScheduler
import atexit

app = Flask(__name__)

# Configuration
openai.api_key = os.environ.get('OPENAI_API_KEY')
twilio_client = Client(
    os.environ.get('TWILIO_ACCOUNT_SID'),
    os.environ.get('TWILIO_AUTH_TOKEN')
)

# Database connection
def get_db_connection():
    return psycopg2.connect(
        os.environ.get('DATABASE_URL'),
        cursor_factory=RealDictCursor
    )

# Available time slots
TIME_SLOTS = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00', '17:30'
]

# Services offered
SERVICES = {
    'haircut': {'name': 'Haircut', 'duration': 30, 'price': 25},
    'coloring': {'name': 'Hair Coloring', 'duration': 60, 'price': 75},
    'styling': {'name': 'Hair Styling', 'duration': 45, 'price': 45},
    'treatment': {'name': 'Hair Treatment', 'duration': 90, 'price': 120}
}

def get_or_create_user(phone_number, name=None):
    """Get or create user in database"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute('SELECT * FROM users WHERE phone = %s', (phone_number,))
        user = cur.fetchone()

        if not user:
            cur.execute(
                'INSERT INTO users (phone, name, created_at) VALUES (%s, %s, NOW()) RETURNING *',
                (phone_number, name or 'User')
            )
            user = cur.fetchone()
            conn.commit()

        return user
    finally:
        cur.close()
        conn.close()

def check_availability(date, time):
    """Check if a time slot is available"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            'SELECT COUNT(*) FROM appointments WHERE appointment_date = %s AND appointment_time = %s AND status != %s',
            (date, time, 'cancelled')
        )
        count = cur.fetchone()[0]
        return count == 0
    finally:
        cur.close()
        conn.close()

def get_available_slots(date):
    """Get available time slots for a specific date"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            'SELECT appointment_time FROM appointments WHERE appointment_date = %s AND status != %s',
            (date, 'cancelled')
        )
        booked_times = [row[0] for row in cur.fetchall()]
        return [slot for slot in TIME_SLOTS if slot not in booked_times]
    finally:
        cur.close()
        conn.close()

def handle_ai_conversation(message, user_phone, conversation_history):
    """Handle AI conversation using OpenAI"""
    try:
        system_prompt = f"""You are a helpful assistant for a hair salon appointment booking system. You can help customers:
1. Book appointments (ask for service, date, and time)
2. Check available time slots
3. Cancel existing appointments
4. Answer questions about services and pricing

Available services:
- Haircut: $25 (30 min)
- Hair Coloring: $75 (60 min) 
- Hair Styling: $45 (45 min)
- Hair Treatment: $120 (90 min)

Available time slots: {', '.join(TIME_SLOTS)}
Working days: Monday to Saturday
Closed on Sundays

If a customer wants to book an appointment, collect:
1. Service type
2. Preferred date (format: YYYY-MM-DD)
3. Preferred time

If they need human assistance, tell them to reply with "AGENT" and we'll call them.

Keep responses concise and friendly. If they provide booking details, respond with "BOOKING_REQUEST" followed by the details."""

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(conversation_history)
        messages.append({"role": "user", "content": message})

        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=messages,
            max_tokens=150,
            temperature=0.7
        )

        return response.choices[0].message.content
    except Exception as e:
        print(f"OpenAI API error: {e}")
        return "I'm having trouble processing your request right now. Please try again or reply with 'AGENT' for human assistance."

def save_conversation(user_phone, user_message, ai_response):
    """Save conversation to database"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            'INSERT INTO conversations (user_phone, user_message, ai_response, created_at) VALUES (%s, %s, %s, NOW())',
            (user_phone, user_message, ai_response)
        )
        conn.commit()
    except Exception as e:
        print(f"Error saving conversation: {e}")
    finally:
        cur.close()
        conn.close()

def get_conversation_history(user_phone, limit=5):
    """Get conversation history for a user"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            'SELECT user_message, ai_response FROM conversations WHERE user_phone = %s ORDER BY created_at DESC LIMIT %s',
            (user_phone, limit)
        )
        rows = cur.fetchall()

        history = []
        for row in reversed(rows):
            history.append({"role": "user", "content": row['user_message']})
            history.append({"role": "assistant", "content": row['ai_response']})

        return history
    except Exception as e:
        print(f"Error getting conversation history: {e}")
        return []
    finally:
        cur.close()
        conn.close()

@app.route('/webhook', methods=['POST'])
def webhook():
    """WhatsApp webhook handler"""
    try:
        data = request.form
        message = data.get('Body', '').strip()
        from_number = data.get('From', '').replace('whatsapp:', '')
        profile_name = data.get('ProfileName')

        print(f"Received message from {from_number}: {message}")

        # Get or create user
        get_or_create_user(from_number, profile_name)

        response_message = ''

        # Handle special commands
        if message.upper() == 'AGENT':
            # Initiate voice call for human agent
            try:
                twilio_client.calls.create(
                    to=from_number,
                    from_=os.environ.get('TWILIO_PHONE_NUMBER'),
                    url=f"{request.scheme}://{request.host}/voice",
                    method='POST'
                )
                response_message = "A human agent will call you shortly to assist with your appointment booking."
            except Exception as e:
                print(f"Error initiating call: {e}")
                response_message = "Sorry, I couldn't initiate a call right now. Please try again later or continue with text messages."

        elif message.upper() == 'MENU':
            response_message = """Welcome to our salon! 💇‍♀️

Available services:
• Haircut - $25 (30 min)
• Hair Coloring - $75 (60 min)
• Hair Styling - $45 (45 min)
• Hair Treatment - $120 (90 min)

Reply with:
- Service name to check availability
- "AGENT" for human assistance
- "MENU" to see this menu again"""

        else:
            # Get conversation history
            conversation_history = get_conversation_history(from_number)

            # Process with AI
            ai_response = handle_ai_conversation(message, from_number, conversation_history)

            # Check if AI response indicates a booking request
            if 'BOOKING_REQUEST' in ai_response:
                response_message = "I'd be happy to help you book an appointment! Please provide:\n1. Service type (haircut, coloring, styling, or treatment)\n2. Preferred date (YYYY-MM-DD)\n3. Preferred time\n\nOr reply 'AGENT' to speak with someone directly."
            else:
                response_message = ai_response

            # Save conversation
            save_conversation(from_number, message, response_message)

        # Send response via WhatsApp
        twilio_client.messages.create(
            body=response_message,
            from_=os.environ.get('TWILIO_WHATSAPP_NUMBER'),
            to=f"whatsapp:{from_number}"
        )

        return 'Message processed', 200

    except Exception as e:
        print(f"Error processing webhook: {e}")
        return 'Error processing message', 500

@app.route('/voice', methods=['POST'])
def voice():
    """Voice call handler for human agent escalation"""
    response = VoiceResponse()
    response.say(
        'Hello! Thank you for contacting our salon. A human agent will be with you shortly to help with your appointment booking. Please hold the line.',
        voice='alice',
        language='en-US'
    )
    response.hold(music='http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3')

    return str(response), 200, {'Content-Type': 'text/xml'}

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'database': 'connected'
    })

@app.route('/api/appointments/<phone>')
def get_appointments(phone):
    """Get appointments for a phone number"""
    try:
        user = get_or_create_user(phone)

        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            'SELECT * FROM appointments WHERE user_id = %s ORDER BY appointment_date DESC, appointment_time DESC',
            (user['id'],)
        )
        appointments = cur.fetchall()

        cur.close()
        conn.close()

        return jsonify([dict(apt) for apt in appointments])
    except Exception as e:
        print(f"Error fetching appointments: {e}")
        return jsonify({'error': 'Failed to fetch appointments'}), 500

@app.route('/api/availability/<date>')
def get_availability(date):
    """Get available slots for a date"""
    try:
        available_slots = get_available_slots(date)
        return jsonify({'date': date, 'availableSlots': available_slots})
    except Exception as e:
        print(f"Error checking availability: {e}")
        return jsonify({'error': 'Failed to check availability'}), 500

def send_daily_reminders():
    """Send daily appointment reminders"""
    try:
        print('Running daily appointment reminders...')

        tomorrow = datetime.now() + timedelta(days=1)
        tomorrow_str = tomorrow.strftime('%Y-%m-%d')

        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT a.*, u.phone, u.name 
            FROM appointments a 
            JOIN users u ON a.user_id = u.id 
            WHERE a.appointment_date = %s AND a.status = %s
        """, (tomorrow_str, 'confirmed'))

        appointments = cur.fetchall()

        for appointment in appointments:
            reminder_message = f"""Hi {appointment['name']}! 👋

This is a reminder about your appointment tomorrow:
📅 Date: {appointment['appointment_date']}
⏰ Time: {appointment['appointment_time']}
💇‍♀️ Service: {appointment['service_name']}
💰 Price: ${appointment['price']}

We look forward to seeing you! If you need to reschedule or cancel, please reply to this message."""

            try:
                twilio_client.messages.create(
                    body=reminder_message,
                    from_=os.environ.get('TWILIO_WHATSAPP_NUMBER'),
                    to=f"whatsapp:{appointment['phone']}"
                )
                print(f"Reminder sent to {appointment['phone']}")
            except Exception as e:
                print(f"Failed to send reminder to {appointment['phone']}: {e}")

        cur.close()
        conn.close()

    except Exception as e:
        print(f"Error running reminder cron job: {e}")

# Set up scheduler for daily reminders
scheduler = BackgroundScheduler()
scheduler.add_job(
    func=send_daily_reminders,
    trigger="cron",
    hour=9,
    minute=0
)
scheduler.start()

# Shut down the scheduler when exiting the app
atexit.register(lambda: scheduler.shutdown())

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)