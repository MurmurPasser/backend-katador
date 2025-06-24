// File: routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const mysql = require('mysql2/promise');

// Función centralizada para errores
function sendError(res, status, code, message, field = null) {
  const payload = { success: false, code, message };
  if (field) payload.field = field;
  return res.status(status).json(payload);
}

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

// Verificar conexión MySQL
(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    console.log("✅ Conexión a MySQL establecida");
    await testConn.ping();
  } catch (err) {
    console.error("❌ Error al conectar a MySQL:", err.message);
  } finally {
    if (testConn) testConn.release();
  }
})();

// Registro de usuario
router.post('/register', async (req, res) => {
  try {
    const { email, password, alias, role, phone } = req.body;

    if (!email || !password || !alias || !role) {
      return sendError(res, 400, "MISSING_FIELDS", "Faltan campos obligatorios.", "email");
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return sendError(res, 400, "EMAIL_ALREADY_EXISTS", "Ya existe un usuario con ese correo.", "email");
    }
    const newUser = new User({ email, password, alias, role, phone });
    await newUser.save();

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
          'external_auth_only',
          role,
          'activo'
        ]
      );

      const usuario_id = insertResult.insertId;

      const fechaInicio = new Date();
      const fechaExp = new Date();
      fechaExp.setDate(fechaInicio.getDate() + 30);

      const fechaInicioStr = fechaInicio.toISOString().slice(0, 19).replace('T', ' ');
      const fechaExpStr = fechaExp.toISOString().slice(0, 19).replace('T', ' ');

      await mysqlConn.execute(
        `INSERT INTO planes_usuario
          (usuario_id, nombre_plan, fecha_inicio, fecha_expiracion)
        VALUES (?, ?, ?, ?)`,
        [usuario_id, 'Gratis', fechaInicioStr, fechaExpStr]
      );

      await mysqlConn.execute(
        `INSERT INTO creditos_usuario
          (usuario_id, creditos_actuales)
        VALUES (?, ?)`,
        [usuario_id, 3]
      );
    } finally {
      mysqlConn.release();
    }

    const token = jwt.sign(
      {
        id: newUser._id,
        role: newUser.role,
        alias: newUser.alias,
        email: newUser.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({ success: true, token });

  } catch (err) {
    console.error("❌ Error en /register:", err);
    return sendError(res, 500, "REGISTRATION_ERROR", "Error al registrar el usuario.");
  }
});

// Login de usuario - Híbrido MongoDB + MySQL
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Try MongoDB first (legacy users)
    const mongoUser = await User.findOne({ email });
    if (mongoUser) {
      const isMatch = await mongoUser.matchPassword(password);
      if (!isMatch) {
        return res.status(400).json({ message: "Credenciales inválidas." });
      }

      const token = jwt.sign(
        {
          id: mongoUser._id,
          role: mongoUser.role,
          alias: mongoUser.alias,
          email: mongoUser.email
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({ token });
    }

    // 2. Try MySQL (new system)
    const mysqlConn = await poolMySqlRailway.getConnection();
    try {
      const [users] = await mysqlConn.execute(
        'SELECT id, correo, password_hash, nombre_usuario, tipo_usuario FROM usuarios WHERE correo = ? AND estado = "activo"',
        [email]
      );

      if (users.length > 0) {
        const user = users[0];
        
        // Check if password_hash is bcrypt or needs to be migrated
        if (user.password_hash === 'external_auth_only') {
          return res.status(400).json({ message: "Usuario requiere autenticación externa." });
        }

        // Verify password with bcrypt
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return res.status(400).json({ message: "Credenciales inválidas." });
        }

        const token = jwt.sign(
          {
            id: user.id,
            role: user.tipo_usuario,
            alias: user.nombre_usuario,
            email: user.correo
          },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.json({ token });
      }

      // User not found in either system
      return res.status(400).json({ message: "Credenciales inválidas." });

    } finally {
      mysqlConn.release();
    }

  } catch (err) {
    console.error("❌ Error en /login:", err);
    return res.status(500).json({ message: "Error al iniciar sesión." });
  }
});

// Validación del token
router.get('/me', authMiddleware, (req, res) => {
  try {
    res.status(200).json({
      user: {
        id: req.user.id,
        _id: req.user.id,
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
