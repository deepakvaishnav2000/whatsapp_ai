-- WhatsApp Booking System Database Schema for PostgreSQL
-- This schema is optimized for Render's PostgreSQL service

-- Create database (this will be created automatically by Render)
-- CREATE DATABASE whatsapp_booking;

-- Use the database
-- \c whatsapp_booking;

-- Enable UUID extension for unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) DEFAULT 'User',
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Services table
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    service_key VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time slots table
CREATE TABLE IF NOT EXISTS time_slots (
    id SERIAL PRIMARY KEY,
    time_slot TIME NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    day_of_week INTEGER, -- 0=Sunday, 1=Monday, etc. NULL means all days
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type VARCHAR(50),
    service_name VARCHAR(100),
    price DECIMAL(10,2),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(appointment_date, appointment_time)
);

-- Conversations table for storing chat history
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_phone VARCHAR(20) NOT NULL,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX(user_phone, created_at)
);

-- System settings table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(user_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

-- Insert default services
INSERT INTO services (service_key, name, description, price, duration_minutes) VALUES
('haircut', 'Haircut', 'Professional hair cutting service', 25.00, 30),
('coloring', 'Hair Coloring', 'Hair coloring and highlighting service', 75.00, 60),
('styling', 'Hair Styling', 'Hair styling for special occasions', 45.00, 45),
('treatment', 'Hair Treatment', 'Deep conditioning and hair treatment', 120.00, 90)
ON CONFLICT (service_key) DO NOTHING;

-- Insert default time slots
INSERT INTO time_slots (time_slot) VALUES
('09:00:00'), ('09:30:00'), ('10:00:00'), ('10:30:00'),
('11:00:00'), ('11:30:00'), ('12:00:00'), ('12:30:00'),
('14:00:00'), ('14:30:00'), ('15:00:00'), ('15:30:00'),
('16:00:00'), ('16:30:00'), ('17:00:00'), ('17:30:00')
ON CONFLICT DO NOTHING;

-- Insert system settings
INSERT INTO settings (setting_key, setting_value, description) VALUES
('business_hours_start', '09:00', 'Business opening time'),
('business_hours_end', '18:00', 'Business closing time'),
('closed_days', 'Sunday', 'Days when business is closed'),
('max_advance_booking_days', '30', 'Maximum days in advance for booking'),
('reminder_hours_before', '24', 'Hours before appointment to send reminder'),
('business_name', 'Hair Salon', 'Name of the business'),
('business_phone', '', 'Business contact phone number'),
('business_address', '', 'Business address')
ON CONFLICT (setting_key) DO NOTHING;

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a view for appointment details with user information
CREATE OR REPLACE VIEW appointment_details AS
SELECT 
    a.id,
    a.appointment_date,
    a.appointment_time,
    a.service_name,
    a.price,
    a.duration_minutes,
    a.status,
    a.notes,
    a.created_at,
    u.name as customer_name,
    u.phone as customer_phone,
    u.email as customer_email
FROM appointments a
JOIN users u ON a.user_id = u.id;

-- Sample data for testing (optional - remove in production)
-- INSERT INTO users (phone, name) VALUES ('+1234567890', 'Test User');
-- INSERT INTO appointments (user_id, service_type, service_name, price, appointment_date, appointment_time, duration_minutes) 
-- VALUES (1, 'haircut', 'Haircut', 25.00, CURRENT_DATE + INTERVAL '1 day', '10:00:00', 30);

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

COMMIT;