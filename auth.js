const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const validator = require('validator');

const router = express.Router();

// Registration endpoint
router.post('/register', async (req, res) => {
  try {
    const { username, email, phone, password, first_name, last_name, location } = req.body;

    // Validation
    if (!username || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be filled'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (!validator.isMobilePhone(phone, ['en-TZ'])) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2 OR phone = $3',
      [username, email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, or phone number already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await pool.query(
      `INSERT INTO users (username, email, phone, password, first_name, last_name, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, email, phone, first_name, last_name, location, role, created_at`,
      [username, email, phone, hashedPassword, first_name, last_name, location]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.rows[0].id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: newUser.rows[0],
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password required'
      });
    }

    // Find user
    const user = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.rows[0].id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Remove password from response
    const { password: _, ...userData } = user.rows[0];

    res.json({
      success: true,
      message: 'Login successful',
      user: userData,
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get current user
router.get('/me', authenticateJWT, async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT id, username, email, phone, first_name, last_name, location, avatar_url, 
              is_verified, role, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user.rows[0]
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Update user profile
router.put('/profile', authenticateJWT, async (req, res) => {
  try {
    const { first_name, last_name, location, avatar_url } = req.body;

    const updatedUser = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, location = $3, 
                       avatar_url = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, username, email, phone, first_name, last_name, location, 
                avatar_url, is_verified, role, created_at, updated_at`,
      [first_name, last_name, location, avatar_url, req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Change password
router.put('/change-password', authenticateJWT, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Current and new password required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get current password
    const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    
    // Check current password
    const isMatch = await bcrypt.compare(current_password, user.rows[0].password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;