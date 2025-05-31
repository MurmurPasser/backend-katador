// routes/auth.js (Backend Railway - Node.js)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
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

(async () => {
  let testConn;
  try {
    testConn = await poolMySqlRailway.getConnection();
    console.log("Conexión a MySQL de Railway (para planes) establecida y probada con ping.");
    await testConn.ping();
  } catch (err) {
    console.error("FALLO INICIAL al conectar/ping a MySQL de Railway (para planes):", err.message);
    if (err.code) console.error("Código de error MySQL:", err.code);
  } finally {
    if (testConn) testConn.release();
  }
})();

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
        planInfo.message = `El estado de tu cuenta es '${mysqlUserEstado}'. Se aplican beneficios del plan gratuito.`;
        creditosInfo.message = `Estado de cuenta '${mysqlUserEstado}'. No se aplican créditos adicionales.`;
      } else {
        const [planRows] = await connectionMySql.execute(
          'SELECT nombre_plan, fecha_inicio, fecha_expiracion FROM planes_usuario WHERE usuario_id = ? AND fecha_expiracion >= CURDATE() ORDER BY fecha_expiracion DESC LIMIT 1',
          [mySqlUserId]
        );

        if (planRows.length > 0) {
          planInfo = {
            nombre_plan: planRows[0].nombre_plan,
            fecha_inicio: planRows[0].fecha_inicio,
            fecha_expiracion: planRows[0].fecha_expiracion,
          };
        } else {
          planInfo.message = "No se encontró plan activo o ha expirado. Usando plan Gratis.";
        }

        const [creditosRows] = await connectionMySql.execute(
          'SELECT creditos_actuales FROM creditos_usuario WHERE usuario_id = ? LIMIT 1',
          [mySqlUserId]
        );

        if (creditosRows.length > 0) {
          creditosInfo = {
            creditos_actuales: creditosRows[0].creditos_actuales
          };
        } else {
          console.warn(`No se encontró registro de créditos para usuario_id (MySQL): ${mySqlUserId}. Asignando 0 créditos.`);
          creditosInfo.message = "Registro de créditos no encontrado. Asignando 0.";
        }
      }
    } else {
      console.warn(`Usuario con MongoDB ID ${userMongoId} no encontrado en tabla 'usuarios' de MySQL en Railway.`);
      planInfo.message = "Perfil de plan no configurado. Usando plan Gratis.";
      creditosInfo.message = "Perfil de créditos no configurado. Usando 0 créditos.";
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
    console.error('Error en /api/auth/me:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener datos del usuario.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});
