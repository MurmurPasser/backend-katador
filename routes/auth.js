// routes/auth.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// 🎯 ENDPOINT DE REGISTRO
router.post('/register', async (req, res) => {
    try {
        const { alias, email, password, role, phone } = req.body;

        // Validaciones básicas
        if (!email || !password || !role || !alias) {
            return res.status(400).json({ message: 'Todos los campos (alias, email, password, role) son obligatorios.' });
        }
        if (role === 'modelo' && !phone) {
            return res.status(400).json({ message: 'El teléfono es obligatorio para el rol de modelo.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'El correo electrónico ya está registrado.' });
        }

        const newUser = new User({
            alias,
            // Asignar créditos iniciales solo si el rol es 'modelo'
            creditos_actuales: role === 'modelo' ? 10 : 0,
            role,
            phone: (role === 'modelo' && phone && phone.trim() !== '') ? phone.trim() : undefined,
            email,
            password
        });
        await newUser.save();

        // --- INICIO DE LA CORRECCIÓN ---
        // Generar token inmediatamente después del registro
        const token = jwt.sign(
            { id: newUser._id, role: newUser.role, alias: newUser.alias, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Devolver respuesta unificada con token y datos del usuario
        res.status(201).json({
            success: true,
            token,
            user: {
                _id: newUser._id,
                alias: newUser.alias,
                email: newUser.email,
                role: newUser.role,
                creditos_actuales: newUser.creditos_actuales
            }
        });
        // --- FIN DE LA CORRECCIÓN ---

    } catch (error) {
        console.error('Error durante el registro:', error);
        res.status(500).json({ message: 'Error interno del servidor al intentar registrar el usuario.', error: error.message });
    }
});


// 🎯 ENDPOINT DE LOGIN
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email y password son requeridos.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role, alias: user.alias, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                alias: user.alias,
                email: user.email,
                role: user.role,
                creditos_actuales: user.creditos_actuales
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

module.exports = router;
