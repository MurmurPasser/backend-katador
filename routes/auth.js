const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const users = [
  { email: 'test@correo.com', password: '123456' }
];

router.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Faltan campos' });
  users.push({ email, password });
  res.status(200).json({ message: 'Usuario registrado' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.status(200).json({ message: 'Login exitoso', token });
});

module.exports = router;
