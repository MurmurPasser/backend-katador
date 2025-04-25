const express = require('express');
const router = express.Router();

router.post('/register', (req, res) => {
    res.send("Usuario registrado");
});

router.post('/login', (req, res) => {
    res.send("Usuario logueado");
});

module.exports = router;