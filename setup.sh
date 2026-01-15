#!/bin/bash

echo "🚀 Setting up TukuPoa Backend..."

# Create uploads directory
echo "📁 Creating uploads directory..."
mkdir -p uploads

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "🔧 Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created. Please update with your configuration."
fi

# Check if PostgreSQL is running
echo "🗄️ Checking database connection..."
pg_isready -h localhost -p 5432 > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "⚠️  PostgreSQL is not running. Please start PostgreSQL before running the server."
    echo "   sudo service postgresql start"
else
    echo "✅ PostgreSQL is running."
fi

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "🚀 To start the server:"
echo "   npm run dev     # Development mode"
echo "   npm start       # Production mode"
echo ""
echo "🔍 Health check will be available at: http://localhost:5000/api/health"