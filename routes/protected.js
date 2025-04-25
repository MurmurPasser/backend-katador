const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');

router.get('/protected', authMiddleware, (req, res) => {
  res.status(200).json({ message: 'Ruta protegida accedida correctamente', user: req.user });
});

module.exports = router;
