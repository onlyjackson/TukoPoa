const express = require('express');
const { pool } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// Send message
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const { receiver_id, product_id, content } = req.body;

    // Validation
    if (!receiver_id || !content) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID and message content are required'
      });
    }

    // Check if receiver exists
    const receiver = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [receiver_id]
    );

    if (receiver.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Check if product exists (if provided)
    if (product_id) {
      const product = await pool.query(
        'SELECT * FROM products WHERE id = $1',
        [product_id]
      );

      if (product.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }
    }

    // Create message
    const message = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, product_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, receiver_id, product_id, content]
    );

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message.rows[0]
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get user conversations
router.get('/conversations', authenticateJWT, async (req, res) => {
  try {
    // Get unique conversations (users that have exchanged messages with the current user)
    const conversations = await pool.query(`
      SELECT DISTINCT ON (other_user.id)
        other_user.id as user_id,
        other_user.username,
        other_user.avatar_url,
        other_user.phone,
        last_msg.content as last_message,
        last_msg.created_at as last_message_time,
        last_msg.is_read,
        (SELECT COUNT(*) FROM messages 
         WHERE (sender_id = other_user.id AND receiver_id = $1 AND is_read = false)) as unread_count
      FROM (
        SELECT sender_id as other_id FROM messages WHERE receiver_id = $1
        UNION
        SELECT receiver_id as other_id FROM messages WHERE sender_id = $1
      ) as conversation_users
      JOIN users other_user ON conversation_users.other_id = other_user.id
      JOIN messages last_msg ON (
        (last_msg.sender_id = $1 AND last_msg.receiver_id = other_user.id) OR
        (last_msg.sender_id = other_user.id AND last_msg.receiver_id = $1)
      )
      WHERE other_user.id != $1
      ORDER BY other_user.id, last_msg.created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      conversations: conversations.rows
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversations',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get messages between two users
router.get('/conversation/:user_id', authenticateJWT, async (req, res) => {
  try {
    const otherUserId = req.params.user_id;
    const { product_id, page = 1, limit = 50 } = req.query;

    // Check if user exists
    const user = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [otherUserId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let query = `
      SELECT m.*, 
             sender.username as sender_name,
             sender.avatar_url as sender_avatar,
             receiver.username as receiver_name,
             receiver.avatar_url as receiver_avatar,
             p.title as product_title,
             p.image_url as product_image
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      LEFT JOIN products p ON m.product_id = p.id
      WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR 
             (m.sender_id = $2 AND m.receiver_id = $1))
    `;

    const params = [req.user.id, otherUserId];
    let paramIndex = 3;

    if (product_id) {
      query += ` AND m.product_id = $${paramIndex}`;
      params.push(product_id);
      paramIndex++;
    }

    query += ` ORDER BY m.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT m\..*, sender\.username as sender_name,.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].count;

    // Execute main query
    const messages = await pool.query(query, params);

    // Mark messages as read
    await pool.query(
      'UPDATE messages SET is_read = true WHERE receiver_id = $1 AND sender_id = $2',
      [req.user.id, otherUserId]
    );

    res.json({
      success: true,
      messages: messages.rows.reverse(), // Reverse to show oldest first
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      },
      other_user: user.rows[0]
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get unread message count
router.get('/unread-count', authenticateJWT, async (req, res) => {
  try {
    const unreadCount = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      success: true,
      unread_count: parseInt(unreadCount.rows[0].count)
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread message count',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Mark messages as read
router.put('/read/:user_id', authenticateJWT, async (req, res) => {
  try {
    const otherUserId = req.params.user_id;

    await pool.query(
      'UPDATE messages SET is_read = true WHERE receiver_id = $1 AND sender_id = $2',
      [req.user.id, otherUserId]
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Mark messages read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Delete message (soft delete could be implemented here)
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const messageId = req.params.id;

    // Check if message exists and belongs to user
    const message = await pool.query(
      'SELECT * FROM messages WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)',
      [messageId, req.user.id]
    );

    if (message.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or you do not have permission'
      });
    }

    // Delete message
    await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;