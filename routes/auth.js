// File: routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// ------------------
//  Registro (POST /api/auth/register)
// ------------------
router.post('/register', async (req, res) => {
  const { role, alias, phone, email, password } = req.body;
  try {
    const user = new User({
      role,
      alias,
      phone: (role === 'modelo' && phone && phone.trim() !== '') ? phone.trim() : undefined,
      email,
      password
    });
    await user.save();

    // Generar token al registrar
    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email, alias: user.alias },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Usuario registrado exitosamente.',
      userId: user._id,
      token: token,
      user: {
        id: user._id,
        role: user.role,
        alias: user.alias,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error durante el registro:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
    }
    res.status(500).json({ message: 'Error interno del servidor durante el registro.' });
  }
});

// ------------------
//  Login (POST /api/auth/login)
// ------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Por favor, ingrese correo electrónico y contraseña.' });
  }
  try {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
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
          role: user.role,
          alias: user.alias,
          email: user.email
        }
      });
    } else {
      res.status(401).json({ message: 'Credenciales inválidas (correo o contraseña incorrectos).' });
    }
  } catch (error) {
    console.error('Error durante el login:', error);
    res.status(500).json({ message: 'Error interno del servidor durante el login.' });
  }
});

// ------------------
//  Obtener datos del usuario (GET /api/auth/me)
// ------------------
router.get('/me', authMiddleware, (req, res) => {
  try {
    res.status(200).json({
      user: {
        id: req.user.id,
        _id: req.user.id,
        role: req.user.role,
        alias: req.user.alias,
        email: req.user.email
      }
    });
  } catch (error) {
    console.error('Error en /auth/me:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

module.exports = router;
