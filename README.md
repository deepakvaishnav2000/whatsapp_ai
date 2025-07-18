# WhatsApp Appointment Booking System

A complete WhatsApp-based appointment booking system with AI integration, built for easy deployment on Render.

## Features

- 🤖 **AI-Powered Conversations** using OpenAI GPT-3.5
- 📱 **WhatsApp Integration** via Twilio WhatsApp API
- 📅 **Appointment Management** with real-time availability
- 🔔 **Automated Reminders** sent 24 hours before appointments
- 📞 **Human Agent Escalation** via voice calls
- 💾 **PostgreSQL Database** for data persistence
- 🚀 **Render-Ready Deployment** with one-click setup

## Quick Start on Render

### Prerequisites
1. **GitHub Account** - to store your code
2. **Render Account** - sign up at [render.com](https://render.com)
3. **Twilio Account** - for WhatsApp API
4. **OpenAI Account** - for AI conversations

### Step 1: Upload to GitHub
1. Create a new repository on GitHub
2. Upload all these files using drag and drop
3. Make sure all files are in the root directory

### Step 2: Deploy on Render

#### Create PostgreSQL Database
1. In Render dashboard, click "New +" → "PostgreSQL"
2. Choose a name like "whatsapp-booking-db"
3. Select the free plan (or paid for production)
4. Click "Create Database"
5. **Copy the External Database URL** - you'll need this

#### Create Web Service
1. In Render dashboard, click "New +" → "Web Service"
2. Connect your GitHub repository
3. Configure the service:
   - **Name**: whatsapp-booking-system
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or paid for production)

#### Set Environment Variables
In the Environment tab, add these variables:

```
NODE_ENV=production
DATABASE_URL=[paste your PostgreSQL External Database URL here]
TWILIO_ACCOUNT_SID=[your Twilio Account SID]
TWILIO_AUTH_TOKEN=[your Twilio Auth Token]
TWILIO_WHATSAPP_NUMBER=[your Twilio WhatsApp number, e.g., +14155238886]
TWILIO_PHONE_NUMBER=[your Twilio phone number for voice calls]
OPENAI_API_KEY=[your OpenAI API key]
```

#### Deploy
1. Click "Create Web Service"
2. Wait for deployment to complete
3. Copy your service URL (e.g., `https://your-app.onrender.com`)

### Step 3: Setup Database
1. Connect to your PostgreSQL database using a tool like pgAdmin or DBeaver
2. Use the connection details from Render
3. Run the SQL commands from `database_schema.sql` to create tables

### Step 4: Configure Twilio Webhook
1. In Twilio Console, go to WhatsApp Sandbox or your approved WhatsApp number
2. Set the webhook URL to: `https://your-app.onrender.com/webhook`
3. Set the HTTP method to `POST`

## API Configuration

### Required API Keys

#### Twilio Setup
1. Sign up at [twilio.com](https://www.twilio.com)
2. Get your Account SID and Auth Token from the dashboard
3. For testing: Enable WhatsApp Sandbox and note the sandbox number
4. For production: Apply for WhatsApp Business API approval

#### OpenAI Setup
1. Sign up at [openai.com](https://platform.openai.com)
2. Create an API key in the API keys section
3. Add billing information and set usage limits

## Usage

### Customer Interaction Flow
1. **Customer texts the WhatsApp number**
2. **AI responds** with menu and booking options
3. **Appointment booking** through natural conversation
4. **Confirmation** sent via WhatsApp
5. **Reminder** sent 24 hours before appointment
6. **Human escalation** available by typing "AGENT"

### Admin Features
- View all appointments via API endpoints
- Check availability for specific dates
- Monitor system health

## API Endpoints

- `POST /webhook` - WhatsApp message webhook
- `POST /voice` - Voice call webhook for human escalation
- `GET /health` - System health check
- `GET /api/appointments/:phone` - Get user appointments
- `GET /api/availability/:date` - Check availability for date

## File Structure

```
├── server.js              # Main Node.js server
├── app.py                 # Alternative Python Flask server
├── package.json           # Node.js dependencies
├── requirements.txt       # Python dependencies
├── database_schema.sql    # PostgreSQL database schema
├── .env.example          # Environment variables template
├── README.md             # This file
└── render.yaml           # Render deployment configuration
```

## Alternative: Python Flask Deployment

If you prefer Python, you can deploy the Flask version instead:

1. In Render Web Service settings:
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`

## Troubleshooting

### Common Issues

**Database Connection Error**
- Verify your DATABASE_URL environment variable
- Ensure PostgreSQL database is running
- Check if database schema has been created

**Twilio Webhook Not Working**
- Verify webhook URL is correct and accessible
- Check that your service is deployed and running
- Ensure Twilio webhook is set to POST method

**OpenAI API Errors**
- Verify your API key is correct
- Check your OpenAI account has sufficient credits
- Ensure you haven't exceeded rate limits

### Logs and Monitoring
- View logs in Render dashboard under your service
- Monitor health endpoint: `https://your-app.onrender.com/health`
- Check database connections and API responses

## Customization

### Adding New Services
1. Update the SERVICES object in `server.js` or `app.py`
2. Add new services to the database via the services table
3. Update the AI prompt to include new services

### Modifying Time Slots
1. Update the TIME_SLOTS array in your main file
2. Update the database time_slots table
3. Restart the service

### Changing Business Hours
1. Update system settings in the database
2. Modify the AI prompt with new hours
3. Update reminder schedules if needed

## Security Best Practices

- Never commit `.env` files with real credentials
- Use environment variables for all sensitive data
- Enable webhook signature verification in production
- Regularly rotate API keys
- Monitor usage and set billing alerts

## Support

For issues with:
- **Render deployment**: Check Render documentation
- **Twilio setup**: Refer to Twilio WhatsApp API docs
- **OpenAI integration**: See OpenAI API documentation

## License

MIT License - feel free to modify and use for your business needs.