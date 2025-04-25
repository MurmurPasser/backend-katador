const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const SECRET = process.env.JWT_SECRET || 'defaultsecret';

router.post('/register', (req, res) => {
    res.send('Usuario registrado');
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (email && password) {
        const token = jwt.sign({ email }, SECRET, { expiresIn: '1h' });

        res.json({
            message: 'Login exitoso',
            token
        });
    } else {
        res.status(400).json({ message: 'Email y contraseña requeridos' });
    }
});

module.exports = router;