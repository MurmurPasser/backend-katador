const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

// Register
router.post('/register', async (req, res) => {
  const { email, password, alias, role, phone } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hash, alias, role, phone });
    await user.save();
    res.json({ message: 'Usuario registrado' });
  } catch (err) {
    res.status(500).json({ message: 'Error en servidor' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Usuario no encontrado' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Contraseña incorrecta' });
    const token = jwt.sign(
      { email: user.email, role: user.role, alias: user.alias },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ message: 'Login exitoso', token });
  } catch (err) {
    res.status(500).json({ message: 'Error en servidor' });
  }
});

module.exports = router;