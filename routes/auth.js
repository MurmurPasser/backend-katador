// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { role, alias, phone, email, password } = req.body;
  try {
    const user = new User({
      role,
      alias,
      phone: (role === 'modelo' && phone?.trim() !== '') ? phone.trim() : undefined,
      email,
      password
    });
    await user.save();
    res.status(201).json({ message: 'Usuario registrado exitosamente.', userId: user._id });
  } catch (error) {
    console.error('Error en registro:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'El correo ya está registrado.' });
    }
    res.status(500).json({ message: 'Error interno en el registro.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && await user.matchPassword(password)) {
      const token = jwt.sign(
        { id: user._id, role: user.role, email: user.email, alias: user.alias },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.status(200).json({
        message: 'Login exitoso',
        token,
        user: {
          id: user._id,
          alias: user.alias,
          email: user.email,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ message: 'Correo o contraseña inválidos.' });
    }
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno en el login.' });
  }
});

// GET /api/auth/me (ya lo tienes)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    let nombre_plan = 'gratis';
    if (req.mysql) {
      const [rows] = await req.mysql.execute(
        `SELECT nombre_plan FROM planes_usuario WHERE usuario_id = ? ORDER BY fecha_expiracion DESC LIMIT 1`,
        [user._id.toString()]
      );
      if (rows.length > 0) nombre_plan = rows[0].nombre_plan;
    }

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
