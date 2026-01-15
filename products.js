const express = require('express');
const { pool } = require('../config/database');
const { authenticateJWT, optionalAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const validator = require('validator');

const router = express.Router();

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (JPEG, JPG, PNG, WEBP)'));
    }
  }
});

// Create product
router.post('/', authenticateJWT, upload.array('images', 10), async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      original_price,
      category_id,
      condition,
      condition_rating,
      functionality_rating,
      location,
      latitude,
      longitude,
      is_negotiable,
      is_hot_sale,
      discount_percentage
    } = req.body;

    // Validation
    if (!title || !description || !price || !category_id || !condition || !location) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be filled'
      });
    }

    if (!validator.isNumeric(price) || parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a positive number'
      });
    }

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create product
      const productResult = await client.query(
        `INSERT INTO products (
          user_id, category_id, title, description, price, original_price,
          condition, condition_rating, functionality_rating, location,
          latitude, longitude, is_negotiable, is_hot_sale, discount_percentage
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          req.user.id, category_id, title, description, parseFloat(price),
          original_price ? parseFloat(original_price) : null,
          condition, condition_rating, functionality_rating, location,
          latitude ? parseFloat(latitude) : null,
          longitude ? parseFloat(longitude) : null,
          is_negotiable === 'true', is_hot_sale === 'true',
          discount_percentage ? parseInt(discount_percentage) : null
        ]
      );

      const product = productResult.rows[0];

      // Upload images
      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req.files.length; i++) {
          const imageUrl = `/uploads/${req.files[i].filename}`;
          await client.query(
            'INSERT INTO product_images (product_id, image_url, is_primary) VALUES ($1, $2, $3)',
            [product.id, imageUrl, i === 0]
          );
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        product
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get all products with filters
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      location,
      min_price,
      max_price,
      condition,
      sort_by = 'created_at',
      order = 'desc',
      page = 1,
      limit = 20,
      search
    } = req.query;

    let query = `
      SELECT p.*, u.username, u.location as seller_location,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1) as primary_image,
             (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) as image_count,
             (SELECT COUNT(*) FROM favorites WHERE product_id = p.id) as favorite_count
      FROM products p
      JOIN users u ON p.user_id = u.id
      WHERE p.is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    // Apply filters
    if (category) {
      query += ` AND p.category_id = $${paramIndex}`;
      params.push(parseInt(category));
      paramIndex++;
    }

    if (location) {
      query += ` AND p.location ILIKE $${paramIndex}`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    if (min_price) {
      query += ` AND p.price >= $${paramIndex}`;
      params.push(parseFloat(min_price));
      paramIndex++;
    }

    if (max_price) {
      query += ` AND p.price <= $${paramIndex}`;
      params.push(parseFloat(max_price));
      paramIndex++;
    }

    if (condition) {
      query += ` AND p.condition = $${paramIndex}`;
      params.push(condition);
      paramIndex++;
    }

    if (search) {
      query += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add user-specific filters if authenticated
    if (req.user) {
      // Optionally exclude user's own products
      if (req.query.exclude_my_products === 'true') {
        query += ` AND p.user_id != $${paramIndex}`;
        params.push(req.user.id);
        paramIndex++;
      }
    }

    // Add sorting
    const validSortFields = ['created_at', 'price', 'views', 'favorite_count'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = order.toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    query += ` ORDER BY p.${sortField} ${sortOrder}`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    // Get total count
    const countQuery = query.replace(/SELECT p\..*, u\.username, u\.location as seller_location,.*FROM/, 'SELECT COUNT(*) FROM');
    const countParams = params.slice(0, -2); // Remove limit and offset
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
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get products',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get single product
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const productId = req.params.id;

    // Get product with seller info
    const product = await pool.query(
      `SELECT p.*, u.username, u.email, u.phone, u.location as seller_location, u.avatar_url as seller_avatar
       FROM products p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = $1 AND p.is_active = true`,
      [productId]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Get images
    const images = await pool.query(
      'SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, id ASC',
      [productId]
    );

    // Get favorite status if user is authenticated
    let isFavorite = false;
    if (req.user) {
      const favorite = await pool.query(
        'SELECT * FROM favorites WHERE product_id = $1 AND user_id = $2',
        [productId, req.user.id]
      );
      isFavorite = favorite.rows.length > 0;
    }

    // Increment view count
    await pool.query(
      'UPDATE products SET views = views + 1 WHERE id = $1',
      [productId]
    );

    res.json({
      success: true,
      product: {
        ...product.rows[0],
        images: images.rows,
        is_favorite: isFavorite
      }
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get product',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Update product
router.put('/:id', authenticateJWT, upload.array('images', 10), async (req, res) => {
  try {
    const productId = req.params.id;

    // Check if product exists and belongs to user
    const existingProduct = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND user_id = $2',
      [productId, req.user.id]
    );

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission'
      });
    }

    const {
      title,
      description,
      price,
      original_price,
      category_id,
      condition,
      condition_rating,
      functionality_rating,
      location,
      latitude,
      longitude,
      is_negotiable,
      is_hot_sale,
      discount_percentage,
      is_active
    } = req.body;

    // Update product
    const updatedProduct = await pool.query(
      `UPDATE products SET 
        title = $1, description = $2, price = $3, original_price = $4,
        category_id = $5, condition = $6, condition_rating = $7,
        functionality_rating = $8, location = $9, latitude = $10,
        longitude = $11, is_negotiable = $12, is_hot_sale = $13,
        discount_percentage = $14, is_active = $15, updated_at = CURRENT_TIMESTAMP
      WHERE id = $16 AND user_id = $17
      RETURNING *`,
      [
        title, description, parseFloat(price),
        original_price ? parseFloat(original_price) : null,
        category_id, condition, condition_rating,
        functionality_rating, location,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null,
        is_negotiable === 'true', is_hot_sale === 'true',
        discount_percentage ? parseInt(discount_percentage) : null,
        is_active === 'true', productId, req.user.id
      ]
    );

    // Handle new images
    if (req.files && req.files.length > 0) {
      // Optionally delete old images if needed
      if (req.body.delete_old_images === 'true') {
        await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      }

      // Add new images
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/${req.files[i].filename}`;
        await pool.query(
          'INSERT INTO product_images (product_id, image_url, is_primary) VALUES ($1, $2, $3)',
          [productId, imageUrl, i === 0]
        );
      }
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct.rows[0]
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Delete product
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const productId = req.params.id;

    // Check if product exists and belongs to user
    const existingProduct = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND user_id = $2',
      [productId, req.user.id]
    );

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission'
      });
    }

    // Delete product (cascades to images and favorites)
    await pool.query('DELETE FROM products WHERE id = $1', [productId]);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Toggle favorite
router.post('/:id/favorite', authenticateJWT, async (req, res) => {
  try {
    const productId = req.params.id;

    // Check if product exists
    const product = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND is_active = true',
      [productId]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if already favorited
    const existingFavorite = await pool.query(
      'SELECT * FROM favorites WHERE product_id = $1 AND user_id = $2',
      [productId, req.user.id]
    );

    if (existingFavorite.rows.length > 0) {
      // Remove favorite
      await pool.query(
        'DELETE FROM favorites WHERE product_id = $1 AND user_id = $2',
        [productId, req.user.id]
      );

      res.json({
        success: true,
        message: 'Product removed from favorites',
        is_favorite: false
      });
    } else {
      // Add favorite
      await pool.query(
        'INSERT INTO favorites (product_id, user_id) VALUES ($1, $2)',
        [productId, req.user.id]
      );

      res.json({
        success: true,
        message: 'Product added to favorites',
        is_favorite: true
      });
    }

  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update favorite status',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;