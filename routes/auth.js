const express = require('express');
const router = express.Router();

router.post('/register', (req, res) => {
  // lógica de registro
  res.send('Usuario registrado');
});

router.post('/login', (req, res) => {
  // lógica de login
  res.send('Usuario logueado');
});

module.exports = router;
