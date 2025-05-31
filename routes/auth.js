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

router.post('/register', async (req, res) => {
  const { role, alias, phone, email, password } = req.body;
  if (!role || !alias || !email || !password) {
    return res.status(400).json({ message: 'Faltan campos requeridos (role, alias, email, password).' });
  }

  let connectionMySql = null;
  let savedUserMongo = null;

  try {
    const existingUserMongo = await User.findOne({ email });
    if (existingUserMongo) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado en el sistema principal.' });
    }

    const userMongo = new User({
      role,
      alias,
      phone: (role === 'modelo' && phone && phone.trim() !== '') ? phone.trim() : undefined,
      email,
      password
    });
    savedUserMongo = await userMongo.save();

    connectionMySql = await poolMySqlRailway.getConnection();
    await connectionMySql.beginTransaction();

    const [resultInsertUserMySQL] = await connectionMySql.execute(
      'INSERT INTO usuarios (mongodb_id, nombre_usuario, tipo_usuario, correo, fecha_registro, estado) VALUES (?, ?, ?, ?, NOW(), ?)',
      [savedUserMongo._id.toString(), alias, role, email, 'activo']
    );
    const mySqlUserId = resultInsertUserMySQL.insertId;

    const defaultPlanName = 'Gratis';
    const fechaInicio = new Date();
    const fechaInicioSQL = fechaInicio.toISOString().slice(0, 19).replace('T', ' ');

    const planesConfig = [
      { nombre: "Gratis", duracion_dias: 7, creditos_incluidos: 3 },
      { nombre: "Básico", duracion_dias: 7, creditos_incluidos: 30 }
    ];
    const planGratisConfig = planesConfig.find(p => p.nombre.toLowerCase() === defaultPlanName.toLowerCase());

    if (!planGratisConfig) {
      console.error("Configuración del plan 'Gratis' no encontrada en el backend.");
      await connectionMySql.rollback();
      if (savedUserMongo) await User.findByIdAndDelete(savedUserMongo._id);
      return res.status(500).json({ message: 'Error de configuración interna del servidor (plan base).' });
    }

    const diasDuracionGratis = planGratisConfig.duracion_dias;
    const creditosIncluidosGratis = planGratisConfig.creditos_incluidos;

    const fechaExpiracion = new Date(new Date().setDate(fechaInicio.getDate() + diasDuracionGratis));
    const fechaExpiracionSQL = fechaExpiracion.toISOString().slice(0, 19).replace('T', ' ');

    await connectionMySql.execute(
      'INSERT INTO planes_usuario (usuario_id, nombre_plan, fecha_inicio, fecha_expiracion) VALUES (?, ?, ?, ?)',
      [mySqlUserId, defaultPlanName, fechaInicioSQL, fechaExpiracionSQL]
    );

    await connectionMySql.execute(
      'INSERT INTO creditos_usuario (usuario_id, creditos_actuales) VALUES (?, ?)',
      [mySqlUserId, creditosIncluidosGratis]
    );

    await connectionMySql.commit();

    res.status(201).json({
      message: 'Usuario registrado exitosamente. Ahora puedes iniciar sesión.',
      userIdMongo: savedUserMongo._id.toString()
    });

  } catch (error) {
    if (connectionMySql) {
      try { await connectionMySql.rollback(); } catch (rbError) { console.error("Error en rollback de MySQL:", rbError); }
    }
    console.error('Error durante el registro:', error);

    if (savedUserMongo && (error.sqlMessage || error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_DEFAULT_FOR_FIELD')) {
      try {
        await User.findByIdAndDelete(savedUserMongo._id);
        console.log(`Usuario ${savedUserMongo._id} eliminado de MongoDB debido a fallo en MySQL durante el registro.`);
      } catch (deleteError) {
        console.error(`Error al intentar eliminar usuario ${savedUserMongo._id} de MongoDB tras fallo en MySQL:`, deleteError);
      }
    }

    if (error.name === 'ValidationError' && error.errors) {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado (MongoDB).' });
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Conflicto de datos duplicados (Sistema secundario).' });
    }
    res.status(500).json({ message: 'Error interno del servidor durante el registro.' });
  } finally {
    if (connectionMySql) connectionMySql.release();
  }
});

module.exports = router;
