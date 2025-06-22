// File: routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authMiddleware =require('../middleware/authMiddleware'); // <-- El import ya existía, lo cual es correcto.
const mysql = require('mysql2/promise');

const poolMySqlRailway = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 🚀 Verificar conexión MySQL al iniciar
(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    console.log("✅ Conexión a MySQL de Railway (para planes) establecida y probada con ping.");
    await testConn.ping();
  } catch (err) {
    console.error("❌ FALLO INICIAL al conectar a MySQL:", err.message);
  } finally {
    if (testConn) testConn.release();
  }
})();

// ------------------
//  Registro (POST /api/auth/register)
// ------------------
router.post('/register', async (req, res) => {
  try {
    const { email, password, alias, role, phone } = req.body;

    // 1) Validar campos obligatorios
    if (!email || !password || !alias || !role) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    // 2) Verificar que no exista ya en MongoDB
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "El usuario ya existe." });
    }

    // 3) Crear usuario en MongoDB (hash de password se hace en pre 'save')
    const newUser = new User({ email, password, alias, role, phone });
    await newUser.save();

    // 4) Insertar en la tabla `usuarios` de MySQL:
    const mysqlConn = await poolMySqlRailway.getConnection();
    try {
      const [insertResult] = await mysqlConn.execute(
        `INSERT INTO usuarios 
           (mongodb_id, nombre_usuario, correo, password_hash, tipo_usuario, estado) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newUser._id.toString(),
          alias,
          email,
          '',       // ← password_hash vacío para no romper NOT NULL
          role,
          'activo'
        ]
      );
      const usuario_id = insertResult.insertId;

      // 5) Crear plan por defecto "Gratis" (duración 30 días)
      const fechaInicio = new Date();
      const fechaExp    = new Date();
      fechaExp.setDate(fechaInicio.getDate() + 30);

      const fechaInicioStr = fechaInicio.toISOString().slice(0, 19).replace('T', ' ');
      const fechaExpStr    = fechaExp.toISOString().slice(0, 19).replace('T', ' ');

      await mysqlConn.execute(
        `INSERT INTO planes_usuario
           (usuario_id, nombre_plan, fecha_inicio, fecha_expiracion)
         VALUES (?, ?, ?, ?)`,
        [usuario_id, 'Gratis', fechaInicioStr, fechaExpStr]
      );

      // 6) Asignar créditos iniciales (3) en creditos_usuario
      await mysqlConn.execute(
        `INSERT INTO creditos_usuario
           (usuario_id, creditos_actuales)
         VALUES (?, ?)`,
        [usuario_id, 3]
      );
    } finally {
      mysqlConn.release();
    }

    // 7) Generar JWT (MongoDB) y devolver al cliente
    const token = jwt.sign({ id: newUser._id, role: newUser.role, alias: newUser.alias, email: newUser.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({ success: true, token });

  } catch (err) {
    console.error("❌ Error en /register:", err);
    return res.status(500).json({ message: "Error al registrar el usuario." });
  }
});

// ------------------
//  Login (POST /api/auth/login)
// ------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // 1) Buscar usuario en MongoDB
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Credenciales inválidas." });
    }

    // 2) Comparar contraseña
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Credenciales inválidas." });
    }

    // 3) Generar JWT y devolver
    const token = jwt.sign({ id: user._id, role: user.role, alias: user.alias, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });

  } catch (err) {
    console.error("❌ Error en /login:", err);
    return res.status(500).json({ message: "Error al iniciar sesión." });
  }
});


// ------------------
//  Obtener datos del usuario (/api/auth/me) - VERSIÓN SIMPLIFICADA PARA AUTH_SYNC
// ------------------
// Este endpoint es usado por auth_sync.php para validar el token.
// Devuelve directamente la información contenida en el token sin consultar la base de datos,
// lo cual es mucho más rápido y eficiente para este propósito.
router.get('/me', authMiddleware, (req, res) => {
    try {
        // El middleware 'authMiddleware' ya ha validado el token y ha puesto
        // los datos del usuario en 'req.user'. Simplemente los devolvemos.
        res.status(200).json({
            user: {
                id: req.user.id,
                _id: req.user.id, // Se incluye _id por consistencia
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
