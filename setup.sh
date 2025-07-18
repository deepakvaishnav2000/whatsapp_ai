#!/bin/bash

# WhatsApp Booking System Setup Script
# This script helps you configure your environment variables

echo "==================================="
echo "WhatsApp Booking System Setup"
echo "==================================="
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Copy example file
cp .env.example .env

echo "📝 Please provide the following information:"
echo ""

# Collect Twilio information
echo "🔹 Twilio Configuration:"
read -p "Enter your Twilio Account SID: " TWILIO_SID
read -p "Enter your Twilio Auth Token: " TWILIO_TOKEN
read -p "Enter your Twilio WhatsApp Number (e.g., +14155238886): " TWILIO_WHATSAPP
read -p "Enter your Twilio Phone Number for voice calls: " TWILIO_PHONE

echo ""

# Collect OpenAI information
echo "🔹 OpenAI Configuration:"
read -p "Enter your OpenAI API Key: " OPENAI_KEY

echo ""

# Collect Database information
echo "🔹 Database Configuration:"
read -p "Enter your PostgreSQL Database URL: " DATABASE_URL

echo ""

# Update .env file
sed -i "s/TWILIO_ACCOUNT_SID=.*/TWILIO_ACCOUNT_SID=$TWILIO_SID/" .env
sed -i "s/TWILIO_AUTH_TOKEN=.*/TWILIO_AUTH_TOKEN=$TWILIO_TOKEN/" .env
sed -i "s|TWILIO_WHATSAPP_NUMBER=.*|TWILIO_WHATSAPP_NUMBER=$TWILIO_WHATSAPP|" .env
sed -i "s|TWILIO_PHONE_NUMBER=.*|TWILIO_PHONE_NUMBER=$TWILIO_PHONE|" .env
sed -i "s/OPENAI_API_KEY=.*/OPENAI_API_KEY=$OPENAI_KEY/" .env
sed -i "s|DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" .env

echo "✅ Configuration saved to .env file"
echo ""
echo "📋 Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Set up your database using database_schema.sql"
echo "3. Configure Twilio webhook to point to your app"
echo "4. Start the application: npm start"
echo ""
echo "🚀 For Render deployment, upload these files to GitHub and follow the README instructions."