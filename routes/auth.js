// ✅ Archivo: routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// Registro y login (ya los tenías aquí arriba)

// ✅ GET /api/auth/me  → devuelve los datos del usuario autenticado + plan desde MySQL
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    // Obtener plan desde MySQL (por defecto: gratis)
    let nombre_plan = 'gratis';
    if (req.mysql) {
      try {
        const [rows] = await req.mysql.execute(
          `SELECT nombre_plan FROM planes_usuario WHERE usuario_id = ? ORDER BY fecha_expiracion DESC LIMIT 1`,
          [user._id.toString()]
        );
        if (rows.length > 0) {
          nombre_plan = rows[0].nombre_plan;
        }
      } catch (mysqlErr) {
        console.error('Error al consultar plan en MySQL:', mysqlErr);
      }
    }

    // Enviar respuesta final
    res.status(200).json({
      user: {
        _id: user._id,
        email: user.email,
        alias: user.alias,
        role: user.role,
        nombre_plan
      }
    });
  } catch (err) {
    console.error('Error en /me:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

module.exports = router;
