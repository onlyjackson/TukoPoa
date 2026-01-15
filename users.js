const express = require('express');
const { pool } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await pool.query(
      `SELECT id, username, email, phone, first_name, last_name, 
              location, avatar_url, is_verified, role, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's active products
    const products = await pool.query(
      `SELECT p.*, 
              (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) as primary_image,
              (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as image_count
       FROM products p
       WHERE p.user_id = $1 AND p.is_active = true
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [userId]
    );

    // Get user statistics
    const stats = await pool.query(
      `SELECT 
         (SELECT COUNT(*) FROM products WHERE user_id = $1) as total_listings,
         (SELECT COUNT(*) FROM products WHERE user_id = $1 AND is_active = false) as sold_items,
         (SELECT COUNT(*) FROM payments WHERE product_id IN 
            (SELECT id FROM products WHERE user_id = $1)) as sales_count,
         (SELECT COUNT(*) FROM messages WHERE sender_id = $1 OR receiver_id = $1) as message_count
       FROM users WHERE id = $1`,
      [userId]
    );

    res.json({
      success: true,
      user: user.rows[0],
      products: products.rows,
      stats: stats.rows[0]
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get user's products
router.get('/:id/products', async (req, res) => {
  try {
    const userId = req.params.id;
    const { page = 1, limit = 20, is_active } = req.query;

    let query = `
      SELECT p.*, 
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) as primary_image,
             (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as image_count
      FROM products p
      WHERE p.user_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (is_active !== undefined) {
      query += ` AND p.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT p\..*, \(SELECT image_url.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].count;

    // Execute main query
    const products = await pool.query(query, params);

    res.json({
      success: true,
      products: products.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get user products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user products',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Update user profile (admin only)
router.put('/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    const { is_verified, role } = req.body;

    // Only admin can update these fields
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updatedUser = await pool.query(
      `UPDATE users SET is_verified = $1, role = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, username, email, phone, first_name, last_name, 
                location, avatar_url, is_verified, role, created_at, updated_at`,
      [is_verified, role, userId]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser.rows[0]
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;

    // Only admin can delete users
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Cannot delete own account
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const deletedUser = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING username',
      [userId]
    );

    if (deletedUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `User ${deletedUser.rows[0].username} deleted successfully`
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get user favorites
router.get('/:id/favorites', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    const { page = 1, limit = 20 } = req.query;

    // Users can only see their own favorites
    if (parseInt(userId) !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let query = `
      SELECT p.*, 
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) as primary_image,
             (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as image_count,
             u.username as seller_name,
             u.location as seller_location,
             f.created_at as favorited_at
      FROM favorites f
      JOIN products p ON f.product_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE f.user_id = $1 AND p.is_active = true
      ORDER BY f.created_at DESC
    `;

    const params = [userId];
    let paramIndex = 2;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT p\..*, \(SELECT image_url.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].count;

    // Execute main query
    const favorites = await pool.query(query, params);

    res.json({
      success: true,
      favorites: favorites.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get user favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user favorites',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;