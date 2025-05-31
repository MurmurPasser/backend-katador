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

// Conexión MySQL de prueba
(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    console.log("Conexión a MySQL de Railway (para planes) establecida y probada con ping.");
    await testConn.ping();
  } catch (err) {
    console.error("FALLO INICIAL al conectar/ping a MySQL:", err.message);
  } finally {
    if (testConn) testConn.release();
  }
});

// Registro
router.post('/register', async (req, res) => {
  try {
    const { email, password, alias, role } = req.body;

    if (!email || !password || !alias || !role) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "El usuario ya existe." });

    const newUser = new User({ email, password, alias, role });
    await newUser.save();

    const mysqlConn = await poolMySqlRailway.getConnection();
    await mysqlConn.execute(
      "INSERT INTO usuarios (email, alias, tipo_usuario, mongodb_id, estado) VALUES (?, ?, ?, ?, ?)",
      [email, alias, role, newUser._id.toString(), 'activo']
    );
    mysqlConn.release();

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token });

  } catch (err) {
    console.error("Error en /register:", err);
    res.status(500).json({ message: "Error al registrar el usuario." });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Credenciales inválidas" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(400).json({ message: "Credenciales inválidas" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });

  } catch (err) {
    res.status(500).json({ message: "Error al iniciar sesión" });
  }
});

// /me
router.get('/me', authMiddleware, async (req, res) => {
  let connectionMySql = null;
  try {
    const userMongoId = req.user.id;
    const userMongo = await User.findById(userMongoId).select('-password');
    if (!userMongo) return res.status(404).json({ message: 'Usuario no encontrado.' });

    let planInfo = { nombre_plan: 'Gratis' };
    let creditosInfo = { creditos_actuales: 0 };

    connectionMySql = await poolMySqlRailway.getConnection();
    const [mysqlUserRows] = await connectionMySql.execute(
      'SELECT id FROM usuarios WHERE mongodb_id = ? LIMIT 1',
      [userMongoId]
    );

    if (mysqlUserRows.length > 0) {
      const mySqlUserId = mysqlUserRows[0].id;

      const [planRows] = await connectionMySql.execute(
        'SELECT nombre_plan FROM planes_usuario WHERE usuario_id = ? AND fecha_expiracion >= CURDATE() ORDER BY fecha_expiracion DESC LIMIT 1',
        [mySqlUserId]
      );
      if (planRows.length > 0) planInfo = planRows[0];

      const [creditosRows] = await connectionMySql.execute(
        'SELECT creditos_actuales FROM creditos_usuario WHERE usuario_id = ? LIMIT 1',
        [mySqlUserId]
      );
      if (creditosRows.length > 0) creditosInfo = creditosRows[0];
    }

    res.json({
      user: {
        _id: userMongo._id,
        email: userMongo.email,
        alias: userMongo.alias,
        role: userMongo.role,
        plan_info: planInfo,
        creditos_info: creditosInfo
      }
    });
  } catch (err) {
    console.error("Error en /me:", err.message);
    res.status(500).json({ message: "Error al obtener datos del usuario." });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});

module.exports = router;
