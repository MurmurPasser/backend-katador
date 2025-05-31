// File: routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
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
    //    ● mongodb_id  = newUser._id.toString()
    //    ● nombre_usuario = alias
    //    ● correo = email
    //    ● password_hash = ''    ← aquí almacenamos cadena vacía, porque no usamos login MySQL
    //    ● tipo_usuario = role
    //    ● estado = 'activo'
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
          '',          // ← password_hash vacío para no romper NOT NULL
          role,
          'activo'
        ]
      );
      const usuario_id = insertResult.insertId;

      // 5) Crear plan por defecto "Gratis" (duración 30 días)
      const fechaInicio = new Date();
      const fechaExp   = new Date();
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
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({ token });

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
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });

  } catch (err) {
    console.error("❌ Error en /login:", err);
    return res.status(500).json({ message: "Error al iniciar sesión." });
  }
});

// ------------------
//  Obtener datos del usuario (/api/auth/me)
// ------------------
router.get('/me', authMiddleware, async (req, res) => {
  let connectionMySql = null;
  try {
    const userMongoId = req.user.id;
    const userMongo   = await User.findById(userMongoId).select('-password');
    if (!userMongo) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    // Estructuras por defecto (si no hay plan o créditos en MySQL)
    let planInfo     = { nombre_plan: 'Gratis' };
    let creditosInfo = { creditos_actuales: 0 };

    // Conectar a MySQL y buscar plan + créditos
    connectionMySql = await poolMySqlRailway.getConnection();

    // 1) Obtener el `id` de MySQL (tabla `usuarios`) usando mongodb_id
    const [mysqlUserRows] = await connectionMySql.execute(
      `SELECT id 
         FROM usuarios 
        WHERE mongodb_id = ? 
        LIMIT 1`,
      [userMongoId]
    );
    if (mysqlUserRows.length > 0) {
      const mySqlUserId = mysqlUserRows[0].id;

      // 2) Obtener el plan activo más reciente
      const [planRows] = await connectionMySql.execute(
        `SELECT nombre_plan 
           FROM planes_usuario 
          WHERE usuario_id = ? 
            AND fecha_expiracion >= CURDATE() 
          ORDER BY fecha_expiracion DESC 
          LIMIT 1`,
        [mySqlUserId]
      );
      if (planRows.length > 0) {
        planInfo = planRows[0];
      }

      // 3) Obtener créditos actuales
      const [creditosRows] = await connectionMySql.execute(
        `SELECT creditos_actuales 
           FROM creditos_usuario 
          WHERE usuario_id = ? 
          LIMIT 1`,
        [mySqlUserId]
      );
      if (creditosRows.length > 0) {
        creditosInfo = creditosRows[0];
      }
    }

    // 4) Devolver JSON con datos combinados
    return res.json({
      user: {
        _id:         userMongo._id,
        email:       userMongo.email,
        alias:       userMongo.alias,
        role:        userMongo.role,
        plan_info:   planInfo,
        creditos_info: creditosInfo
      }
    });

  } catch (err) {
    console.error("❌ Error en /me:", err.message);
    return res.status(500).json({ message: "Error al obtener datos del usuario." });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});

module.exports = router;
