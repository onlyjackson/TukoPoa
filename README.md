# TukuPoa Backend API

Backend API for TukuPoa Secondhand Marketplace built with Node.js, Express, and PostgreSQL.

## Features

- **User Authentication**: JWT-based authentication with registration, login, and profile management
- **Product Management**: CRUD operations for products with image uploads
- **Categories**: Product categorization system
- **Payments**: Integration with mobile money services (M-Pesa, Tigo Pesa, Airtel Money, Halo Pesa)
- **Messaging**: Real-time chat between buyers and sellers
- **Favorites**: Product favoriting system
- **Search & Filtering**: Advanced product search with multiple filters
- **File Uploads**: Product image uploads with validation
- **Security**: Input validation, rate limiting, and CORS protection

## Tech Stack

- **Node.js**: JavaScript runtime
- **Express**: Web framework
- **PostgreSQL**: Relational database
- **JWT**: Authentication
- **Multer**: File uploads
- **Helmet**: Security headers
- **Express-rate-limit**: Rate limiting
- **Validator**: Input validation

## Project Structure

```
backend/
├── config/
│   └── database.js          # Database configuration
├── middleware/
│   └── auth.js              # Authentication middleware
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── products.js          # Product routes
│   ├── categories.js        # Category routes
│   ├── payments.js          # Payment routes
│   ├── messages.js          # Messaging routes
│   └── users.js             # User routes
├── uploads/                 # File upload directory
├── .env                     # Environment variables
├── .env.example             # Environment variables example
├── package.json             # Package configuration
├── server.js                # Main server file
└── README.md                # This file
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Navigate to the backend directory
3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file based on `.env.example` and configure your environment variables
5. Create the uploads directory:

```bash
mkdir uploads
```

6. Start the server:

```bash
npm run dev  # Development mode with nodemon
# or
npm start    # Production mode
```

### Database Setup

The application will automatically create the database schema when you start the server. Make sure you have PostgreSQL running and the database credentials in `.env` are correct.

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/change-password` - Change password

### Products

- `GET /api/products` - Get all products (with filters)
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product
- `POST /api/products/:id/favorite` - Toggle favorite

### Categories

- `GET /api/categories` - Get all categories
- `GET /api/categories/:id` - Get single category
- `POST /api/categories` - Create category (admin)
- `PUT /api/categories/:id` - Update category (admin)
- `DELETE /api/categories/:id` - Delete category (admin)

### Payments

- `POST /api/payments/process` - Process payment
- `GET /api/payments/my-payments` - Get user payments
- `GET /api/payments/:id` - Get payment details
- `GET /api/payments/seller/sales` - Get seller sales
- `POST /api/payments/:id/cancel` - Cancel payment

### Messages

- `POST /api/messages` - Send message
- `GET /api/messages/conversations` - Get conversations
- `GET /api/messages/conversation/:user_id` - Get messages with user
- `GET /api/messages/unread-count` - Get unread message count
- `PUT /api/messages/read/:user_id` - Mark messages as read
- `DELETE /api/messages/:id` - Delete message

### Users

- `GET /api/users/:id` - Get user profile
- `GET /api/users/:id/products` - Get user products
- `GET /api/users/:id/favorites` - Get user favorites
- `PUT /api/users/:id` - Update user (admin)
- `DELETE /api/users/:id` - Delete user (admin)

## Environment Variables

See `.env.example` for all required environment variables.

## Security

- JWT authentication
- Input validation
- Rate limiting
- CORS protection
- Helmet security headers
- Password hashing with bcrypt

## Deployment

1. Set `NODE_ENV=production` in `.env`
2. Use a process manager like PM2
3. Set up a reverse proxy with Nginx
4. Configure SSL certificates
5. Use environment-specific database credentials

## License

MIT