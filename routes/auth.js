// File: routes/auth.js (Backend Railway)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const mysql = require('mysql2/promise');

// Pool de conexión MySQL Railway
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

// Verificar conexión inicial a MySQL
(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    await testConn.ping();
    console.log("✅ Conexión a MySQL de Railway (para planes) establecida y probada con ping.");
  } catch (err) {
    console.error("❌ FALLO INICIAL al conectar/ping a MySQL:", err.message);
  } finally {
    if (testConn) testConn.release();
  }
})();


// 📌 Registro
router.post('/register', async (req, res) => {
  try {
    const { role, alias, email, password, phone } = req.body;
    if (!role || !alias || !email || !password) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'El correo ya está registrado.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const nuevoUsuario = new User({ role, alias, email, password: hashedPassword, phone });
    await nuevoUsuario.save();

    const token = jwt.sign({ id: nuevoUsuario._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token });
  } catch (error) {
    console.error("❌ Error en /register:", error);
    res.status(500).json({ message: 'Error interno del servidor al registrar.' });
  }
});


// 📌 Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Correo y contraseña requeridos.' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Usuario no encontrado.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Contraseña incorrecta.' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({ token });
  } catch (error) {
    console.error("❌ Error en /login:", error);
    res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
  }
});


// 📌 Obtener perfil con plan y créditos
router.get('/me', authMiddleware, async (req, res) => {
  let connectionMySql = null;
  try {
    const userMongoId = req.user.id;
    const userMongo = await User.findById(userMongoId).select('-password');
    if (!userMongo) {
      return res.status(404).json({ message: 'Usuario principal no encontrado.' });
    }

    let planInfo = { nombre_plan: 'Gratis', fecha_expiracion: null, message: "Plan por defecto (Gratis)." };
    let creditosInfo = { creditos_actuales: 0, message: "Créditos no encontrados, usando 0." };

    connectionMySql = await poolMySqlRailway.getConnection();
    const [mysqlUserRows] = await connectionMySql.execute(
      'SELECT id, tipo_usuario, estado FROM usuarios WHERE mongodb_id = ? LIMIT 1',
      [userMongoId.toString()]
    );

    if (mysqlUserRows.length > 0) {
      const mySqlUserId = mysqlUserRows[0].id;
      const mysqlUserEstado = mysqlUserRows[0].estado;

      if (mysqlUserEstado !== 'activo') {
        planInfo.message = `El estado de tu cuenta es '${mysqlUserEstado}'. Se aplica plan gratuito.`;
        creditosInfo.message = `Cuenta '${mysqlUserEstado}'. Sin créditos extra.`;
      } else {
        const [planRows] = await connectionMySql.execute(
          'SELECT nombre_plan, fecha_inicio, fecha_expiracion FROM planes_usuario WHERE usuario_id = ? AND fecha_expiracion >= CURDATE() ORDER BY fecha_expiracion DESC LIMIT 1',
          [mySqlUserId]
        );
        if (planRows.length > 0) {
          planInfo = {
            nombre_plan: planRows[0].nombre_plan,
            fecha_inicio: planRows[0].fecha_inicio,
            fecha_expiracion: planRows[0].fecha_expiracion
          };
        }

        const [creditosRows] = await connectionMySql.execute(
          'SELECT creditos_actuales FROM creditos_usuario WHERE usuario_id = ? LIMIT 1',
          [mySqlUserId]
        );
        if (creditosRows.length > 0) {
          creditosInfo = {
            creditos_actuales: creditosRows[0].creditos_actuales
          };
        }
      }
    }

    res.json({
      user: {
        _id: userMongo._id.toString(),
        email: userMongo.email,
        alias: userMongo.alias,
        role: userMongo.role,
        phone: userMongo.phone || '',
        plan_info: planInfo,
        creditos_info: creditosInfo
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/auth/me:', error);
    res.status(500).json({ message: 'Error al obtener datos del usuario.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});


module.exports = router;
