const express = require('express');
const { pool } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// Process payment
router.post('/process', authenticateJWT, async (req, res) => {
  try {
    const {
      product_id,
      amount,
      payment_method,
      phone_number,
      reference
    } = req.body;

    // Validation
    if (!product_id || !amount || !payment_method || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be filled'
      });
    }

    // Check if product exists and is active
    const product = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND is_active = true',
      [product_id]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or inactive'
      });
    }

    const productData = product.rows[0];

    // Check if user is not buying their own product
    if (productData.user_id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot buy your own product'
      });
    }

    // Check if amount matches product price
    if (parseFloat(amount) !== parseFloat(productData.price)) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount does not match product price'
      });
    }

    // Generate payment reference if not provided
    const paymentReference = reference || `TUKU-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create payment record
      const payment = await client.query(
        `INSERT INTO payments (
          user_id, product_id, amount, payment_method, 
          phone_number, reference, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          req.user.id, product_id, parseFloat(amount),
          payment_method, phone_number, paymentReference,
          'pending'
        ]
      );

      // Here you would integrate with the actual payment gateway API
      // For now, we'll simulate a successful payment
      // Example: MPesa API integration would go here

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update payment status to completed
      await client.query(
        'UPDATE payments SET status = $1, transaction_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['completed', `TXN-${Date.now()}`, payment.rows[0].id]
      );

      // Optionally mark product as sold
      await client.query(
        'UPDATE products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [product_id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Payment processed successfully',
        payment: {
          ...payment.rows[0],
          status: 'completed',
          transaction_id: `TXN-${Date.now()}`
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      
      // Update payment status to failed
      if (error.paymentId) {
        await pool.query(
          'UPDATE payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['failed', error.paymentId]
        );
      }
      
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment processing failed',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get user payments
router.get('/my-payments', authenticateJWT, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = `
      SELECT p.*, pr.title as product_title, pr.price as product_price,
             pr.image_url as product_image, s.username as seller_name
      FROM payments p
      JOIN products pr ON p.product_id = pr.id
      JOIN users s ON pr.user_id = s.id
      WHERE p.user_id = $1
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT p\..*, pr\.title as product_title,.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].count;

    // Execute main query
    const payments = await pool.query(query, params);

    res.json({
      success: true,
      payments: payments.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get payment details
router.get('/:id', authenticateJWT, async (req, res) => {
  try {
    const paymentId = req.params.id;

    const payment = await pool.query(
      `SELECT p.*, pr.title as product_title, pr.description as product_description,
              pr.image_url as product_image, s.username as seller_name,
              s.email as seller_email, s.phone as seller_phone
       FROM payments p
       JOIN products pr ON p.product_id = pr.id
       JOIN users s ON pr.user_id = s.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [paymentId, req.user.id]
    );

    if (payment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      payment: payment.rows[0]
    });

  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment details',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get seller sales
router.get('/seller/sales', authenticateJWT, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = `
      SELECT p.*, pr.title as product_title, pr.price as product_price,
             pr.image_url as product_image, b.username as buyer_name,
             b.email as buyer_email, b.phone as buyer_phone
      FROM payments p
      JOIN products pr ON p.product_id = pr.id
      JOIN users b ON p.user_id = b.id
      WHERE pr.user_id = $1
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT p\..*, pr\.title as product_title,.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].count;

    // Execute main query
    const sales = await pool.query(query, params);

    res.json({
      success: true,
      sales: sales.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get sales',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Cancel payment
router.post('/:id/cancel', authenticateJWT, async (req, res) => {
  try {
    const paymentId = req.params.id;

    // Check if payment exists and belongs to user
    const payment = await pool.query(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND status = $3',
      [paymentId, req.user.id, 'pending']
    );

    if (payment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found or cannot be cancelled'
      });
    }

    // Cancel payment
    await pool.query(
      'UPDATE payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cancelled', paymentId]
    );

    // Optionally reactivate product
    await pool.query(
      'UPDATE products SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [payment.rows[0].product_id]
    );

    res.json({
      success: true,
      message: 'Payment cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;