const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

router.get('/protected', authMiddleware, (req, res) => {
  res.status(200).json({
    message: '¡Bienvenido! Has accedido a una ruta protegida.',
    userInfo: req.user
  });
});

module.exports = router;
