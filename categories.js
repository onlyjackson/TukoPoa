const express = require('express');
const { pool } = require('../config/database');
const { authenticateJWT, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
  try {
    const categories = await pool.query(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = true) as product_count
       FROM categories c
       ORDER BY c.name ASC`
    );

    res.json({
      success: true,
      categories: categories.rows
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Get single category
router.get('/:id', async (req, res) => {
  try {
    const categoryId = req.params.id;

    const category = await pool.query(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = true) as product_count
       FROM categories c
       WHERE c.id = $1`,
      [categoryId]
    );

    if (category.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      category: category.rows[0]
    });

  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get category',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Create category (admin only)
router.post('/', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const { name, icon, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category already exists
    const existingCategory = await pool.query(
      'SELECT * FROM categories WHERE name = $1',
      [name]
    );

    if (existingCategory.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    const newCategory = await pool.query(
      'INSERT INTO categories (name, icon, description) VALUES ($1, $2, $3) RETURNING *',
      [name, icon, description]
    );

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category: newCategory.rows[0]
    });

  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Update category (admin only)
router.put('/:id', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { name, icon, description } = req.body;

    // Check if category exists
    const existingCategory = await pool.query(
      'SELECT * FROM categories WHERE id = $1',
      [categoryId]
    );

    if (existingCategory.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if new name conflicts with existing category
    if (name && name !== existingCategory.rows[0].name) {
      const nameConflict = await pool.query(
        'SELECT * FROM categories WHERE name = $1 AND id != $2',
        [name, categoryId]
      );

      if (nameConflict.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists'
        });
      }
    }

    const updatedCategory = await pool.query(
      'UPDATE categories SET name = $1, icon = $2, description = $3 WHERE id = $4 RETURNING *',
      [name || existingCategory.rows[0].name, icon, description, categoryId]
    );

    res.json({
      success: true,
      message: 'Category updated successfully',
      category: updatedCategory.rows[0]
    });

  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

// Delete category (admin only)
router.delete('/:id', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const categoryId = req.params.id;

    // Check if category exists
    const existingCategory = await pool.query(
      'SELECT * FROM categories WHERE id = $1',
      [categoryId]
    );

    if (existingCategory.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has products
    const productCount = await pool.query(
      'SELECT COUNT(*) FROM products WHERE category_id = $1',
      [categoryId]
    );

    if (parseInt(productCount.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with existing products'
      });
    }

    await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category',
      error: process.env.NODE_ENV === 'production' ? null : error.message
    });
  }
});

module.exports = router;