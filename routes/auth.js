const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const users = [];

router.post('/register', (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Faltan campos (email, password o role)' });
  }
  users.push({ email, password, role });
  res.status(200).json({ message: 'Usuario registrado correctamente' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign({ email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.status(200).json({ message: 'Login exitoso', token });
});

module.exports = router;
