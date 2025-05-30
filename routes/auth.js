// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// Registro y login (ya los tenías)

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Obtener el plan desde MySQL
    const [rows] = await req.mysql.execute(
      `SELECT nombre_plan FROM planes_usuario WHERE usuario_id = ? ORDER BY id DESC LIMIT 1`,
      [user._id.toString()]
    );

    const nombre_plan = rows.length > 0 ? rows[0].nombre_plan : 'gratis';

    // Incluir el plan en la respuesta
    res.status(200).json({
      _id: user._id,
      email: user.email,
      alias: user.alias,
      role: user.role,
      plan: nombre_plan
    });
  } catch (err) {
    console.error('Error en /me:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

module.exports = router;
